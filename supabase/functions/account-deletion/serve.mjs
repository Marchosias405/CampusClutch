/* global Deno */
import { deletionHandler } from './worker.mjs';
const base = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
async function call(path, method, body) {
  const r = await fetch(`${base}${path}`, { method, headers: {
    apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Cleanup service unavailable');
  return r.json();
}
Deno.serve(deletionHandler({
  rpc: (name, args) => call(`/rest/v1/rpc/${name}`, 'POST', args),
  remove: (bucket, prefixes) => call(`/storage/v1/object/${encodeURIComponent(bucket)}`, 'DELETE', { prefixes }),
  softDelete: id => call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, 'DELETE', { should_soft_delete: true }),
}, Deno.env.get('DELETION_WORKER_SECRET'), Deno.env.get('DELETION_ALLOWED_WEB_ORIGINS')));
