/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const id = n => `a4140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function load(file, modules, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, ...globals, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return exports;
}
const reports = load('src/lib/safetyReports.ts', { './offers': {}, './supabase': {} });
const when = '2026-11-11T10:20:30.123456+00:00';
const summary = () => ({ report_id: id(2), target_type: 'message', reason: 'spam', created_at: when, triage_status: 'new', triage_version: 0 });
const attempt = () => ({ reportId: id(2), operationId: id(3), expectedVersion: 0, status: 'reviewing', note: 'Reviewed submitted evidence.' });
const receipt = input => ({ report_id: input.reportId, decision_id: id(4), triage_status: input.status, triage_version: input.expectedVersion + 1, created_at: when });
function client() {
  const state = { user: id(1), token: 'one', calls: [], data: { role: 'moderator' }, error: null, before: null };
  const api = load('src/lib/moderation.ts', {
    './safetyReports': reports,
    './offers': { assertOfferSession: async user => { if (user !== state.user) throw Error('private auth'); return { access_token: state.token }; } },
    './supabase': { supabase: { rpc: (name, args) => ({ setHeader: (header, value) => ({ abortSignal: async signal => {
      state.calls.push({ name, args: plain(args), header, value, signal });
      await state.before?.(signal);
      return { data: state.data, error: state.error };
    } }) }) } },
  }, { AbortController, setTimeout, clearTimeout });
  return { state, api };
}
const code = expected => error => error.code === expected;
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
let serial = 0;
function draftFixture() {
  const { api } = client();
  const modelApi = load('src/lib/moderationDecision.ts', {
    './moderation': api, './safetyReports': reports, './env': { env: { supabaseUrl: 'https://default.test' } },
    '@react-native-async-storage/async-storage': { default: {} },
  });
  const map = new Map(), sends = [];
  const state = { beforeWrite: null, beforeRemove: null, beforeRead: null, send: null, ids: 0 };
  const deps = { namespace: 'https://moderation-' + (++serial) + '.test', randomUUID: () => id(100 + (++state.ids)),
    storage: {
      async getItem(key) { await state.beforeRead?.(); return map.get(key) ?? null; },
      async setItem(key, raw) { await state.beforeWrite?.(); map.set(key, raw); },
      async removeItem(key) { await state.beforeRemove?.(); map.delete(key); },
    },
    async send(user, input) { sends.push(plain({ user, input })); assert.ok(map.size, 'persist before RPC'); return state.send ? state.send(user, input) : receipt(input); },
  };
  const key = modelApi.decisionKey(deps.namespace, id(1), id(2));
  return { map, state, sends, deps, key, create: (user = id(1), report = id(2), patch = {}) => modelApi.createModerationDecision(user, report, { ...deps, ...patch }) };
}
async function ready(f) { const model = f.create(); await model.restore(); return model; }
const fields = () => ({ expectedVersion: 0, status: 'reviewing', note: '  Reviewed submitted evidence.  ' });
(async () => {
  await test('role, list and decision calls use the current account bearer token', async () => {
    const { api, state } = client();
    assert.equal(await api.getModerationAccess(id(1)), 'moderator');
    state.data = [summary()];
    assert.deepEqual(plain(await api.listModerationReports(id(1), 'new', { report_id: id(8), created_at: when })), [summary()]);
    assert.equal(state.calls[1].args.p_before_created_at, when, 'preserve cursor microseconds');
    state.data = receipt(attempt());
    assert.deepEqual(plain(await api.recordModerationDecision(id(1), attempt())), receipt(attempt()));
    assert.ok(state.calls.every(call => call.header === 'Authorization' && call.value === 'Bearer one'));
  });
  await test('malformed decision, cursor and role responses fail closed', async () => {
    const { api, state } = client();
    for (const patch of [{ expectedVersion: -1 }, { status: 'ban' }, { note: 'short' }, { note: 'a'.repeat(2001) }, { operationId: 'bad' }]) {
      await assert.rejects(api.recordModerationDecision(id(1), { ...attempt(), ...patch }), code('CC_MOD_INPUT'));
    }
    await assert.rejects(api.listModerationReports(id(1), 'new', { report_id: 'bad', created_at: when }), code('CC_MOD_INPUT'));
    assert.equal(state.calls.length, 0);
    for (const data of [{ role: 'student' }, {}, null, []]) { state.data = data; await assert.rejects(api.getModerationAccess(id(1))); }
  });
  await test('queue excludes additional transport fields and rejects duplicate IDs or mixed statuses', async () => {
    const { api, state } = client();
    state.data = [{ ...summary(), evidence: 'private', reporter_id: id(8) }];
    assert.deepEqual(plain(await api.listModerationReports(id(1), 'new')), [summary()]);
    for (const data of [[summary(), summary()], [{ ...summary(), triage_status: 'dismissed' }], {}, Array(21).fill(summary())]) {
      state.data = data; await assert.rejects(api.listModerationReports(id(1), 'new'));
    }
  });
  await test('all four evidence types whitelist only scalar snapshot fields', async () => {
    const { api, state } = client();
    for (const [target_type, evidence, expected] of [
      ['student', { display_name: 'Person' }, ['Person']],
      ['request', { title: 'Job', description: 'Help', points: 5, category: 'pickup', status: 'open' }, ['Job', 'Help', 'pickup', '5', 'open']],
      ['message', { body: '<b>Untrusted text</b>', created_at: when }, ['<b>Untrusted text</b>', when]],
      ['course_review', { course_code: 'CMPT 120', term_name: 'Fall 2026', difficulty: 4, workload: 5, comment: 'Comment', tips: 'Tips', instructor: 'Instructor', created_at: when }, ['CMPT 120', 'Fall 2026', '4/5', '5/5', 'Comment', 'Tips', 'Instructor', when]],
    ]) {
      state.data = { ...summary(), target_type, details: 'Report', history: [], evidence: { ...evidence, author_id: id(9), email: 'private', extra: {} }, reporter_id: id(8) };
      const result = await api.getModerationReport(id(1), id(2));
      assert.deepEqual(plain(result.evidence.map(item => item.value)), expected);
      assert.equal(JSON.stringify(result).includes(id(8)), false); assert.equal(JSON.stringify(result).includes(id(9)), false);
    }
  });
  await test('history and receipts do not forward identities and malformed receipts remain unconfirmed', async () => {
    const { api, state } = client();
    const item = { decision_id: id(4), from_status: 'new', to_status: 'reviewing', version: 1, note: 'Reviewed evidence', created_at: when, is_mine: true };
    state.data = { ...summary(), details: '', evidence: {}, history: [{ ...item, moderator_id: id(9) }] };
    assert.deepEqual(plain((await api.getModerationReport(id(1), id(2))).history), [item]);
    for (const patch of [{ report_id: id(9) }, { triage_version: 3 }, { triage_status: 'dismissed' }, { created_at: null }]) {
      state.data = { ...receipt(attempt()), ...patch }; await assert.rejects(api.recordModerationDecision(id(1), attempt()));
    }
  });
  await test('older review reports explicitly identify scores not captured in the snapshot', async () => {
    const { api, state } = client();
    state.data = { ...summary(), target_type: 'course_review', details: '', evidence: { difficulty: 99 }, history: [] };
    const fields = (await api.getModerationReport(id(1), id(2))).evidence;
    assert.deepEqual(plain(fields), [{ label: 'Difficulty', value: 'Not captured in this report' }, { label: 'Workload', value: 'Not captured in this report' }]);
  });
  await test('account and session changes suppress private late responses', async () => {
    for (const change of [state => { state.user = id(8); }, state => { state.token = 'replacement'; }]) {
      const { api, state } = client(); state.before = () => change(state);
      await assert.rejects(api.getModerationAccess(id(1)), code('CC_MOD_SESSION'));
    }
    const { api, state } = client(); state.user = null;
    await assert.rejects(api.getModerationAccess(id(1)), code('CC_MOD_SESSION')); assert.equal(state.calls.length, 0);
  });
  await test('server errors expose codes without database details', async () => {
    const { api, state } = client();
    for (const errorCode of ['42501', 'PT409', '22023', 'XX000']) {
      state.error = { code: errorCode, message: 'secret database detail' };
      await assert.rejects(api.getModerationAccess(id(1)), error => error.code === errorCode && !error.message.includes('secret'));
    }
  });
  await test('decisions persist before sending and successful cleanup removes only their pending copy', async () => {
    const f = draftFixture(), model = await ready(f); await model.submit(fields());
    assert.equal(f.sends.length, 1); assert.equal(f.sends[0].input.note, fields().note.trim());
    assert.equal(model.getState().receipt.triage_version, 1); assert.equal(f.map.size, 0);
    await model.submit(fields()); assert.equal(f.sends.length, 1);
  });
  await test('lost responses survive restart with the same operation and frozen payload', async () => {
    const f = draftFixture(), model = await ready(f); f.state.send = () => { throw Error('offline'); };
    await model.submit(fields()); const raw = f.map.get(f.key); model.dispose();
    const restored = await ready(f); f.state.send = null;
    await restored.submit({ ...fields(), status: 'dismissed', note: 'This edit must be ignored.' });
    assert.deepEqual(f.sends[0], f.sends[1]); assert.equal(f.state.ids, 1); assert.equal(f.map.size, 0);
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['attempt', 'namespace', 'reportId', 'userId', 'version']);
  });
  await test('other accounts, backends and reports cannot restore a pending decision', async () => {
    const f = draftFixture(), model = await ready(f); f.state.send = () => { throw Error('lost'); }; await model.submit(fields());
    for (const other of [f.create(id(9)), f.create(id(1), id(8)), f.create(id(1), id(2), { namespace: 'https://other.test' })]) {
      await other.restore(); assert.equal(other.getState().pending, null);
    }
  });
  await test('failed storage blocks dispatch and corrupt/cross-account saved data cannot be reused', async () => {
    const f = draftFixture(), model = await ready(f);
    f.state.beforeWrite = () => { throw Error('disk'); }; await model.submit(fields()); assert.equal(f.sends.length, 0);
    f.map.set(f.key, JSON.stringify({ version: 1, namespace: f.deps.namespace, userId: id(9), reportId: id(2), attempt: attempt() }));
    const next = f.create(); await next.restore(); assert.equal(next.getState().ready, false); await next.submit(fields()); assert.equal(f.sends.length, 0);
  });
  await test('rapid submit and overlapping screens reuse one saved operation', async () => {
    const f = draftFixture(), one = await ready(f), two = await ready(f); const gate = deferred();
    f.state.send = async (_user, input) => { await gate.promise; return receipt(input); };
    const first = one.submit(fields()); void one.submit(fields()); const second = two.submit({ ...fields(), status: 'dismissed' });
    await tick(); gate.resolve(); await Promise.all([first, second]);
    assert.equal(f.sends.length, 2); assert.deepEqual(f.sends[0], f.sends[1]); assert.equal(f.state.ids, 1);
  });
  await test('leaving during persistence suppresses dispatch but retains a recoverable attempt', async () => {
    const f = draftFixture(), model = await ready(f); const gate = deferred(); f.state.beforeWrite = () => gate.promise;
    const operation = model.submit(fields()); await tick(); model.dispose(); gate.resolve(); await operation;
    assert.equal(f.sends.length, 0); assert.ok(f.map.has(f.key));
  });
  await test('a late success cannot erase a newer attempt from another screen', async () => {
    const f = draftFixture(), model = await ready(f); const gate = deferred();
    f.state.send = async (_user, input) => { await gate.promise; return receipt(input); };
    const operation = model.submit(fields()); await tick(); model.dispose();
    const newer = JSON.parse(f.map.get(f.key)); newer.attempt.operationId = id(999);
    const raw = JSON.stringify(newer); f.map.set(f.key, raw); gate.resolve(); await operation;
    assert.equal(f.map.get(f.key), raw);
  });
  await test('cleanup failure keeps a safe exact retry after restart', async () => {
    const f = draftFixture(), model = await ready(f); f.state.beforeRemove = () => { throw Error('disk'); };
    await model.submit(fields()); assert.ok(model.getState().receipt); assert.ok(f.map.has(f.key));
    f.state.beforeRemove = null; const next = await ready(f); await next.submit(); assert.deepEqual(f.sends[0], f.sends[1]);
  });
  await test('only a definitive conflict allows replacing the pending decision', async () => {
    const f = draftFixture(), model = await ready(f); f.state.send = () => { throw Error('unknown'); };
    await model.submit(fields()); assert.equal(await model.clearConflict(), false);
    f.state.send = () => { throw Object.assign(Error('conflict'), { code: 'PT409' }); }; await model.submit();
    assert.equal(model.getState().conflict, true); await model.submit(fields()); assert.equal(f.sends.length, 2);
    assert.equal(await model.clearConflict(), true); assert.equal(f.map.size, 0);
    f.state.send = null; await model.submit({ ...fields(), expectedVersion: 1 }); assert.equal(f.sends[2].input.expectedVersion, 1);
    assert.notEqual(f.sends[0].input.operationId, f.sends[2].input.operationId);
  });
  await test('stale conflict cleanup cannot remove another screen’s saved operation', async () => {
    const f = draftFixture(), model = await ready(f); f.state.send = () => { throw Object.assign(Error(), { code: 'PT409' }); };
    await model.submit(fields()); const newer = JSON.parse(f.map.get(f.key)); newer.attempt.operationId = id(999);
    const raw = JSON.stringify(newer); f.map.set(f.key, raw);
    assert.equal(await model.clearConflict(), false); assert.equal(f.map.get(f.key), raw);
  });
  await test('access revocation stops further dispatch and retains only the account’s pending decision', async () => {
    const f = draftFixture(), model = await ready(f); f.state.send = () => { throw Object.assign(Error(), { code: '42501' }); };
    await model.submit(fields()); assert.equal(model.getState().accessLost, true); await model.submit();
    assert.equal(f.sends.length, 1); assert.ok(f.map.has(f.key));
  });
  console.log(`Moderation client and decision checks passed: ${checks}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
