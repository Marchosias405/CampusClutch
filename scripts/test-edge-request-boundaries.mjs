import assert from 'node:assert/strict';
import test from 'node:test';
import { deletionHandler } from '../supabase/functions/account-deletion/worker.mjs';
import { hasWorkerSecret } from '../supabase/functions/_shared/worker-auth.mjs';

const endpoint = 'https://project.example.test/functions/v1/account-deletion';
const origin = 'https://app.example.test';
const receipt = { id: '00000000-0000-4000-8000-000000000001', secret: 'e'.repeat(64) };
const credential = 'worker-test-fixture';
function fixture(config = origin) {
  const claims = [];
  const api = { async rpc(name, args) {
    if (name === 'claim_unused_avatars') return [];
    assert.equal(name, 'claim_account_deletion');
    claims.push(args);
    return { status: 'unconfirmed' };
  } };
  return { claims, handle: deletionHandler(api, credential, config) };
}
function post(body = JSON.stringify(receipt), headers = {}) {
  return new Request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}
function preflight(source, method = 'POST', headers = 'content-type, apikey') {
  return new Request(endpoint, { method:'OPTIONS', headers:{
    Origin:source, 'Access-Control-Request-Method':method, 'Access-Control-Request-Headers':headers,
  } });
}

test('native and configured browser receipts retain the same database authorization', async () => {
  const { claims, handle } = fixture(origin + ',http://localhost:8081');
  for (const source of [null, origin, 'http://localhost:8081']) {
    const r = await handle(post(undefined, source ? { Origin:source } : {}));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {status:'unconfirmed'});
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), source);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(claims.at(-1), {p_id:receipt.id, p_secret:receipt.secret});
  }
});

test('browser preflights require an exact configured origin, method, and permitted headers', async () => {
  const { claims, handle } = fixture(origin);
  const accepted = await handle(preflight(origin));
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(accepted.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal(accepted.headers.get('Access-Control-Allow-Credentials'), null);
  for (const source of ['null', 'https://other.example.test', origin + ':444', 'http://app.example.test']) {
    for (const req of [preflight(source), post(undefined,{ Origin:source })]) {
      const rejected = await handle(req);
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
    }
  }
  assert.equal((await handle(preflight(origin, 'GET'))).status, 403);
  assert.equal((await handle(preflight(origin, 'POST', 'x-deletion-worker-secret'))).status, 403);
  for (const config of ['', '*', 'null', 'http://app.example.test', origin + '/path']) {
    assert.equal((await fixture(config).handle(preflight(origin))).status, 403);
  }
  assert.equal(claims.length, 0);
});

test('malformed or oversized receipts stop before a service-role call', async () => {
  const { claims, handle } = fixture();
  assert.equal((await handle(post('{}', {'Content-Type':'text/plain'}))).status, 415);
  for (const body of ['{', 'null', '[]', '{}', JSON.stringify({...receipt, secret:[receipt.secret]}),
    JSON.stringify({...receipt, id:12}), JSON.stringify({...receipt, account:0}),
    ' '.repeat(512) + JSON.stringify(receipt)]) {
    const r = await handle(post(body));
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), {status:'unavailable'});
  }
  assert.equal((await handle(post(undefined, {'Content-Length':'513'}))).status, 400);
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(65)); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request(endpoint, {method:'POST', body, duplex:'half', headers:{'Content-Type':'application/json'}});
  assert.equal((await handle(streamed)).status, 400);
  assert.equal(cancelled, true);
  assert.equal(claims.length, 0);
});

test('only first-party scheduler requests can enter the worker path', async () => {
  const { claims, handle } = fixture();
  const header = 'x-deletion-worker-secret';
  for (const headers of [{[header]:'invalid'}, {[header]:credential, Origin:origin}]) {
    assert.equal((await handle(post(undefined, headers))).status, 403);
  }
  assert.equal(claims.length, 0);
  assert.equal(hasWorkerSecret(post(), header, undefined), false);
  const r = await handle(post('{}', {[header]:credential}));
  assert.equal(r.status, 200);
  assert.deepEqual(claims, [{p_id:null, p_secret:null}]);
});
