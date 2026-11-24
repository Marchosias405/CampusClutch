import assert from 'node:assert/strict';
import { processBatch } from '../supabase/functions/android-push/worker.mjs';

const jobs = [null,null,null,'t1','t2','t3'].map((ticket,i) => ({
  job_id:'job'+i, lease_id:'lease'+i, expo_token:'fixture'+i, notification_id:'notice'+i,
  category:i===0?'messages':'offers', ticket,
}));
const finishes = new Map();
const rpc = async (name, args) => {
  if (name==='claim_android_push_jobs') return jobs;
  assert.equal(name,'finish_android_push_job');
  assert.equal(args.p_lease,'lease'+args.p_id.slice(3));
  finishes.set(args.p_id,args);
};
const expo = async (path, data) => {
  if (path === 'getReceipts') {
    assert.deepEqual(data.ids,['t1','t2','t3']);
    return {t1:{status:'ok'}, t2:{status:'error', details:{error:'DeviceNotRegistered'}}};
  }
  assert.equal(path,'send');
  assert.equal(data.length,3);
  assert.equal(data[0].channelId,'messages');
  assert.equal(data[1].channelId,'requests');
  assert.deepEqual(data[0].data,{notificationId:'notice0'});
  assert.deepEqual(Object.keys(data[0]).sort(),['body','channelId','data','title','to','ttl']);
  return [{status:'ok',id:'ticket'}, {status:'error', details:{error:'MessageTooBig'}}, {status:'error', details:{error:'MessageRateExceeded'}}];
};
assert.equal(await processBatch(rpc,expo),6);
assert.deepEqual(jobs.map(j=>finishes.get(j.job_id).p_result),['ticket','drop','retry','done','invalid_device','retry']);
assert.equal(finishes.get('job0').p_ticket,'ticket');
finishes.clear();
await processBatch(rpc,async()=>{ throw new Error('offline'); });
assert.equal(finishes.size,6);
assert([...finishes.values()].every(r=>r.p_result==='retry'));
assert.equal(await processBatch(async()=>[],()=>assert.fail('Empty queue must stay quiet')),0);
// Exercise the deployed entry point without contacting Expo or a real database.
let handle;
const values = new Map([['PUSH_WORKER_SECRET','fixture-secret'], ['SUPABASE_URL','https://fixture.invalid'],
  ['SUPABASE_SERVICE_ROLE_KEY','fixture-role']]);
globalThis.Deno = { env:{ get:name=>values.get(name) }, serve:callback=>{ handle=callback; } };
await import('../supabase/functions/android-push/serve.mjs');
let calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url, options)=>{
  calls++;
  assert.equal(url,'https://fixture.invalid/rest/v1/rpc/claim_android_push_jobs');
  assert.equal(options.headers.Authorization,'Bearer fixture-role');
  return Response.json([]);
};
try {
  const request = secret => new Request('https://fixture.invalid', { method:'POST', headers:{'x-push-worker-secret':secret} });
  assert.equal((await handle(request('wrong'))).status,403);
  assert.equal(calls,0);
  const response=await handle(request('fixture-secret'));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{processed:0});
  assert.equal(calls,1);
} finally {
  globalThis.fetch=originalFetch;
  delete globalThis.Deno;
}
console.log('PASS Android push worker: authenticated entry, safe payloads, channels, tickets, receipt polling, invalid devices, retries, empty queue.');
