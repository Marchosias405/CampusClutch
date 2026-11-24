/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/studentBlocks.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const uid = n => `b10c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const result = (blocked = false, revision = '0', profileId = uid(2)) => ({ profile_id: profileId, blocked_by_me: blocked, interaction_blocked: blocked, revision });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function client() {
  const state = { account: uid(1), calls: [], sessionCalls: 0, response: result(), error: null, execute: null, thrown: null };
  const api = {};
  vm.runInNewContext(source, { exports: api, require: name => {
    if (name === '@react-native-async-storage/async-storage') return { default: {} };
    if (name === './env') return { env: { supabaseUrl: 'https://default.test' } };
    if (name === './offers') return { assertOfferSession: async expected => {
      state.sessionCalls++;
      if (expected !== state.account) throw Error('private auth metadata');
      return { access_token: 'token-' + state.account };
    } };
    if (name === './supabase') return { supabase: { rpc: (name, args) => ({ setHeader: async (header, value) => {
      state.calls.push({ name, args: plain(args), header, value });
      await state.execute?.();
      if (state.thrown) throw state.thrown;
      return { data: state.response, error: state.error };
    } }) } };
    throw Error(name);
  } });
  return { state, api };
}
let serial = 0;
function fixture() {
  const { api } = client();
  const map = new Map();
  const state = { reads: [], writes: [], sends: [], loads: [], beforeRead: null, beforeWrite: null, beforeRemove: null, send: null, load: null };
  const namespace = `https://block-${++serial}.test`;
  const options = { userId: uid(1), profileId: uid(2) };
  const key = api.studentBlockKey(namespace, options);
  const deps = {
    namespace,
    storage: {
      async getItem(key) { state.reads.push(key); await state.beforeRead?.(key); return map.get(key) ?? null; },
      async setItem(key, raw) { await state.beforeWrite?.(key, raw); state.writes.push({ key, raw }); map.set(key, raw); },
      async removeItem(key) { await state.beforeRemove?.(key); map.delete(key); },
    },
    async load(userId, profileId) { state.loads.push({ userId, profileId }); return state.load ? state.load(userId, profileId) : result(false, '0', profileId); },
    async send(userId, profileId, blocked, expectedRevision) {
      state.sends.push({ userId, profileId, blocked, expectedRevision, stored: map.get(key) });
      return state.send ? state.send(userId, profileId, blocked, expectedRevision) : result(blocked, String(BigInt(expectedRevision) + 1n), profileId);
    },
  };
  const create = (scope = options, changes = {}) => api.createStudentBlockModel(scope, { ...deps, ...changes });
  return { api, map, state, deps, namespace, options, key, create };
}
async function ready(f) { const model = f.create(); await model.refresh(); return model; }
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('client reads and writes pin the active session and keep bigint revision text', async () => {
    const { state, api } = client();
    assert.deepEqual(plain(await api.getStudentBlockState(uid(1), uid(2))), result());
    state.response = result(true, '9007199254740993');
    assert.deepEqual(plain(await api.setStudentBlock(uid(1), uid(2), true, '9007199254740992')), state.response);
    assert.equal(state.sessionCalls, 4);
    assert.deepEqual(state.calls[1], { name: 'set_student_block', args: { p_profile_id: uid(2), p_blocked: true, p_expected_revision: '9007199254740992' }, header: 'Authorization', value: 'Bearer token-' + uid(1) });
  });
  await test('invalid ids, self targets, desired values and revisions never dispatch', async () => {
    const { state, api } = client();
    for (const value of ['', '01', '-1', '1.0', '9223372036854775808', 1, null]) await assert.rejects(api.setStudentBlock(uid(1), uid(2), true, value));
    for (const args of [[uid(1), uid(1)], ['', uid(2)], [uid(1), 'invalid']]) await assert.rejects(api.getStudentBlockState(...args));
    await assert.rejects(api.setStudentBlock(uid(1), uid(2), 'true', '0'));
    assert.equal(state.calls.length, 0); assert.equal(state.sessionCalls, 0);
  });
  await test('malformed or contradictory state cannot be accepted as a successful response', async () => {
    const { state, api } = client();
    for (const malformed of [null, {}, result(false, 0), result(false, '01'), result(false, '-1'), result(false, '0', uid(3)), { ...result(), blocked_by_me: true }, { ...result(), interaction_blocked: 'false' }]) {
      state.response = malformed; await assert.rejects(api.getStudentBlockState(uid(1), uid(2)));
    }
    for (const malformed of [result(false, '1'), result(true, '3'), result(true, '0')]) {
      state.response = malformed; await assert.rejects(api.setStudentBlock(uid(1), uid(2), true, '1'));
    }
    state.response = { ...result(true, '1'), blocked_by_id: uid(9), email: 'private' };
    assert.deepEqual(plain(await api.setStudentBlock(uid(1), uid(2), true, '0')), result(true, '1'));
  });
  await test('sign-out and account switches reject dispatch and late success', async () => {
    const { state, api } = client();
    state.account = null; await assert.rejects(api.getStudentBlockState(uid(1), uid(2)), error => error.code === 'CC_BLOCK_SESSION');
    state.account = uid(3); await assert.rejects(api.setStudentBlock(uid(1), uid(2), true, '0'));
    assert.equal(state.calls.length, 0);
    state.account = uid(1); state.execute = () => { state.account = uid(3); };
    await assert.rejects(api.getStudentBlockState(uid(1), uid(2)), error => error.code === 'CC_BLOCK_SESSION');
  });
  await test('blocked list enforces bounds, unique peers and private field projection', async () => {
    const { state, api } = client();
    const row = { profile_id: uid(2), display_name: 'Student', blocked_at: '2026-11-04T01:00:00Z', revision: '1' };
    for (const args of [[-1, 20], [0, 0], [0, 51], [0.5, 20]]) await assert.rejects(api.getMyBlockedStudents(uid(1), ...args));
    assert.equal(state.calls.length, 0);
    state.response = [{ ...row, email: 'private', reverse_block: true }];
    assert.deepEqual(plain(await api.getMyBlockedStudents(uid(1))), [row]);
    for (const rows of [null, {}, [row, row], [{ ...row, profile_id: uid(1) }], [{ ...row, blocked_at: 'invalid' }], [{ ...row, revision: 1 }], [row, { ...row, profile_id: uid(3) }]]) {
      state.response = rows; await assert.rejects(api.getMyBlockedStudents(uid(1), 0, 1));
    }
  });
  await test('public error text never exposes transport or database detail', async () => {
    const { api } = client();
    for (const code of ['42501', 'PT409', 'CC_BLOCK_SESSION', 'CC_BLOCK_INPUT', 'XX000', null]) {
      assert.ok(!api.studentBlockError({ code, message: 'PRIVATE SECRET' }).includes('PRIVATE'));
    }
    assert.match(api.studentBlockError({ code: 'PT409' }), /Refresh/);
    assert.match(api.studentBlockError(Error('PRIVATE SECRET')), /may already have been applied/);
  });
  await test('fresh model must restore and load before it can change block state', async () => {
    const f = fixture(), model = f.create();
    await model.change(true); assert.equal(f.state.sends.length, 0);
    await model.refresh(); assert.equal(model.getState().restored, true);
    assert.deepEqual(plain(model.getState().data), result());
    await model.change(false); assert.equal(f.state.sends.length, 0);
  });
  await test('durable intent precedes network dispatch and duplicate taps send once', async () => {
    const f = fixture(), gate = deferred(); f.state.send = () => gate.promise;
    const model = await ready(f); const first = model.change(true), second = model.change(true); await settle();
    assert.equal(f.state.sends.length, 1); assert.equal(model.getState().busy, true);
    assert.deepEqual(JSON.parse(f.state.sends[0].stored).pending, { blocked: true, expectedRevision: '0' });
    await model.change(false); assert.equal(f.state.sends.length, 1);
    gate.resolve(result(true, '1')); await Promise.all([first, second]);
    assert.deepEqual(plain(model.getState().data), result(true, '1')); assert.equal(model.getState().pending, null); assert.equal(f.map.has(f.key), false);
  });
  await test('ambiguous response survives recreation and exact retry remains frozen despite newer load', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); };
    const first = await ready(f); await first.change(true); first.dispose();
    f.state.load = () => result(true, '1');
    const restored = await ready(f); assert.deepEqual(plain(restored.getState().pending), { blocked: true, expectedRevision: '0' });
    await restored.change(false); assert.equal(f.state.sends.length, 1);
    f.state.send = () => result(true, '1'); await restored.retry();
    assert.equal(f.state.sends.length, 2);
    assert.deepEqual(f.state.sends[1], f.state.sends[0]);
    assert.equal(restored.getState().pending, null);
  });
  await test('pending changes are isolated by backend, account and peer', async () => {
    const f = fixture(); f.state.send = () => { throw Error('lost response'); };
    const original = await ready(f); await original.change(true);
    for (const model of [f.create({ ...f.options, userId: uid(3) }), f.create({ ...f.options, profileId: uid(4) }), f.create(f.options, { namespace: 'https://other.test' })]) {
      await model.refresh(); assert.equal(model.getState().pending, null);
    }
    assert.equal(f.api.studentBlockKey(f.namespace + '/', f.options), f.key);
  });
  await test('storage restoration failure and corrupted scope prohibit mutations', async () => {
    const f = fixture(); f.state.beforeRead = () => { throw Error('storage unavailable'); };
    const model = await ready(f); assert.equal(model.getState().restoreFailed, true);
    await model.change(true); await model.retry(); assert.equal(f.state.sends.length, 0);
    f.state.beforeRead = null;
    for (const raw of ['{broken', JSON.stringify({ version: 1, namespace: f.namespace, userId: uid(3), profileId: uid(2), pending: { blocked: true, expectedRevision: '0' } })]) {
      f.map.set(f.key, raw); await model.refresh(); await model.change(true); assert.equal(model.getState().restoreFailed, true); assert.equal(f.state.sends.length, 0);
    }
    f.map.delete(f.key); await model.refresh(); await model.change(true); assert.equal(f.state.sends.length, 1);
  });
  await test('a failed durable write prevents the first network mutation', async () => {
    const f = fixture(), model = await ready(f); f.state.beforeWrite = () => { throw Error('disk full'); };
    await model.change(true); assert.equal(f.state.sends.length, 0); assert.equal(f.map.has(f.key), false); assert.equal(model.getState().pending, null);
    f.state.beforeWrite = null; await model.change(true); assert.equal(f.state.sends.length, 1);
  });
  await test('success with failed cleanup remains an exact retry, never a fresh toggle', async () => {
    const f = fixture(), model = await ready(f); f.state.beforeRemove = () => { throw Error('disk unavailable'); };
    await model.change(true); assert.deepEqual(plain(model.getState().pending), { blocked: true, expectedRevision: '0' });
    assert.equal(f.map.has(f.key), true); await model.change(false); assert.equal(f.state.sends.length, 1);
    f.state.beforeRemove = null; await model.retry(); assert.equal(f.state.sends.length, 2); assert.equal(model.getState().pending, null);
  });
  await test('definitive stale revision clears old intent and requires refreshed deliberate choice', async () => {
    const f = fixture(), model = await ready(f); f.state.send = () => { throw { code: 'PT409', message: 'private' }; };
    await model.change(true); assert.equal(model.getState().pending, null); assert.equal(model.getState().data, null); assert.equal(f.map.has(f.key), false);
    await model.retry(); await model.change(true); assert.equal(f.state.sends.length, 1);
    f.state.load = () => result(false, '2'); await model.refresh(); f.state.send = null; await model.change(true);
    assert.equal(f.state.sends[1].expectedRevision, '2'); assert.equal(model.getState().data.revision, '3');
  });
  await test('permission and malformed responses retain unconfirmed intent for safe retry', async () => {
    for (const response of [() => { throw { code: '42501' }; }, () => { throw { code: '40001' }; }, () => result(false, '1'), () => result(true, '9'), () => ({ ...result(true, '1'), revision: 1 })]) {
      const f = fixture(), model = await ready(f); f.state.send = response; await model.change(true);
      assert.deepEqual(plain(model.getState().pending), { blocked: true, expectedRevision: '0' }); assert.equal(f.map.has(f.key), true);
    }
  });
  await test('two mounted screens cannot overwrite or reverse a saved pending choice', async () => {
    const f = fixture(), gate = deferred(); f.state.send = () => gate.promise;
    const first = await ready(f), second = await ready(f);
    const work = first.change(true); await settle(); await second.change(true);
    assert.equal(f.state.sends.length, 1); assert.deepEqual(plain(second.getState().pending), { blocked: true, expectedRevision: '0' });
    await second.change(false); assert.equal(f.state.sends.length, 1);
    const retry = second.retry(); await settle(); assert.equal(f.state.sends.length, 2); assert.deepEqual(f.state.sends[0], f.state.sends[1]);
    gate.resolve(result(true, '1')); await Promise.all([work, retry]); assert.equal(f.map.has(f.key), false);
  });
  await test('older response cleanup cannot delete newer saved intent', async () => {
    const f = fixture(), gate = deferred(); f.state.send = () => gate.promise;
    const model = await ready(f); const work = model.change(true); await settle();
    const newer = JSON.stringify({ version: 1, namespace: f.namespace, ...f.options, pending: { blocked: false, expectedRevision: '1' } });
    f.map.set(f.key, newer); gate.resolve(result(true, '1')); await work;
    assert.equal(f.map.get(f.key), newer);
    await model.refresh(); assert.deepEqual(plain(model.getState().pending), { blocked: false, expectedRevision: '1' });
  });
  await test('blur during durable save suppresses dispatch and leaves safe restored intent', async () => {
    const f = fixture(), gate = deferred(); f.state.beforeWrite = () => gate.promise;
    const model = await ready(f); const work = model.change(true); await settle(); model.setActive(false); gate.resolve(); await work;
    assert.equal(f.state.sends.length, 0); assert.equal(f.map.has(f.key), true);
    model.setActive(true); f.state.beforeWrite = null; await model.refresh(); await model.retry(); assert.equal(f.state.sends.length, 1);
  });
  await test('disposed and blurred screens suppress late result publication', async () => {
    for (const close of [model => model.dispose(), model => model.setActive(false)]) {
      const f = fixture(), gate = deferred(); f.state.send = () => gate.promise;
      const model = await ready(f); let emissions = 0; model.subscribe(() => { emissions++; });
      const work = model.change(true); await settle(); close(model); const afterClose = emissions;
      gate.resolve(result(true, '1')); await work; assert.equal(emissions, afterClose); assert.notEqual(model.getState().data?.blocked_by_me, true);
    }
  });
  await test('out-of-order loads cannot replace a newer block snapshot', async () => {
    const f = fixture(), old = deferred(), current = deferred(); let calls = 0;
    f.state.load = () => ++calls === 1 ? old.promise : current.promise;
    const model = f.create(); const first = model.refresh(); await settle(); const second = model.refresh(); await settle();
    current.resolve(result(true, '3')); await second; old.resolve(result(false, '0')); await first;
    assert.deepEqual(plain(model.getState().data), result(true, '3'));
  });
  console.log(`Student block client/model: ${checks} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
