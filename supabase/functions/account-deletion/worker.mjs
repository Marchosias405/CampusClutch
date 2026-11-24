import { hasWorkerSecret } from '../_shared/worker-auth.mjs';

// No credentials or request bodies are logged. Dependencies keep the same
// worker testable against real local Auth and Storage without a hosted account.
export async function finishDeletion(job, api) {
  if (job.status !== 'claimed') return job.status;
  for (let batch = 0; batch < 20; batch++) {
    const assets = await api.rpc('account_deletion_assets', { p_id: job.id, p_lease: job.lease });
    if (!Array.isArray(assets)) throw new Error('Invalid asset response');
    if (!assets.length) {
      // Soft deletion removes Auth credentials/identities, retaining the UUID
      // required by shared historical records. Repeating it is harmless.
      await api.softDelete(job.profile_id);
      const done = await api.rpc('finish_account_deletion', { p_id: job.id, p_lease: job.lease });
      return done === true ? 'complete' : 'pending';
    }
    const buckets = new Map();
    for (const asset of assets) {
      if (typeof asset.bucket !== 'string' || typeof asset.name !== 'string') throw new Error('Invalid asset');
      if (!buckets.has(asset.bucket)) buckets.set(asset.bucket, []);
      buckets.get(asset.bucket).push(asset.name);
    }
    for (const [bucket, paths] of buckets) await api.remove(bucket, paths);
  }
  return 'pending';
}

const maxReceiptBytes = 512;
const allowedHeaders = ['apikey', 'authorization', 'content-type'];

function parseAllowedOrigins(config) {
  const origins = new Set();
  for (const value of (config ?? '').split(',')) {
    if (!value.trim()) continue;
    try {
      const url = new URL(value.trim());
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol === 'https:' || (loopback && url.protocol === 'http:'))
        && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) {
        origins.add(url.origin);
      }
    } catch { /* Invalid configuration never grants access. */ }
  }
  return origins;
}

async function readReceipt(request) {
  if (!request.body || Number(request.headers.get('content-length')) > maxReceiptBytes) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxReceiptBytes);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.length - size) {
        void reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 2
      || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
      || typeof body.secret !== 'string' || !/^[0-9a-f]{64}$/.test(body.secret)) return null;
    return body;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export function deletionHandler(api, workerSecret, allowedWebOrigins) {
  const origins = parseAllowedOrigins(allowedWebOrigins);
  return async request => {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
    const response = (status, code = 200) => new Response(JSON.stringify({ status }), { status: code, headers });
    if (origin !== null) {
      if (!origins.has(origin)) return response('unavailable', 403);
      headers.set('Access-Control-Allow-Origin', origin);
    }
    if (request.method === 'OPTIONS') {
      const requested = (request.headers.get('access-control-request-headers') ?? '')
        .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (origin === null || request.headers.get('access-control-request-method') !== 'POST'
        || !requested.every(name => allowedHeaders.includes(name))) return response('unavailable', 403);
      headers.set('Access-Control-Allow-Methods', 'POST');
      headers.set('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return response('unavailable', 405);
    try {
      if (request.headers.has('x-deletion-worker-secret')) {
        if (!hasWorkerSecret(request, 'x-deletion-worker-secret', workerSecret)) return response('unavailable', 403);
        for (let i = 0; i < 3; i++) {
          const job = await api.rpc('claim_account_deletion', { p_id: null, p_secret: null });
          if (job.status !== 'claimed') break;
          await finishDeletion(job, api);
        }
        const photos = await api.rpc('claim_unused_avatars', {});
        if (photos.length) await api.remove('avatars', photos.map(photo => photo.name));
        return response('processed');
      }
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return response('unavailable', 415);
      }
      const body = await readReceipt(request);
      if (!body) return response('unavailable', 400);
      const job = await api.rpc('claim_account_deletion', { p_id: body.id, p_secret: body.secret });
      return response(await finishDeletion(job, api));
    } catch { return response('pending', 503); }
  };
}
