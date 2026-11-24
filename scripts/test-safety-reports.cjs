/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/safetyReports.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const uid = n => `a4140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const input = () => ({ operationId: uid(3), targetType: 'student', targetId: uid(2), reason: 'spam', details: '  Repeated unwanted invitations.  ' });
const receipt = () => ({ report_id: uid(4), created_at: '2026-11-04T00:00:00.123456+00:00' });
function client() {
  const state = { account: uid(1), calls: [], sessionCalls: 0, response: receipt(), error: null, execute: null, thrown: null };
  const api = {};
  vm.runInNewContext(source, { exports: api, require: name => {
    if (name === './offers') return { assertOfferSession: async expected => {
      state.sessionCalls++;
      if (expected !== state.account) throw Error('raw auth detail');
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
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('report submission pins the account and sends only canonical public input', async () => {
    const { state, api } = client();
    const result = await api.submitSafetyReport(uid(1), { ...input(), operationId: uid(3).toUpperCase(), targetId: uid(2).toUpperCase(), reporter_id: uid(9) });
    assert.deepEqual(plain(result), receipt());
    assert.equal(state.sessionCalls, 2);
    assert.deepEqual(state.calls, [{ name: 'submit_safety_report', args: { p_operation_id: uid(3), p_target_type: 'student', p_target_id: uid(2), p_reason: 'spam', p_details: 'Repeated unwanted invitations.' }, header: 'Authorization', value: 'Bearer token-' + uid(1) }]);
  });
  await test('invalid input is rejected before reading a session or dispatching a report', async () => {
    const { state, api } = client();
    for (const patch of [{ operationId: '' }, { targetId: 'not-a-uuid' }, { targetType: 'group' }, { reason: 'made-up' }, { details: null }, { details: 'x'.repeat(2001) }, { reason: 'other', details: ' short ' }]) {
      await assert.rejects(api.submitSafetyReport(uid(1), { ...input(), ...patch }));
    }
    assert.equal(state.calls.length, 0);
    assert.equal(state.sessionCalls, 0);
    assert.equal(api.validateReportFields('spam', '🙂'.repeat(2000)), null);
    assert.equal(api.validateReportFields('other', '🙂'.repeat(10)), null);
    assert.match(api.validateReportFields('other', '🙂'.repeat(9)), /10 characters/);
  });
  await test('sign-out and changed accounts block dispatch and late success', async () => {
    const { state, api } = client();
    state.account = null;
    await assert.rejects(api.submitSafetyReport(uid(1), input()), /session unavailable/);
    state.account = uid(2);
    await assert.rejects(api.submitSafetyReport(uid(1), input()), /session unavailable/);
    assert.equal(state.calls.length, 0);
    state.account = uid(1);
    state.execute = () => { state.account = uid(2); };
    await assert.rejects(api.submitSafetyReport(uid(1), input()), /session unavailable/);
  });
  await test('receipt exposes only its id and timestamp; malformed success stays unconfirmed', async () => {
    const { state, api } = client();
    state.response = { ...receipt(), reporter_id: uid(1), moderator_notes: 'private', email: 'private' };
    assert.deepEqual(plain(await api.submitSafetyReport(uid(1), input())), receipt());
    for (const response of [null, {}, { report_id: 'not-an-id', created_at: receipt().created_at }, { report_id: uid(4), created_at: 'invalid' }]) {
      state.response = response;
      await assert.rejects(api.submitSafetyReport(uid(1), input()), /Unable to confirm/);
    }
  });
  await test('backend and transport details never reach the user-facing error', async () => {
    const { state, api } = client();
    for (const [code, expected] of [['42501', /unavailable to your account/], ['54000', /report limit/], ['22023', /saved details/], ['XX000', /Unable to confirm/]]) {
      state.error = { code, message: 'secret database name and query' };
      await assert.rejects(api.submitSafetyReport(uid(1), input()), error => expected.test(error.message) && !error.message.includes('secret'));
    }
    state.error = null; state.thrown = Error('secret transport details');
    await assert.rejects(api.submitSafetyReport(uid(1), input()), /Unable to confirm/);
    assert.ok(!api.safetyReportError({ message: 'secret' }).includes('secret'));
  });
  await test('retries preserve the operation and exact normalized body', async () => {
    const { state, api } = client();
    state.error = { code: 'fetch' };
    await assert.rejects(api.submitSafetyReport(uid(1), input()));
    state.error = null;
    await api.submitSafetyReport(uid(1), input());
    assert.deepEqual(state.calls[0], state.calls[1]);
  });
  await test('message and review submissions use the same private intake and frozen retry payload', async () => {
    for (const targetType of ['message', 'course_review']) {
      const { state, api } = client();
      state.error = { code: 'fetch' };
      const attempt = { ...input(), targetType };
      await assert.rejects(api.submitSafetyReport(uid(1), attempt));
      state.error = null;
      assert.deepEqual(plain(await api.submitSafetyReport(uid(1), attempt)), receipt());
      assert.equal(state.calls[0].name, 'submit_safety_report');
      assert.equal(state.calls[0].args.p_target_type, targetType);
      assert.deepEqual(state.calls[0], state.calls[1]);
    }
  });
  await test('content target context pins the account and strips unexpected author or content fields', async () => {
    for (const targetType of ['message', 'course_review']) {
      const { state, api } = client();
      const expected = { target_type: targetType, target_id: uid(2), target_label: targetType === 'message' ? 'Direct message' : 'CMPT 120 course review' };
      state.response = { ...expected, author_id: uid(8), body: 'private content', email: 'private@example.test' };
      assert.deepEqual(plain(await api.getSafetyReportTarget(uid(1), targetType, uid(2).toUpperCase())), expected);
      assert.equal(state.sessionCalls, 2);
      assert.deepEqual(state.calls[0], { name: 'get_safety_report_target', args: { p_target_type: targetType, p_target_id: uid(2) }, header: 'Authorization', value: 'Bearer token-' + uid(1) });
      state.execute = () => { state.account = uid(7); };
      await assert.rejects(api.getSafetyReportTarget(uid(1), targetType, uid(2)), /session unavailable/);
    }
  });
  await test('target context rejects wrong scope, malformed output, invalid input and stale accounts', async () => {
    const { state, api } = client();
    const valid = { target_type: 'message', target_id: uid(2), target_label: 'Direct message' };
    for (const response of [null, [], {}, { ...valid, target_type: 'course_review' }, { ...valid, target_id: uid(8) }, { ...valid, target_label: null }, { ...valid, target_label: '' }]) {
      state.response = response;
      await assert.rejects(api.getSafetyReportTarget(uid(1), 'message', uid(2)));
    }
    const calls = state.calls.length;
    for (const [type, id] of [['student', uid(2)], ['group', uid(2)], ['message', 'invalid']]) {
      await assert.rejects(api.getSafetyReportTarget(uid(1), type, id));
    }
    state.account = uid(7);
    await assert.rejects(api.getSafetyReportTarget(uid(1), 'message', uid(2)), /session unavailable/);
    assert.equal(state.calls.length, calls);
    state.account = uid(1); state.error = { code: '42501', message: 'secret author details' };
    await assert.rejects(api.getSafetyReportTarget(uid(1), 'message', uid(2)), error => error.code === '42501' && !error.message.includes('secret'));
  });
  console.log(`Safety report client: ${checks} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
