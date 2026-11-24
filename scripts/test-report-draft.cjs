/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const uid = n => `a4140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const client = {};
vm.runInNewContext(compile('src/lib/safetyReports.ts'), { exports: client, require: name => {
  if (name === './offers') return {};
  if (name === './supabase') return {};
  throw Error(name);
} });
const api = {};
vm.runInNewContext(compile('src/lib/reportDraft.ts'), { exports: api, require: name => {
  if (name === './privateDrafts') return { privateDrafts: { forAccount: () => ({}) } };
  if (name === './env') return { env: { supabaseUrl: 'https://default.test' } };
  if (name === './safetyReports') return client;
  throw Error(name);
} });
let serial = 100;
function fixture(targetType = 'student') {
  const map = new Map();
  const state = { writes: [], sends: [], ids: 0, beforeWrite: null, beforeRemove: null, beforeRead: null, send: null };
  const namespace = `https://report-${++serial}.test`;
  const options = { userId: uid(1), targetType, targetId: uid(2) };
  const storage = {
    async getItem(key) { await state.beforeRead?.(key); return map.get(key) ?? null; },
    async setItem(key, raw) { await state.beforeWrite?.(key, raw); state.writes.push({ key, raw }); map.set(key, raw); },
    async removeItem(key) { await state.beforeRemove?.(key); map.delete(key); },
  };
  const receipt = { report_id: uid(99), created_at: '2026-11-04T00:00:00Z' };
  const deps = {
    namespace, storage, randomUUID: () => { state.ids++; return uid(10 + state.ids); },
    send: async (userId, attempt) => {
      state.sends.push({ userId, attempt: plain(attempt), stored: map.get(api.reportDraftKey(namespace, options)) });
      return state.send ? state.send(userId, attempt) : receipt;
    },
  };
  const create = (scope = options, changes = {}) => api.createReportDraftModel(scope, { ...deps, ...changes });
  const key = api.reportDraftKey(namespace, options);
  return { map, state, deps, options, key, receipt, create };
}
async function ready(f, reason = 'spam', details = '  Repeated invitations.  ') {
  const model = f.create(); await model.restore(); model.setReason(reason); model.setDetails(details); return model;
}
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('drafts persist across recreation and are isolated by backend, account and target', async () => {
    const f = fixture(); const first = await ready(f); first.dispose();
    const restored = f.create(); await restored.restore();
    assert.equal(restored.getState().reason, 'spam'); assert.equal(restored.getState().details, '  Repeated invitations.  ');
    for (const model of [f.create({ ...f.options, userId: uid(7) }), f.create({ ...f.options, targetId: uid(8) }), f.create(f.options, { namespace: 'https://another.test' })]) {
      await model.restore(); assert.equal(model.getState().details, ''); assert.equal(model.getState().pending, null);
    }
  });
  await test('a new submission is durable before dispatch and duplicate taps share one operation', async () => {
    const f = fixture(); const gate = deferred(); f.state.send = () => gate.promise;
    const model = await ready(f); const first = model.submit(); const second = model.submit(); await settle();
    assert.equal(f.state.sends.length, 1); assert.equal(f.state.ids, 1); assert.equal(model.getState().busy, true);
    const stored = JSON.parse(f.state.sends[0].stored);
    assert.deepEqual(stored.pending, f.state.sends[0].attempt); assert.equal(stored.details, 'Repeated invitations.');
    model.setReason('unsafe'); model.setDetails('changed');
    assert.equal(model.getState().reason, 'spam'); assert.equal(model.getState().details, 'Repeated invitations.');
    gate.resolve(f.receipt); await Promise.all([first, second]);
    assert.deepEqual(plain(model.getState().receipt), f.receipt); assert.equal(f.map.has(f.key), false);
    await model.submit(); assert.equal(f.state.sends.length, 1);
  });
  await test('an ambiguous attempt survives restart and retries the exact id and payload', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); };
    const original = await ready(f); await original.submit();
    assert.match(original.getState().error, /may already have been received/);
    const frozen = plain(original.getState().pending); original.dispose();
    const retry = f.create(); await retry.restore(); assert.deepEqual(plain(retry.getState().pending), frozen);
    retry.setDetails('different body'); assert.equal(retry.getState().details, frozen.details);
    f.state.send = null; await retry.submit();
    assert.equal(f.state.ids, 1); assert.deepEqual(f.state.sends[0].attempt, f.state.sends[1].attempt);
    assert.deepEqual(plain(retry.getState().receipt), f.receipt);
  });
  await test('overlapping screens reuse the durable operation and cannot overwrite pending fields', async () => {
    const f = fixture(); const response = deferred(); f.state.send = () => response.promise;
    const first = await ready(f); const second = f.create(); await second.restore();
    const one = first.submit(); await settle();
    second.setDetails('A later edit from another mounted screen.'); await settle();
    assert.equal(second.getState().details, first.getState().pending.details);
    assert.deepEqual(plain(second.getState().pending), plain(first.getState().pending));
    const two = second.submit(); await settle();
    assert.equal(f.state.ids, 1); assert.equal(f.state.sends.length, 2);
    assert.deepEqual(f.state.sends[0].attempt, f.state.sends[1].attempt);
    response.resolve(f.receipt); await Promise.all([one, two]);
    assert.equal(f.map.has(f.key), false);
  });
  await test('durable-write failure prevents network submission and retains editable values', async () => {
    const f = fixture(); const model = await ready(f); await settle();
    f.state.beforeWrite = () => { throw Error('disk unavailable'); };
    await model.submit(); assert.equal(f.state.sends.length, 0); assert.equal(model.getState().pending, null);
    assert.equal(model.getState().details, '  Repeated invitations.  '); assert.match(model.getState().error, /Nothing was submitted/);
    f.state.beforeWrite = null; await model.submit(); assert.equal(f.state.sends.length, 1);
  });
  await test('retry storage failure never claims an earlier attempt was not submitted', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); };
    const model = await ready(f); await model.submit();
    f.state.beforeWrite = () => { throw Error('disk unavailable'); };
    await model.submit(); assert.equal(f.state.sends.length, 1);
    assert.match(model.getState().error, /may already have arrived/); assert.ok(model.getState().pending);
  });
  await test('leaving before persistence finishes saves the attempt but does not send', async () => {
    const f = fixture(); const model = await ready(f); await settle(); const write = deferred();
    f.state.beforeWrite = () => write.promise;
    const sending = model.submit(); await settle(); model.setActive(false); write.resolve(); await sending;
    assert.equal(f.state.sends.length, 0); assert.ok(model.getState().pending); assert.equal(model.getState().busy, false);
    f.state.beforeWrite = null; model.setActive(true); await model.submit(); assert.equal(f.state.sends.length, 1);
  });
  await test('late success from a disposed screen cannot erase a newer draft', async () => {
    const f = fixture(); const response = deferred(); f.state.send = () => response.promise;
    const old = await ready(f); const sending = old.submit(); await settle(); old.dispose();
    const current = f.create(); await current.restore(); await current.discard(); current.setReason('unsafe'); current.setDetails('New concern to report.');
    response.resolve(f.receipt); await sending;
    assert.equal(JSON.parse(f.map.get(f.key)).details, 'New concern to report.');
    assert.equal(old.getState().receipt, null); assert.equal(current.getState().receipt, null);
  });
  await test('background completion stays silent until focus returns', async () => {
    const f = fixture(); const response = deferred(); f.state.send = () => response.promise;
    const model = await ready(f); let updates = 0; model.subscribe(() => { updates++; });
    const sending = model.submit(); await settle(); model.setActive(false); const before = updates;
    response.resolve(f.receipt); await sending; assert.equal(updates, before);
    assert.deepEqual(plain(model.getState().receipt), f.receipt); model.setActive(true); assert.equal(updates, before + 1);
  });
  await test('confirmed receipt survives cleanup failure and persisted retry remains idempotent', async () => {
    const f = fixture(); const model = await ready(f);
    f.state.beforeRemove = () => { throw Error('disk unavailable'); };
    await model.submit(); assert.deepEqual(plain(model.getState().receipt), f.receipt); assert.match(model.getState().error, /report was received/);
    model.dispose(); f.state.beforeRemove = null;
    const next = f.create(); await next.restore(); await next.submit();
    assert.deepEqual(f.state.sends[0].attempt, f.state.sends[1].attempt); assert.equal(f.state.ids, 1); assert.equal(f.map.has(f.key), false);
  });
  await test('rapid edits and immediate recreation restore the newest serialized draft', async () => {
    const f = fixture(); const model = await ready(f); await settle(); const firstWrite = deferred(); let writes = 0;
    f.state.beforeWrite = () => ++writes === 1 ? firstWrite.promise : undefined;
    model.setDetails('first'); model.setDetails('second'); model.setDetails('third'); model.dispose();
    const next = f.create(); const restoring = next.restore(); await settle(); assert.equal(next.getState().restored, false);
    firstWrite.resolve(); await restoring; assert.equal(next.getState().details, 'third');
  });
  await test('unreadable saved data fails closed until explicit discard or successful restore', async () => {
    const f = fixture(); f.map.set(f.key, '{broken'); const model = f.create(); await model.restore();
    assert.equal(model.getState().restored, false); assert.equal(model.getState().restoreFailed, true);
    model.setReason('spam'); model.setDetails('new'); await model.submit(); assert.equal(f.state.sends.length, 0); assert.equal(f.map.get(f.key), '{broken');
    await model.discard(); assert.equal(model.getState().restored, true); assert.equal(f.map.has(f.key), false);
    const failedRead = f.create(); f.state.beforeRead = () => { throw Error('unavailable'); }; await failedRead.restore();
    assert.equal(failedRead.getState().restoreFailed, true); f.state.beforeRead = null; await failedRead.restore();
    assert.equal(failedRead.getState().restored, true);
  });
  await test('copied pending data cannot be restored into another report scope', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); };
    const original = await ready(f); await original.submit(); const stored = JSON.parse(f.map.get(f.key));
    stored.pending.targetId = uid(8); f.map.set(f.key, JSON.stringify(stored));
    const model = f.create(); await model.restore(); assert.equal(model.getState().restoreFailed, true); await model.submit();
    assert.equal(f.state.sends.length, 1);
  });
  await test('stale corrupt or failed-read screens cannot discard a newer valid draft', async () => {
    const f = fixture(); f.map.set(f.key, '{broken'); const old = f.create(); await old.restore();
    const current = f.create(); await current.restore(); await current.discard(); current.setReason('unsafe'); current.setDetails('Keep this new draft.');
    await settle(); await old.discard(); assert.match(old.getState().error, /Unable to discard/);
    assert.equal(JSON.parse(f.map.get(f.key)).details, 'Keep this new draft.');
    const unreadable = f.create(); f.state.beforeRead = () => { throw Error('temporary read error'); }; await unreadable.restore();
    f.state.beforeRead = null; await unreadable.discard();
    assert.match(unreadable.getState().error, /Unable to discard/);
    assert.equal(JSON.parse(f.map.get(f.key)).details, 'Keep this new draft.');
    await unreadable.restore(); assert.equal(unreadable.getState().details, 'Keep this new draft.');
  });
  await test('validation keeps invalid forms editable and counts Unicode code points', async () => {
    const f = fixture(); const model = f.create(); await model.restore(); await model.submit(); assert.match(model.getState().error, /Choose a reason/);
    model.setReason('other'); model.setDetails('🙂'.repeat(9)); await model.submit(); assert.match(model.getState().error, /10 characters/); assert.equal(f.state.ids, 0);
    model.setDetails('🙂'.repeat(2001)); assert.equal(Array.from(model.getState().details).length, 2000);
    await model.submit(); assert.equal(f.state.sends.length, 1);
  });
  await test('failed discard retains the frozen operation and prevents accidental edits', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); }; const model = await ready(f); await model.submit();
    const pending = plain(model.getState().pending); f.state.beforeRemove = () => { throw Error('disk unavailable'); };
    await model.discard(); model.setDetails('replacement'); assert.deepEqual(plain(model.getState().pending), pending);
    assert.equal(model.getState().details, pending.details); assert.match(model.getState().error, /Unable to discard/);
  });
  await test('disposed models cannot submit, mutate, restore, or emit later updates', async () => {
    const f = fixture(); const model = await ready(f); let calls = 0; model.subscribe(() => { calls++; }); model.dispose();
    model.setReason('other'); model.setDetails('change'); model.setActive(true); await model.submit(); await model.discard(); await model.restore();
    assert.equal(calls, 0); assert.equal(f.state.sends.length, 0);
  });
  await test('message and anonymous review pending retries survive restart without crossing target or account scope', async () => {
    for (const targetType of ['message', 'course_review']) {
      const f = fixture(targetType); f.state.send = () => { throw Error('lost response'); };
      const old = await ready(f, 'harassment', 'The exact content concern survives account switching.');
      await old.submit(); const frozen = plain(old.getState().pending); old.dispose();
      for (const scope of [{ ...f.options, userId: uid(7) }, { ...f.options, targetType: targetType === 'message' ? 'course_review' : 'message' }, { ...f.options, targetId: uid(8) }]) {
        const unrelated = f.create(scope); await unrelated.restore();
        assert.equal(unrelated.getState().details, ''); assert.equal(unrelated.getState().pending, null);
        await unrelated.submit(); unrelated.dispose();
      }
      assert.equal(f.state.sends.length, 1);
      const restored = f.create(); await restored.restore();
      assert.deepEqual(plain(restored.getState().pending), frozen);
      f.state.send = null; await restored.submit();
      assert.deepEqual(f.state.sends[1].attempt, frozen); assert.equal(f.state.sends[1].userId, uid(1));
      assert.equal(f.state.ids, 1);
    }
  });
  await test('old-account completions cannot expose receipts or erase a new-account content draft', async () => {
    const f = fixture('message'); const response = deferred(); f.state.send = () => response.promise;
    const old = await ready(f); const sending = old.submit(); await settle(); old.dispose();
    const nextScope = { ...f.options, userId: uid(7) };
    const current = f.create(nextScope); await current.restore(); current.setReason('spam'); current.setDetails('Different account, separate report.');
    await settle(); response.resolve(f.receipt); await sending;
    assert.equal(old.getState().receipt, null); assert.equal(current.getState().receipt, null);
    assert.equal(JSON.parse(f.map.get(api.reportDraftKey(f.deps.namespace, nextScope))).details, 'Different account, separate report.');
    assert.equal(f.map.has(f.key), false, 'A confirmed old operation can clean only its own exact saved copy');
  });
  console.log(`Report draft model: ${checks} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
