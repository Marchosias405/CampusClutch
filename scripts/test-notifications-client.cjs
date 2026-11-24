/* global __dirname */
// Exercise production RPC parsing, account isolation and private realtime transport without network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = compile('src/lib/notifications.ts');
const types = {};
vm.runInNewContext(compile('src/types/notifications.ts'), { exports: types });
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const ID = '10000000-0000-4000-8000-000000000001';
const ID2 = '10000000-0000-4000-8000-000000000002';
const REQUEST = '20000000-0000-4000-8000-000000000001';
const CHAT = '30000000-0000-4000-8000-000000000001';
const TIME = '2026-10-22T12:00:00.123456+00:00';
const EARLIER = '2026-10-22T12:00:00.123455+00:00';
const plain = value => JSON.parse(JSON.stringify(value));
const session = (userId = A, token = 'account-A-token') => ({ user: { id: userId }, access_token: token });
const row = (overrides = {}) => ({
  id: ID, recipient_id: A, actor_id: B, event_type: 'offer_created',
  title: 'New offer', body: 'Someone offered to help.', request_id: REQUEST,
  offer_id: ID2, conversation_id: null, message_id: null,
  navigation_key: 'request_details', read_at: null, created_at: TIME, ...overrides,
});
class MillisecondDate extends Date {
  static parse(value) {
    assert.ok(!/\.\d{4,}/.test(value), 'Android Date parsing must not require sub-millisecond precision');
    return Date.parse(value);
  }
}
function client(response = null) {
  const state = { session: session(), response, error: null, authError: null, authCalls: 0, calls: [], onRpc: null, onExecute: null };
  const supabase = {
    auth: { getSession: async () => {
      state.authCalls++;
      return { data: { session: state.session }, error: state.authError };
    } },
    rpc: (name, args) => {
      if (state.onRpc) state.onRpc();
      return { setHeader: async (header, value) => {
        state.calls.push({ name, args: plain(args), header, value });
        if (state.onExecute) return state.onExecute();
        return { data: state.response, error: state.error };
      } };
    },
  };
  const api = {};
  vm.runInNewContext(compiled, { exports: api, Error, Date: MillisecondDate, require: name => {
    if (name === './supabase') return { supabase };
    assert.equal(name, '../types/notifications'); return types;
  } });
  return { api, state };
}
const codeIs = code => error => error.code === code;
let checks = 0;
async function test(name, action) { await action(); checks++; console.log('PASS ' + name); }

(async () => {
  await test('push settings, device registration and push taps use captured credentials and validate returned ownership', async () => {
    const settings = {push_enabled:false, messages:true, offers:true, request_updates:true, registered:false};
    const { api, state } = client(settings);
    assert.deepEqual(plain(await api.loadPushSettings(A)),settings);
    await api.savePushPreference(A,'offers',false);
    await api.savePushDevice(A,'ExpoPushToken[test]');
    await api.refreshPushDevice(A,'ExpoPushToken[test]');
    assert.deepEqual(state.calls.map(c=>c.name),['get_my_push_settings','set_my_push_preference','set_my_android_push_device','refresh_my_android_push_device']);
    assert.deepEqual(plain(state.calls[1].args),{p_name:'offers',p_enabled:false});
    state.response={...settings, messages:'true'};
    await assert.rejects(api.loadPushSettings(A),codeIs('INVALID_RESPONSE'));
    state.response=row();
    assert.deepEqual(plain(await api.openPushNotification(A,ID)),{pathname:'/requests/[id]',params:{id:REQUEST}});
    state.response=row({recipient_id:B});
    await assert.rejects(api.openPushNotification(A,ID),codeIs('INVALID_RESPONSE'));
    state.session=session(B);
    await assert.rejects(api.savePushDevice(A,null),codeIs('ACCOUNT_CHANGED'));
  });
  await test('all four RPC names, arguments and pinned credentials match the backend contract', async () => {
    const { api, state } = client([row()]);
    assert.deepEqual(plain(await api.loadNotificationPage(A.toUpperCase())), { items: [row()], hasMore: false, nextCursor: null });
    state.response = 3; assert.equal(await api.loadUnreadNotificationCount(A), 3);
    state.response = ID; assert.equal(await api.markNotificationRead(A, ID), ID);
    state.response = 3; assert.equal(await api.markAllNotificationsRead(A), 3);
    assert.deepEqual(state.calls.map(({ name, args }) => ({ name, args })), [
      { name: 'get_my_notifications_v3', args: { p_limit: 20, p_before_created_at: null, p_before_id: null } },
      { name: 'get_my_notification_unread_count_v3', args: {} },
      { name: 'mark_my_notification_read', args: { p_notification_id: ID } },
      { name: 'mark_all_my_notifications_read_v3', args: {} },
    ]);
    assert.equal(state.authCalls, 8);
    for (const call of state.calls) { assert.equal(call.header, 'Authorization'); assert.equal(call.value, 'Bearer account-A-token'); }
  });
  await test('keyset cursors preserve microseconds, timezone equivalence and UUID tie ordering', async () => {
    const { api, state } = client([row({ id: ID2, created_at: '2026-10-22T05:00:00.123456-07:00' }), row()]);
    const first = await api.loadNotificationPage(A, { limit: 2 });
    assert.equal(first.hasMore, true);
    assert.deepEqual(plain(first.nextCursor), { id: ID, createdAt: TIME });
    state.response = [row({ created_at: EARLIER })];
    const last = await api.loadNotificationPage(A, { limit: 2, before: first.nextCursor });
    assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null);
    assert.deepEqual(state.calls[1].args, { p_limit: 2, p_before_created_at: TIME, p_before_id: ID });
  });
  await test('empty pages are valid and a full page may be followed by an empty final page', async () => {
    const { api, state } = client([row()]);
    const first = await api.loadNotificationPage(A, { limit: 1 });
    state.response = [];
    assert.deepEqual(plain(await api.loadNotificationPage(A, { limit: 1, before: first.nextCursor })), { items: [], hasMore: false, nextCursor: null });
  });
  await test('invalid user IDs, bounds and incomplete cursors fail before authentication/network', async () => {
    const { api, state } = client();
    const calls = [
      () => api.loadNotificationPage('bad'), () => api.markNotificationRead(A, 'bad'),
      ...[0, -1, 51, 1.5, NaN].map(limit => () => api.loadNotificationPage(A, { limit })),
      ...[{ id: ID }, { createdAt: TIME }, { id: ID, createdAt: 'yesterday' }, { id: 'bad', createdAt: TIME }]
        .map(before => () => api.loadNotificationPage(A, { before })),
    ];
    for (const call of calls) await assert.rejects(call, codeIs('INVALID_INPUT'));
    assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0);
  });
  await test('signed-out, different-account and failed authentication cannot dispatch RPCs', async () => {
    const { api, state } = client();
    state.session = null; await assert.rejects(() => api.loadNotificationPage(A), codeIs('ACCOUNT_CHANGED'));
    state.session = session(B); await assert.rejects(() => api.loadNotificationPage(A), codeIs('ACCOUNT_CHANGED'));
    state.session = session(); state.authError = Error('private auth info');
    await assert.rejects(() => api.loadNotificationPage(A), codeIs('UNCONFIRMED'));
    assert.equal(state.calls.length, 0);
  });
  await test('account switch during RPC construction preserves captured credential and suppresses response', async () => {
    const { api, state } = client([row()]);
    state.onRpc = () => { state.session = session(B, 'other-account-token'); };
    await assert.rejects(() => api.loadNotificationPage(A), codeIs('ACCOUNT_CHANGED'));
    assert.equal(state.calls[0].value, 'Bearer account-A-token');
  });
  await test('in-flight account switches suppress success, returned errors and thrown network errors', async () => {
    for (const outcome of ['success', 'returned-error', 'thrown-error']) {
      const { api, state } = client();
      state.onExecute = async () => {
        state.session = session(B);
        if (outcome === 'thrown-error') throw Error('private account A data');
        return { data: [row()], error: outcome === 'returned-error' ? { code: '42501', message: 'private account A data' } : null };
      };
      await assert.rejects(() => api.loadNotificationPage(A), codeIs('ACCOUNT_CHANGED'));
    }
  });
  await test('same-account token refresh accepts response without replacing outgoing credential', async () => {
    const { api, state } = client();
    state.onExecute = () => { state.session = session(A, 'refreshed'); return { data: [row()], error: null }; };
    assert.equal((await api.loadNotificationPage(A)).items.length, 1);
    assert.equal(state.calls[0].value, 'Bearer account-A-token');
  });
  await test('every event is projected safely and deleted targets/actors remain valid notices', async () => {
    const { api, state } = client();
    for (const event_type of types.NOTIFICATION_EVENT_TYPES) {
      const item = row({ event_type, navigation_key: event_type === 'message_received' ? 'conversation' : ['account_warning','appeal_decided'].includes(event_type) ? 'account_notice' : 'request_details',
        actor_id: null, request_id: null, offer_id: null, conversation_id: null, message_id: null });
      state.response = [{ ...item, private_actor_email: 'private value', url: 'https://evil.example' }];
      const actual = (await api.loadNotificationPage(A)).items[0];
      assert.deepEqual(plain(actual), item);
      assert.deepEqual(plain(api.getNotificationTarget(actual)), item.navigation_key === 'account_notice' ? { pathname: '/profile/appeals' } : null);
    }
  });
  await test('navigation only creates fixed request/conversation routes for valid UUID destinations', async () => {
    const { api } = client();
    assert.deepEqual(plain(api.getNotificationTarget(row())), { pathname: '/requests/[id]', params: { id: REQUEST } });
    assert.deepEqual(plain(api.getNotificationTarget(row({ navigation_key: 'conversation', conversation_id: CHAT }))), { pathname: '/messages/[id]', params: { id: CHAT } });
    for (const item of [row({ request_id: 'https://evil.example' }), row({ navigation_key: 'external' }), row({ navigation_key: 'conversation', conversation_id: null })]) {
      assert.equal(api.getNotificationTarget(item), null);
    }
  });
  await test('warning permits a full reason but rejects staff identity, target links and oversized content', async () => {
    const { api, state } = client();
    const warning = row({ event_type: 'account_warning', navigation_key: 'account_notice', actor_id: null,
      request_id: null, offer_id: null, conversation_id: null, message_id: null, body: 'x'.repeat(2200) });
    state.response = [warning];
    const actual = (await api.loadNotificationPage(A)).items[0];
    assert.equal(actual.body.length, 2200); assert.deepEqual(plain(api.getNotificationTarget(actual)), { pathname: '/profile/appeals' });
    for (const patch of [{ body: 'x'.repeat(2201) }, { actor_id: B }, { request_id: REQUEST }, { offer_id: ID },
      { conversation_id: CHAT }, { message_id: ID }, { navigation_key: 'conversation' }]) {
      state.response = [{ ...warning, ...patch }];
      await assert.rejects(() => api.loadNotificationPage(A), codeIs('INVALID_RESPONSE'));
    }
  });
  await test('appeal result routes to own decisions and rejects private pointers or oversized text', async () => {
    const { api, state } = client();
    const notice = row({ event_type: 'appeal_decided', navigation_key: 'account_notice', actor_id: null,
      request_id: null, offer_id: null, conversation_id: null, message_id: null });
    state.response = [notice];
    const actual = (await api.loadNotificationPage(A)).items[0];
    assert.deepEqual(plain(api.getNotificationTarget(actual)), { pathname: '/profile/appeals' });
    for (const patch of [{ recipient_id: B }, { body: 'x'.repeat(501) }, { actor_id: B }, { request_id: REQUEST },
      { offer_id: ID }, { conversation_id: CHAT }, { message_id: ID }, { navigation_key: 'request_details' }]) {
      state.response = [{ ...notice, ...patch }];
      await assert.rejects(() => api.loadNotificationPage(A), codeIs('INVALID_RESPONSE'));
    }
  });
  await test('malformed rows and different recipients fail closed without private response leakage', async () => {
    const { api, state } = client();
    const invalid = [null, [], row({ recipient_id: B }), row({ id: 'bad' }), row({ actor_id: undefined }),
      row({ event_type: 'secret_event' }), row({ navigation_key: 'conversation' }), row({ title: '' }),
      row({ title: 'x'.repeat(161) }), row({ body: 'x'.repeat(501) }), row({ body: null }),
      row({ read_at: 'invalid' }), row({ created_at: 'invalid' }), row({ offer_id: 'bad' }),
      row({ message_id: undefined }), row({ conversation_id: 3 })];
    for (const item of invalid) {
      state.response = [item];
      await assert.rejects(() => api.loadNotificationPage(A), error => error.code === 'INVALID_RESPONSE' && !error.message.includes('secret'));
    }
  });
  await test('pages reject duplicates, excess rows, unordered rows and cursor boundary inclusion', async () => {
    const { api, state } = client();
    for (const data of [null, {}, [row(), row()], [row(), row({ id: ID2 })]]) {
      state.response = data;
      await assert.rejects(() => api.loadNotificationPage(A, { limit: 2 }), codeIs('INVALID_RESPONSE'));
    }
    state.response = [row({ created_at: EARLIER }), row({ id: ID2 })];
    await assert.rejects(() => api.loadNotificationPage(A, { limit: 2 }), codeIs('INVALID_RESPONSE'));
    state.response = [row(), row({ id: ID2, created_at: EARLIER })];
    await assert.rejects(() => api.loadNotificationPage(A, { limit: 1 }), codeIs('INVALID_RESPONSE'));
    state.response = [row()];
    await assert.rejects(() => api.loadNotificationPage(A, { before: { id: ID, createdAt: TIME } }), codeIs('INVALID_RESPONSE'));
  });
  await test('read acknowledgments and unread/bulk counts must have valid matching response shapes', async () => {
    const { api, state } = client();
    for (const value of [null, -1, '2', 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, {}]) {
      state.response = value;
      await assert.rejects(() => api.loadUnreadNotificationCount(A), codeIs('INVALID_RESPONSE'));
      await assert.rejects(() => api.markAllNotificationsRead(A), codeIs('INVALID_RESPONSE'));
    }
    for (const value of [null, ID2, [ID], 'bad']) {
      state.response = value;
      await assert.rejects(() => api.markNotificationRead(A, ID), codeIs('INVALID_RESPONSE'));
    }
    state.response = 0;
    assert.equal(await api.markAllNotificationsRead(A), 0);
  });
  await test('safe offline/access errors omit raw database details, message content and actor PII', async () => {
    const { api, state } = client();
    for (const code of ['42501', '22023', 'XX000']) {
      state.error = { code, message: 'private message', details: 'private SQL', hint: 'private email' };
      await assert.rejects(() => api.loadNotificationPage(A), error => {
        assert.equal(error.code, code === 'XX000' ? 'UNCONFIRMED' : code);
        assert.doesNotMatch(error.message, /private/);
        assert.equal(api.notificationError(error), error.message);
        assert.equal(error.details, undefined); return true;
      });
    }
    assert.doesNotMatch(api.notificationError(Error('private error')), /private/);
  });
  await test('ambiguous read can retry the same notification with no invented local acknowledgement', async () => {
    const { api, state } = client();
    let committed = false;
    state.onExecute = () => {
      if (!committed) { committed = true; throw Error('Lost response after commit'); }
      return { data: ID, error: null };
    };
    await assert.rejects(() => api.markNotificationRead(A, ID), codeIs('UNCONFIRMED'));
    assert.equal(await api.markNotificationRead(A, ID), ID);
    assert.deepEqual(state.calls[0], state.calls[1]);
  });
  await test('private realtime transport pins session clients, ignores event data and cleans up independently', async () => {
    const instances = [];
    class FakeClient {
      constructor(url, options) { this.url = url; this.options = options; this.channels = []; this.disconnected = false; instances.push(this); }
      channel(topic, options) {
        const channel = { topic, options, on: (kind, filter, callback) => {
          channel.kind = kind; channel.filter = filter; channel.event = callback; return channel;
        }, subscribe: callback => { channel.status = callback; return channel; } };
        this.channels.push(channel); return channel;
      }
      disconnect() { this.disconnected = true; }
      removeAllChannels() { this.removed = true; return Promise.resolve(); }
    }
    const api = {};
    vm.runInNewContext(compile('src/lib/notificationsRealtimeTransport.ts'), { exports: api, require: name => {
      if (name === '@supabase/supabase-js') return { RealtimeClient: FakeClient };
      assert.equal(name, './env'); return { env: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'publishable' } };
    } });
    const events = [], ready = [], failed = [];
    const callbacks = label => ({ changed: value => events.push([label, value]), ready: () => ready.push(label), unavailable: () => failed.push(label) });
    const closeA = api.connectAccountNotifications(A, 'token-A')(callbacks('A'));
    const closeB = api.connectAccountNotifications(B, 'token-B')(callbacks('B'));
    assert.equal(instances.length, 2);
    assert.equal(instances[0].url, 'wss://example.supabase.co/realtime/v1');
    assert.equal(await instances[0].options.accessToken(), 'token-A');
    assert.equal(await instances[1].options.accessToken(), 'token-B');
    const channel = instances[0].channels[0];
    assert.equal(channel.topic, 'notifications:' + A);
    assert.deepEqual(plain(channel.options), { config: { private: true } });
    assert.equal(channel.filter.event, 'notifications_changed');
    channel.event({ payload: { recipient_id: B, body: 'untrusted content', url: 'https://evil.example' } });
    assert.deepEqual(events, [['A', A]]);
    channel.status('SUBSCRIBED'); channel.status('TIMED_OUT'); channel.status('CHANNEL_ERROR'); channel.status('CLOSED');
    assert.deepEqual(ready, ['A']); assert.deepEqual(failed, ['A', 'A', 'A']);
    closeA();
    assert.equal(instances[0].disconnected, true); assert.equal(instances[0].removed, true);
    assert.equal(instances[1].disconnected, false); closeB();
  });
  console.log(`Notifications client: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
