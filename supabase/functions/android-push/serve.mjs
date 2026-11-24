/* global Deno */
import { hasWorkerSecret } from '../_shared/worker-auth.mjs';
import { processBatch } from './worker.mjs';

Deno.serve(async request => {
  const secret = Deno.env.get('PUSH_WORKER_SECRET');
  if (request.method !== 'POST' || !hasWorkerSecret(request, 'x-push-worker-secret', secret)) {
    return new Response(null, { status: 403 });
  }
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const base = Deno.env.get('SUPABASE_URL');
  const expoKey = Deno.env.get('EXPO_ACCESS_TOKEN');
  async function rpc(name, body) {
    const result = await fetch(base + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json' },
      body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(10000),
    });
    if (!result.ok) throw new Error('Push job storage unavailable');
    return name === 'claim_android_push_jobs' ? result.json() : null;
  }
  async function expo(path, body) {
    const response = await fetch('https://exp.host/--/api/v2/push/' + path, {
      method:'POST', headers:{ 'Content-Type':'application/json', ...(expoKey && { Authorization:'Bearer '+expoKey }) },
      body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Expo unavailable');
    return (await response.json()).data;
  }
  try {
    return Response.json({ processed:await processBatch(rpc, expo) });
  } catch {
    return new Response('Push worker could not complete this batch.', { status:503 });
  }
});
