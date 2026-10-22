/* global __dirname */
// Exercise the real assignment-history client with controlled Auth/PostgREST responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const messagesCode = compile('src/lib/messages.ts');
const assignmentCode = compile('src/lib/requestConversations.ts');
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const REQUEST = 'd0000000-0000-4000-8000-000000000004';
const row = (overrides = {}) => ({ request_id: REQUEST, offer_round: 4, poster_id: A, helper_id: B, status: 'released', ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const codeIs = code => error => error.code === code;
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
function client(rows = [row()]) {
  const state = {
    session: { user: { id: A }, access_token: 'original-token' }, calls: [], sessionCalls: 0,
    data: rows, error: null, onExecute: null, onFrom: null, onSession: null,
  };
  const supabase = {
    auth: { getSession: async () => {
      state.sessionCalls++;
      if (state.onSession) await state.onSession(state);
      return { data: { session: state.session }, error: null };
    } },
    from: table => {
      state.calls.push(['from', table]);
      if (state.onFrom) state.onFrom(state);
      const query = {};
      for (const name of ['select', 'eq', 'order', 'limit', 'lt']) {
        query[name] = (...args) => { state.calls.push([name, ...plain(args)]); return query; };
      }
      query.setHeader = async (...args) => {
        state.calls.push(['setHeader', ...args]);
        if (state.onExecute) return state.onExecute(state);
        return { data: state.data, error: state.error };
      };
      return query;
    },
  };
  const messages = {}, api = {};
  vm.runInNewContext(messagesCode, { exports: messages, Error, require: name => {
    assert.equal(name, './supabase'); return { supabase };
  } });
  vm.runInNewContext(assignmentCode, { exports: api, Error, require: name => {
    if (name === './supabase') return { supabase };
    assert.equal(name, './messages'); return messages;
  } });
  return { api, state };
}
(async () => {
  await test('minimal RLS query pins credentials before a query builder can observe a changed token', async () => {
    const { api, state } = client();
    state.onFrom = value => { value.session.access_token = 'changed-token'; };
    const result = await api.loadRequestConversationAssignments(A.toUpperCase(), REQUEST.toUpperCase(), 7);
    assert.deepEqual(plain(result), { items: [row()], hasMore: false, nextRound: null });
    assert.deepEqual(state.calls, [
      ['from', 'request_point_reservations'], ['select', 'request_id,offer_round,poster_id,helper_id,status'],
      ['eq', 'request_id', REQUEST], ['order', 'offer_round', { ascending: false }], ['limit', 20],
      ['lt', 'offer_round', 7], ['setHeader', 'Authorization', 'Bearer original-token'],
    ]);
    assert.equal(state.sessionCalls, 2);
  });
  await test('full pages expose a strict older-round cursor and project away private extras', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => row({ offer_round: 30 - index, private_field: 'not exposed' }));
    const { api, state } = client(rows);
    const page = await api.loadRequestConversationAssignments(A, REQUEST);
    assert.equal(page.items.length, 20);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextRound, 11);
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['helper_id', 'offer_round', 'poster_id', 'request_id', 'status']);
    assert.ok(!state.calls.some(call => call[0] === 'lt'));
    state.data = [];
    assert.deepEqual(plain(await api.loadRequestConversationAssignments(A, REQUEST, page.nextRound)), { items: [], hasMore: false, nextRound: null });
  });
  await test('invalid identity and pagination arguments never reach the database', async () => {
    const { api, state } = client();
    for (const bad of [0, -1, 1.5, NaN, Infinity, '4', 2147483648]) {
      await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST, bad), codeIs('INVALID_INPUT'));
    }
    await assert.rejects(api.loadRequestConversationAssignments('demo', REQUEST), codeIs('INVALID_INPUT'));
    await assert.rejects(api.loadRequestConversationAssignments(A, 'demo'), codeIs('INVALID_INPUT'));
    assert.equal(state.calls.length, 0);
  });
  await test('account mismatch or missing session blocks even a read before it starts', async () => {
    const { api, state } = client();
    await assert.rejects(api.loadRequestConversationAssignments(B, REQUEST), codeIs('ACCOUNT_CHANGED'));
    state.session = null;
    await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST), codeIs('ACCOUNT_CHANGED'));
    assert.equal(state.calls.length, 0);
  });
  await test('account switches discard successful and failed in-flight responses', async () => {
    for (const throws of [false, true]) {
      const { api, state } = client();
      state.onExecute = value => {
        value.session = { user: { id: B }, access_token: 'new-account-token' };
        if (throws) throw Error('private transport diagnostic');
        return { data: [row()], error: null };
      };
      await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST), codeIs('ACCOUNT_CHANGED'));
    }
  });
  await test('foreign participants, foreign requests, self assignments and malformed states are rejected', async () => {
    const badRows = [row({ poster_id: B, helper_id: C }), row({ request_id: C }), row({ helper_id: A }),
      row({ status: 'pending' }), row({ offer_round: '4' }), row({ offer_round: 0 }), row({ offer_round: 2147483648 }),
      row({ poster_id: 'legacy' }), null];
    for (const value of badRows) {
      const { api } = client([value]);
      await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST), codeIs('INVALID_RESPONSE'));
    }
    const { api } = client([row({ poster_id: B, helper_id: A, status: 'settled' })]);
    assert.equal((await api.loadRequestConversationAssignments(A, REQUEST)).items[0].helper_id, A);
  });
  await test('duplicate, ascending and out-of-cursor rounds cannot produce history links', async () => {
    for (const rows of [[row(), row()], [row(), row({ offer_round: 5 })], Array.from({ length: 21 }, (_, index) => row({ offer_round: 30 - index }))]) {
      const { api } = client(rows);
      await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST), codeIs('INVALID_RESPONSE'));
    }
    const { api } = client();
    await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST, 4), codeIs('INVALID_RESPONSE'));
  });
  await test('database and transport details are sanitized while preserving retryable error codes', async () => {
    for (const transport of [false, true]) {
      const { api, state } = client();
      state.error = { message: 'private database detail' };
      if (transport) state.onExecute = () => { throw Error('private transport detail'); };
      await assert.rejects(api.loadRequestConversationAssignments(A, REQUEST), error => error.code === 'ASSIGNMENTS_UNAVAILABLE' && !error.message.includes('private'));
      assert.equal(state.sessionCalls, 2);
    }
  });
  console.log('Assignment history client checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
