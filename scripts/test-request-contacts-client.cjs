/* global __dirname */
// Real typed clients with controlled transport/session boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const R = 'd0000000-0000-4000-8000-000000000004';
const M = 'e0000000-0000-4000-8000-000000000005';
const row = patch => ({ profile_id: B, display_name: 'Student', major: 'Computing Science', year_of_study: 2, campus_display_name: 'Burnaby', ...patch });
const plain = value => JSON.parse(JSON.stringify(value));
const codeIs = code => error => error.code === code;
const messagesCode = compile('src/lib/messages.ts');
const contactsCode = compile('src/lib/requestContacts.ts');
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
function client(data = row()) {
  const state = { session: { user: { id: A }, access_token: 'original-token' }, sessionCalls: 0,
    data, error: null, calls: [], onRpc: null, onExecute: null };
  const supabase = {
    auth: { getSession: async () => { state.sessionCalls++; return { data: { session: state.session }, error: null }; } },
    rpc: (name, args) => {
      state.calls.push([name, plain(args)]);
      if (state.onRpc) state.onRpc(state);
      return { setHeader: async (...args) => {
        state.calls.push(args);
        if (state.onExecute) return state.onExecute(state);
        return { data: state.data, error: state.error };
      } };
    },
  };
  const messages = {}, contacts = {};
  vm.runInNewContext(messagesCode, { exports: messages, Error, require: name => {
    assert.equal(name, './supabase'); return { supabase };
  } });
  vm.runInNewContext(contactsCode, { exports: contacts, Error, require: name => {
    if (name === './supabase') return { supabase };
    assert.equal(name, './messages'); return messages;
  } });
  return { api: { ...messages, ...contacts }, state };
}
(async () => {
  await test('request identity uses exact context, pins bearer and projects only approved fields', async () => {
    const { api, state } = client(row({ email: 'never expose', is_discoverable: false }));
    state.onRpc = value => { value.session.access_token = 'changed-token'; };
    assert.deepEqual(plain(await api.loadRequestContact(A.toUpperCase(), R.toUpperCase(), B.toUpperCase())), {
      profileId: B, displayName: 'Student', major: 'Computing Science', yearOfStudy: 2, campusDisplayName: 'Burnaby',
    });
    assert.deepEqual(state.calls, [['get_request_contact', { p_request_id: R, p_other_profile_id: B }], ['Authorization', 'Bearer original-token']]);
    assert.equal(state.sessionCalls, 2);
  });
  await test('nullable basic fields remain absent without invented identity', async () => {
    const { api } = client(row({ major: null, year_of_study: null, campus_display_name: null }));
    const result = await api.loadRequestContact(A, R, B);
    assert.equal(result.major, null); assert.equal(result.yearOfStudy, null); assert.equal(result.campusDisplayName, null);
  });
  await test('request conversation creation returns only a validated conversation UUID', async () => {
    const { api, state } = client(M.toUpperCase());
    assert.equal(await api.startRequestContactConversation(A, R, B), M);
    assert.deepEqual(state.calls[0], ['start_request_contact_conversation', { p_request_id: R, p_other_profile_id: B }]);
    for (const malformed of [null, '', 'demo', { id: M }, [M]]) {
      state.data = malformed;
      await assert.rejects(api.startRequestContactConversation(A, R, B), codeIs('INVALID_RESPONSE'));
    }
  });
  await test('malformed IDs and self contact never reach the database', async () => {
    const { api, state } = client();
    for (const args of [[A, R, A], [A, 'demo', B], ['demo', R, B], [A, R, 'demo']]) {
      await assert.rejects(api.loadRequestContact(...args), codeIs('INVALID_INPUT'));
      await assert.rejects(api.startRequestContactConversation(...args), codeIs('INVALID_INPUT'));
    }
    assert.equal(state.calls.length, 0);
  });
  await test('identity mismatches and malformed profile responses are rejected', async () => {
    for (const value of [null, [], row({ profile_id: C }), row({ display_name: '' }), row({ display_name: ' ' }),
      row({ major: 1 }), row({ campus_display_name: 3 }), row({ year_of_study: 0 }), row({ year_of_study: 9 }), row({ year_of_study: '2' })]) {
      const { api } = client(value);
      await assert.rejects(api.loadRequestContact(A, R, B), codeIs('INVALID_RESPONSE'));
    }
  });
  await test('missing session and wrong account reject all three services before the request', async () => {
    for (const session of [null, { user: { id: B }, access_token: 'other-token' }]) {
      const { api, state } = client(); state.session = session;
      await assert.rejects(api.loadRequestContact(A, R, B), codeIs('ACCOUNT_CHANGED'));
      await assert.rejects(api.startRequestContactConversation(A, R, B), codeIs('ACCOUNT_CHANGED'));
      await assert.rejects(api.loadUnreadMessageCount(A), codeIs('ACCOUNT_CHANGED'));
      assert.equal(state.calls.length, 0);
    }
  });
  await test('account switches discard both successful and failed request contact responses', async () => {
    for (const method of ['loadRequestContact', 'startRequestContactConversation']) for (const failure of [false, true]) {
      const { api, state } = client(method === 'loadRequestContact' ? row() : M);
      state.onExecute = value => { value.session = { user: { id: C }, access_token: 'new-account-token' };
        if (failure) throw Error('private diagnostic'); return { data: value.data, error: null }; };
      await assert.rejects(api[method](A, R, B), codeIs('ACCOUNT_CHANGED'));
    }
  });
  await test('contact failures are safe and keep permission failures distinguishable', async () => {
    for (const code of ['42501', '22023', '50000']) {
      const { api, state } = client(); state.error = { code, message: 'private diagnostic' };
      await assert.rejects(api.loadRequestContact(A, R, B), error => error.code === (code === '50000' ? 'CONTACT_UNAVAILABLE' : code) && !error.message.includes('private'));
    }
    const { api, state } = client(); state.onExecute = () => { throw Error('private diagnostic'); };
    await assert.rejects(api.startRequestContactConversation(A, R, B), codeIs('CONTACT_UNAVAILABLE'));
  });
  await test('unread total accepts exact nonnegative counts without paginated inbox calls', async () => {
    const { api, state } = client(0);
    for (const count of [0, 1, 25, 105, Number.MAX_SAFE_INTEGER]) {
      state.data = count; assert.equal(await api.loadUnreadMessageCount(A), count);
    }
    assert.deepEqual(state.calls[0], ['get_my_unread_message_count', {}]);
    assert.ok(state.calls.every(call => ['get_my_unread_message_count', 'Authorization'].includes(call[0])));
  });
  await test('unread total rejects null, strings, fractions, negative and unsafe integers', async () => {
    const { api, state } = client();
    for (const value of [null, '2', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, [], { count: 2 }]) {
      state.data = value; await assert.rejects(api.loadUnreadMessageCount(A), codeIs('INVALID_RESPONSE'));
    }
  });
  await test('unread count pins credentials and rejects stale success and failure', async () => {
    for (const failure of [false, true]) {
      const { api, state } = client(7);
      state.onRpc = value => { value.session.access_token = 'mutated-token'; };
      state.onExecute = value => { value.session = { user: { id: B }, access_token: 'other-account' };
        if (failure) throw Error('transport'); return { data: 7, error: null }; };
      await assert.rejects(api.loadUnreadMessageCount(A), codeIs('ACCOUNT_CHANGED'));
      assert.deepEqual(state.calls[1], ['Authorization', 'Bearer original-token']);
    }
  });
  console.log('Request contact and total unread client checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
