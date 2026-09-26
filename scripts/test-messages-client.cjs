/* global __dirname */
// Exercise the real typed client with deterministic Auth/PostgREST doubles. No network or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const compiled = ts.transpileModule(fs.readFileSync(root + '/src/lib/messages.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const CHAT = '30000000-0000-4000-8000-000000000003';
const OTHER_CHAT = '30000000-0000-4000-8000-000000000004';
const REQUEST = '40000000-0000-4000-8000-000000000004';
const CLIENT = '50000000-0000-4000-8000-000000000005';
const MESSAGE = '60000000-0000-4000-8000-000000000006';
const EARLIER_MESSAGE = '60000000-0000-4000-8000-000000000005';
const TIME = '2026-09-26T12:34:56.123456+00:00';
const HUGE = '9007199254740993';
const MAX = '9223372036854775807';
const plain = value => JSON.parse(JSON.stringify(value));
const session = (id = A, token = 'initial-access-token') => ({ user: { id }, access_token: token });
const summary = (overrides = {}) => ({
  id: CHAT, type: 'direct', status: 'active', other_profile_id: B, other_display_name: null,
  last_message_body: null, last_message_at: null, last_activity_at: TIME,
  last_message_sequence: '0', last_read_sequence: '0', unread_count: 0, created_at: TIME,
  ...overrides,
});
const message = (overrides = {}) => ({
  id: MESSAGE, conversation_id: CHAT, sender_id: A, client_message_id: CLIENT,
  sequence: HUGE, body: 'Hello', created_at: TIME, ...overrides,
});
let checks = 0;
async function test(name, run) {
  await run();
  checks += 1;
  console.log('PASS ' + name);
}
function client(initialResponse = null) {
  const state = {
    session: session(), authCalls: 0, calls: [], response: initialResponse,
    authError: null, rpcError: null, onSession: null, onRpc: null, onExecute: null,
  };
  const supabase = {
    auth: { getSession: async () => {
      state.authCalls += 1;
      if (state.onSession) await state.onSession(state);
      return { data: { session: state.session }, error: state.authError };
    } },
    rpc: (name, args) => {
      if (state.onRpc) state.onRpc(state);
      return { setHeader: async (header, value) => {
        const call = { name, args: plain(args), header, value };
        state.calls.push(call);
        if (state.onExecute) return state.onExecute(call, state);
        return { data: state.response, error: state.rpcError };
      } };
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Error,
    require: name => {
      assert.equal(name, './supabase');
      return { supabase };
    },
  }, { filename: 'messages.ts' });
  return { api: exports, state };
}
const codeIs = code => error => error.code === code;

(async () => {
  await test('all RPC names, arguments and explicit authorization headers match the contract', async () => {
    const { api, state } = client(CHAT);
    assert.equal(await api.startDirectConversation(A.toUpperCase(), B.toUpperCase()), CHAT);
    assert.equal(await api.openRequestConversation(A, REQUEST, 7), CHAT);
    state.response = summary();
    assert.deepEqual(plain(await api.loadConversationSummary(A, CHAT)), summary());
    state.response = [];
    await api.loadConversationPage(A);
    await api.loadMessagePage(A, CHAT);
    state.response = message();
    assert.deepEqual(plain(await api.sendMessage(A, { conversationId: CHAT, clientMessageId: CLIENT, body: 'Hello' })), message());
    state.response = HUGE;
    assert.equal(await api.markConversationRead(A, CHAT, HUGE), HUGE);
    assert.deepEqual(state.calls.map(({ name, args }) => ({ name, args })), [
      { name: 'start_direct_conversation', args: { p_other_profile_id: B } },
      { name: 'open_request_conversation', args: { p_request_id: REQUEST, p_offer_round: 7 } },
      { name: 'get_conversation_summary', args: { p_conversation_id: CHAT } },
      { name: 'get_my_conversations', args: { p_limit: 20, p_before_activity_at: null, p_before_id: null } },
      { name: 'get_conversation_messages', args: { p_conversation_id: CHAT, p_before_sequence: null, p_limit: 30 } },
      { name: 'send_conversation_message', args: { p_conversation_id: CHAT, p_client_message_id: CLIENT, p_body: 'Hello' } },
      { name: 'mark_conversation_read', args: { p_conversation_id: CHAT, p_through_sequence: HUGE } },
    ]);
    for (const call of state.calls) {
      assert.equal(call.header, 'Authorization');
      assert.equal(call.value, 'Bearer initial-access-token');
    }
    assert.equal(state.authCalls, state.calls.length * 2);
  });

  await test('inbox cursor preserves timestamp precision and ID; short and empty pages end pagination', async () => {
    const { api, state } = client([summary(), summary({ id: OTHER_CHAT })]);
    const page = await api.loadConversationPage(A, { limit: 2 });
    assert.equal(page.hasMore, true);
    assert.deepEqual(plain(page.nextCursor), { activityAt: TIME, id: OTHER_CHAT });
    state.response = [summary({ id: REQUEST })];
    const last = await api.loadConversationPage(A, { limit: 2, before: page.nextCursor });
    assert.deepEqual(state.calls[1].args, { p_limit: 2, p_before_activity_at: TIME, p_before_id: OTHER_CHAT });
    assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null);
    state.response = [];
    assert.deepEqual(plain(await api.loadConversationPage(A)), { items: [], hasMore: false, nextCursor: null });
  });

  await test('message cursors above MAX_SAFE_INTEGER and up to bigint maximum stay exact strings', async () => {
    const { api, state } = client([message({ sequence: MAX }), message({ id: EARLIER_MESSAGE })]);
    const page = await api.loadMessagePage(A, CHAT, { limit: 2 });
    assert.equal(page.items[0].sequence, MAX);
    assert.equal(page.items[1].sequence, HUGE);
    assert.equal(page.nextCursor, HUGE); assert.equal(page.hasMore, true);
    state.response = [message({ sequence: '9007199254740992' })];
    const last = await api.loadMessagePage(A, CHAT, { limit: 2, beforeSequence: page.nextCursor });
    assert.equal(state.calls[1].args.p_before_sequence, HUGE);
    assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null);
    state.response = MAX;
    assert.equal(await api.markConversationRead(A, CHAT, HUGE), MAX);
    assert.equal(state.calls[2].args.p_through_sequence, HUGE);
    state.response = [];
    assert.deepEqual(plain(await api.loadMessagePage(A, CHAT)), { items: [], hasMore: false, nextCursor: null });
  });

  await test('invalid identities, self-chat, rounds, page bounds and partial cursors fail before any request', async () => {
    const { api, state } = client();
    const invalidCalls = [
      () => api.startDirectConversation(A, 'legacy-student-slug'),
      () => api.startDirectConversation(A, A.toUpperCase()),
      () => api.startDirectConversation('invalid-user', B),
      () => api.openRequestConversation(A, 'invalid', 1),
      ...[0, -1, 1.5, 2147483648, NaN].map(round => () => api.openRequestConversation(A, REQUEST, round)),
      () => api.loadConversationSummary(A, 'new'),
      ...[0, -1, 51, 1.5, NaN].flatMap(limit => [
        () => api.loadConversationPage(A, { limit }), () => api.loadMessagePage(A, CHAT, { limit }),
      ]),
      () => api.loadConversationPage(A, { before: { activityAt: TIME } }),
      () => api.loadConversationPage(A, { before: { id: CHAT } }),
      () => api.loadConversationPage(A, { before: { activityAt: 'invalid', id: CHAT } }),
      () => api.sendMessage(A, { conversationId: CHAT, clientMessageId: 'invalid', body: 'Hello' }),
    ];
    for (const run of invalidCalls) await assert.rejects(run, codeIs('INVALID_INPUT'));
    assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0);
  });

  await test('sequence inputs reject numbers, overflow, zero, negatives and noncanonical decimal strings', async () => {
    const { api, state } = client();
    for (const invalid of [9007199254740993, 1, '9223372036854775808', '0', '-1', '1.5', '01', '', '1e3', ' 1', '+1']) {
      await assert.rejects(() => api.markConversationRead(A, CHAT, invalid), codeIs('INVALID_INPUT'));
      await assert.rejects(() => api.loadMessagePage(A, CHAT, { beforeSequence: invalid }), codeIs('INVALID_INPUT'));
    }
    assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0);
  });

  await test('body validation counts Unicode code points, trims once and rejects empty or oversized messages', async () => {
    const { api, state } = client();
    const emojiBody = '😀'.repeat(4000);
    state.response = message({ body: emojiBody });
    assert.equal((await api.sendMessage(A, { conversationId: CHAT, clientMessageId: CLIENT, body: '\t ' + emojiBody + '\n ' })).body, emojiBody);
    assert.equal(state.calls[0].args.p_body, emojiBody);
    for (const body of ['', ' \t\n ', '😀'.repeat(4001), 'a'.repeat(4001), null]) {
      await assert.rejects(() => api.sendMessage(A, { conversationId: CHAT, clientMessageId: CLIENT, body }), codeIs('INVALID_INPUT'));
    }
    assert.equal(state.calls.length, 1);
  });

  await test('signed-out, switched and unavailable sessions never dispatch a message request', async () => {
    const { api, state } = client();
    state.session = null;
    await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('ACCOUNT_CHANGED'));
    state.session = session(B);
    await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('ACCOUNT_CHANGED'));
    state.session = session(); state.authError = { message: 'private-auth-internals' };
    await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('UNCONFIRMED'));
    state.onSession = () => { throw new Error('private-auth-exception'); };
    await assert.rejects(() => api.loadConversationSummary(A, CHAT), error => error.code === 'UNCONFIRMED' && !error.message.includes('private'));
    assert.equal(state.calls.length, 0);
  });

  await test('request pins the original credential even if account changes when its builder is created', async () => {
    const { api, state } = client(summary());
    state.onRpc = () => { state.session = session(B, 'other-account-token'); };
    await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('ACCOUNT_CHANGED'));
    assert.equal(state.calls[0].value, 'Bearer initial-access-token');
  });

  await test('in-flight account changes suppress successful data, returned errors and thrown network errors', async () => {
    for (const outcome of ['success', 'returned-error', 'thrown-error']) {
      const { api, state } = client();
      state.onExecute = async () => {
        await Promise.resolve();
        state.session = session(B);
        if (outcome === 'thrown-error') throw new Error('private-old-account-details');
        return { data: summary(), error: outcome === 'returned-error' ? { code: '42501', message: 'private-old-account-details' } : null };
      };
      await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('ACCOUNT_CHANGED'));
    }
    const { api, state } = client();
    state.onExecute = () => { state.session = null; throw new Error('network'); };
    await assert.rejects(() => api.loadMessagePage(A, CHAT), codeIs('ACCOUNT_CHANGED'));
  });

  await test('refreshing the same account token preserves the response while the outgoing token stays pinned', async () => {
    const { api, state } = client();
    state.onExecute = () => {
      state.session = session(A, 'refreshed-token');
      return { data: summary(), error: null };
    };
    assert.equal((await api.loadConversationSummary(A, CHAT)).id, CHAT);
    assert.equal(state.calls[0].value, 'Bearer initial-access-token');
  });

  await test('ambiguous committed send can retry the unchanged payload and client ID without generating another message', async () => {
    const { api, state } = client();
    const input = Object.freeze({ conversationId: CHAT, clientMessageId: CLIENT, body: '  Hello\n' });
    let committed = null;
    state.onExecute = (call) => {
      if (!committed) {
        committed = { args: call.args, row: message() };
        throw new Error('Response lost after commit');
      }
      assert.deepEqual(call.args, committed.args);
      return { data: committed.row, error: null };
    };
    await assert.rejects(() => api.sendMessage(A, input), codeIs('UNCONFIRMED'));
    const retried = await api.sendMessage(A, input);
    assert.equal(retried.id, MESSAGE);
    assert.deepEqual(state.calls[0].args, state.calls[1].args);
    assert.equal(input.body, '  Hello\n');
    assert.equal(input.clientMessageId, CLIENT);
  });

  await test('RPC errors expose safe actionable messages without raw backend fields or message contents', async () => {
    const { api, state } = client();
    for (const code of ['42501', '22023', '23505', '55000', 'XX000']) {
      state.rpcError = { code, message: 'private-message-body', details: 'private-SQL', hint: 'private-hint' };
      await assert.rejects(() => api.loadConversationSummary(A, CHAT), error => {
        assert.equal(error.code, code === 'XX000' ? 'UNCONFIRMED' : code);
        assert.equal(error.details, undefined); assert.equal(error.hint, undefined);
        assert.doesNotMatch(error.message, /private/);
        assert.equal(api.messagingError(error), error.message);
        if (code === '55000') assert.equal(error.message, 'This conversation is unavailable for new messages. Refresh to check its status.');
        return true;
      });
    }
    assert.doesNotMatch(api.messagingError(new Error('private-network-error')), /private/);
  });

  await test('response projection omits private extras and supports empty, closed and removed summaries', async () => {
    const { api, state } = client();
    for (const status of ['active', 'closed', 'removed']) {
      state.response = summary({ status, peer_last_read_sequence: HUGE, internal_private_value: 'hidden' });
      assert.deepEqual(plain(await api.loadConversationSummary(A, CHAT)), summary({ status }));
    }
    state.response = message({ private_value: 'hidden' });
    assert.deepEqual(plain(await api.sendMessage(A, { conversationId: CHAT, clientMessageId: CLIENT, body: 'Hello' })), message());
  });

  await test('malformed or mismatched summary/send responses fail closed instead of inventing fallback data', async () => {
    const { api, state } = client();
    for (const bad of [null, [], summary({ id: OTHER_CHAT }), summary({ other_profile_id: A }),
      summary({ last_message_sequence: 1 }), summary({ last_read_sequence: '01' }),
      summary({ unread_count: -1 }), summary({ type: 'group' }), summary({ created_at: 'invalid' }),
      summary({ other_display_name: undefined })]) {
      state.response = bad;
      await assert.rejects(() => api.loadConversationSummary(A, CHAT), codeIs('INVALID_RESPONSE'));
    }
    for (const bad of [null, message({ sequence: 9007199254740993 }), message({ sequence: '0' }),
      message({ conversation_id: OTHER_CHAT }), message({ sender_id: B }),
      message({ client_message_id: REQUEST }), message({ body: 'Different payload' })]) {
      state.response = bad;
      await assert.rejects(() => api.sendMessage(A, { conversationId: CHAT, clientMessageId: CLIENT, body: 'Hello' }), codeIs('INVALID_RESPONSE'));
    }
    state.response = 'invalid-id';
    await assert.rejects(() => api.startDirectConversation(A, B), codeIs('INVALID_RESPONSE'));
    state.response = 9007199254740993;
    await assert.rejects(() => api.markConversationRead(A, CHAT, HUGE), codeIs('INVALID_RESPONSE'));
  });

  await test('pages reject duplicate rows, excessive results, wrong conversation and nondecreasing sequences', async () => {
    const { api, state } = client();
    for (const bad of [null, {}, [summary(), summary()], [summary(), summary({ id: OTHER_CHAT })]]) {
      state.response = bad;
      await assert.rejects(() => api.loadConversationPage(A, { limit: 1 }), codeIs('INVALID_RESPONSE'));
    }
    state.response = [summary(), summary()];
    await assert.rejects(() => api.loadConversationPage(A, { limit: 2 }), codeIs('INVALID_RESPONSE'));
    for (const bad of [[message(), message()], [message(), message({ id: EARLIER_MESSAGE, sequence: MAX })],
      [message({ conversation_id: OTHER_CHAT })], [message(), message({ id: EARLIER_MESSAGE })]]) {
      state.response = bad;
      await assert.rejects(() => api.loadMessagePage(A, CHAT, { limit: 2 }), codeIs('INVALID_RESPONSE'));
    }
    state.response = [message()];
    await assert.rejects(() => api.loadMessagePage(A, CHAT, { beforeSequence: HUGE }), codeIs('INVALID_RESPONSE'));
  });
  console.log(`Messaging client: ${checks} checks passed.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
