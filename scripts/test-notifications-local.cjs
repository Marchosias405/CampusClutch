/* global __dirname */
// Real Auth/PostgREST/private WebSocket integration, local Supabase only.
// Every account and app row created here is temporary; existing data is fingerprinted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { createClient, RealtimeClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
const { localClientConfig, localSql: sql, createStudentFixture, cleanupStudentFixtures } = require('./local-student-fixtures.cjs');
const { url, key } = localClientConfig();
const users = [], transports = [], extraClients = [], productionStops = [];
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fingerprint() {
  return sql("select tablename from pg_tables where schemaname='public' order by tablename")
    .split(/\r?\n/).filter(Boolean).map(table => {
      assert.match(table, /^[a-z_]+$/);
      return table + ':' + sql(`select count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from public.${table} t`);
    }).join('\n');
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function account(completed = true) {
  const auth = client();
  const credentials = createStudentFixture();
  const { email, password } = credentials;
  const signup = await auth.auth.signUp({ email, password });
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, client: auth, credentials };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    ${completed ? `update public.profiles set display_name='Notification Tester',major='Testing',year_of_study=2,is_discoverable=true,onboarding_completed_at=now(),campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';` : ''}`);
  const signin = await auth.auth.signInWithPassword({ email, password });
  if (signin.error) throw signin.error;
  user.token = signin.data.session.access_token;
  return user;
}
async function rpc(user, name, args) {
  const { data, error } = await user.client.rpc(name, args);
  if (error) throw error;
  return data;
}
async function denied(user, name, args) {
  const { error } = await user.client.rpc(name, args);
  assert.ok(error, name + ' must reject this caller');
}
const notices = (user, args = {}) => rpc(user, 'get_my_notifications_v2', args);
const unread = user => rpc(user, 'get_my_notification_unread_count_v2');
async function subscribe(user, topic, privateChannel = true) {
  const transport = new RealtimeClient(url.replace('http:', 'ws:') + '/realtime/v1', {
    params: { apikey: key }, accessToken: async () => user?.token ?? key, timeout: 3000,
  });
  transports.push(transport);
  await transport.setAuth(user?.token ?? key);
  const events = [];
  const channel = transport.channel(topic, { config: { private: privateChannel, broadcast: { ack: true, self: true } } })
    .on('broadcast', { event: 'notifications_changed' }, event => events.push(event.payload));
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Notification subscription did not settle')), 8000);
    channel.subscribe(state => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) {
        clearTimeout(timer); resolve(state);
      }
    });
  });
  return { transport, channel, events, status };
}
function notificationService(auth) {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const compile = relative => ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const types = {};
  vm.runInNewContext(compile('src/types/notifications.ts'), { exports: types });
  const exports = {};
  vm.runInNewContext(compile('src/lib/notifications.ts'), { exports, Error, require: name => {
    if (name === './supabase') return { supabase: auth };
    if (name === '../types/notifications') return types;
    throw Error('Unexpected notification service import: ' + name);
  } });
  return exports;
}
async function subscribeProduction(user) {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/notificationsRealtimeTransport.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name === '@supabase/supabase-js') return { RealtimeClient };
    if (name === './env') return { env: { supabaseUrl: url, supabasePublishableKey: key } };
    throw Error('Unexpected notification transport import: ' + name);
  } });
  const events = [];
  let stop;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Production notification transport did not subscribe')), 8000);
    stop = exports.connectAccountNotifications(user.id, user.token)({
      changed: () => events.push(true),
      ready: () => { clearTimeout(timer); resolve(); },
      unavailable: () => { /* Its caller handles retry and reconnect. */ },
    });
    productionStops.push(stop);
  });
  return { events, stop };
}
async function waitFor(test, label) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (test()) return;
    await pause(40);
  }
  throw Error('Timed out: ' + label);
}
function assertPayload(events) {
  assert.ok(events.length > 0);
  for (const payload of events) {
    // Realtime adds its generated delivery id. No notification content, actor,
    // destination or unread count is sent over the invalidation channel.
    assert.deepEqual(Object.keys(payload), ['id']);
    assert.match(payload.id, /^[0-9a-f-]{36}$/);
  }
}
(async () => {
  assert.equal(sql("select to_regclass('public.notifications')::text"), 'notifications', 'Apply the local Task 11 migration first');
  const before = fingerprint();
  try {
    const a = await account(), b = await account(), outsider = await account();
    const incomplete = await account(false), deleted = await account(), banned = await account();
    const anon = { client: client() };
    extraClients.push(anon.client);
    assert.deepEqual(await notices(a), []); assert.equal(await unread(a), 0);
    const aLive = await subscribe(a, 'notifications:' + a.id);
    const bLive = await subscribe(b, 'notifications:' + b.id);
    const outsiderLive = await subscribe(outsider, 'notifications:' + outsider.id);
    assert.equal(aLive.status, 'SUBSCRIBED'); assert.equal(bLive.status, 'SUBSCRIBED'); assert.equal(outsiderLive.status, 'SUBSCRIBED');
    const production = await subscribeProduction(b);
    pass('eligible accounts have empty persisted inboxes and can subscribe only through authenticated private channels');
    const wrongTopic = await subscribe(outsider, 'notifications:' + a.id);
    const anonymous = await subscribe(null, 'notifications:' + a.id);
    assert.notEqual(wrongTopic.status, 'SUBSCRIBED'); assert.notEqual(anonymous.status, 'SUBSCRIBED');
    pass('outsider and anonymous subscriptions to another recipient are denied');
    assert.notEqual((await subscribe(incomplete, 'notifications:' + incomplete.id)).status, 'SUBSCRIBED');
    await denied(incomplete, 'get_my_notifications_v2');
    await denied(anon, 'get_my_notifications_v2');
    await denied(anon, 'get_my_notification_unread_count_v2');
    pass('anonymous and incomplete accounts cannot read inboxes or subscribe');
    sql(`update auth.users set deleted_at=now() where id='${deleted.id}'; update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    assert.notEqual((await subscribe(deleted, 'notifications:' + deleted.id)).status, 'SUBSCRIBED');
    assert.notEqual((await subscribe(banned, 'notifications:' + banned.id)).status, 'SUBSCRIBED');
    await denied(deleted, 'get_my_notifications_v2'); await denied(banned, 'get_my_notification_unread_count_v2');
    pass('soft-deleted and banned accounts are denied even with previously issued JWTs');
    const publicTopic = await subscribe(outsider, 'notifications:' + b.id, false);
    const conversationId = await rpc(a, 'start_direct_conversation', { p_other_profile_id: b.id });
    const send = (user, body, id = crypto.randomUUID()) => rpc(user, 'send_conversation_message', {
      p_conversation_id: conversationId, p_client_message_id: id, p_body: body,
    });
    const retryId = crypto.randomUUID();
    const first = await send(a, 'First notification fixture', retryId);
    await waitFor(() => bLive.events.length === 1, 'new message notification');
    assertPayload(bLive.events);
    await waitFor(() => production.events.length === 1, 'production notification callback');
    pass('the production session transport receives the committed notification invalidation');
    production.stop();
    assert.equal(aLive.events.length, 0); assert.equal(outsiderLive.events.length, 0);
    let rows = await notices(b);
    assert.equal(rows.length, 1); assert.equal(rows[0].event_type, 'message_received');
    assert.equal(rows[0].conversation_id, conversationId); assert.equal(rows[0].message_id, first.id);
    assert.equal(rows[0].read_at, null); assert.equal(await unread(b), 1);
    assert.deepEqual(await notices(a), []); assert.deepEqual(await notices(outsider), []);
    pass('a direct message creates exactly one recipient notification and private content-free live event');
    await send(a, first.body, retryId); await pause(250);
    assert.equal((await notices(b)).length, 1); assert.equal(bLive.events.length, 1);
    pass('retrying an idempotent send creates neither a second notification nor a second live event');
    const firstNotice = rows[0].id;
    const ownRows = await b.client.from('notifications').select('*');
    const foreignRows = await outsider.client.from('notifications').select('*').eq('id', firstNotice);
    assert.ifError(ownRows.error); assert.ifError(foreignRows.error);
    assert.equal(ownRows.data.length, 1); assert.equal(foreignRows.data.length, 0);
    await denied(outsider, 'mark_my_notification_read', { p_notification_id: firstNotice });
    await denied(anon, 'mark_my_notification_read', { p_notification_id: firstNotice });
    assert.equal(await unread(b), 1);
    pass('REST reads and read-state RPCs cannot expose or mutate another recipient notice');
    assert.ok((await b.client.from('notifications').insert({ recipient_id: b.id, event_type: 'message_received' })).error);
    assert.ok((await b.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', firstNotice)).error);
    assert.ok((await b.client.from('notifications').delete().eq('id', firstNotice)).error);
    pass('clients cannot forge, overwrite or delete notification records through raw REST writes');
    bLive.events.length = 0;
    assert.equal(await rpc(b, 'mark_my_notification_read', { p_notification_id: firstNotice }), firstNotice);
    await waitFor(() => bLive.events.length === 1, 'mark-one invalidation');
    assert.equal(await unread(b), 0); assert.ok((await notices(b))[0].read_at);
    assert.equal(await rpc(b, 'get_my_unread_message_count'), 1);
    await rpc(b, 'mark_my_notification_read', { p_notification_id: firstNotice }); await pause(250);
    assert.equal(bLive.events.length, 1);
    pass('bell mark-read persists once and does not pretend that the conversation was read');
    const second = await send(a, 'Second notification fixture');
    const third = await send(a, 'Third notification fixture');
    assert.equal(await unread(b), 2);
    await pause(250); assert.equal(production.events.length, 1);
    pass('stopping the production transport prevents later delivery to the previous session');
    await rpc(b, 'mark_conversation_read', { p_conversation_id: conversationId, p_through_sequence: second.sequence });
    rows = await notices(b);
    assert.ok(rows.find(row => row.message_id === second.id).read_at);
    assert.equal(rows.find(row => row.message_id === third.id).read_at, null);
    assert.equal(await unread(b), 1); assert.equal(await rpc(b, 'get_my_unread_message_count'), 1);
    pass('reading a conversation clears only message notices through its confirmed read cursor');
    const expectedIds = rows.map(row => row.id);
    const pagedIds = [];
    let cursor = {};
    for (let page = 0; page < expectedIds.length + 1; page++) {
      const batch = await notices(b, { p_limit: 1, ...cursor });
      if (!batch.length) break;
      assert.equal(batch.length, 1);
      pagedIds.push(batch[0].id);
      cursor = { p_before_created_at: batch[0].created_at, p_before_id: batch[0].id };
    }
    assert.deepEqual(pagedIds, expectedIds); assert.equal(new Set(pagedIds).size, expectedIds.length);
    await denied(b, 'get_my_notifications_v2', { p_before_id: firstNotice });
    pass('keyset pagination returns every notice once and rejects an incomplete cursor');
    const session = (await b.client.auth.getSession()).data.session;
    const fresh = client(); extraClients.push(fresh);
    assert.ifError((await fresh.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })).error);
    assert.deepEqual(await notices({ client: fresh }), rows); assert.equal(await unread({ client: fresh }), 1);
    pass('recreated authenticated clients recover the same inbox and persisted read state');
    const api = notificationService(fresh);
    const typedPage = await api.loadNotificationPage(b.id);
    assert.deepEqual(JSON.parse(JSON.stringify(typedPage.items)).map(row => row.id), expectedIds);
    assert.equal(await api.loadUnreadNotificationCount(b.id), 1);
    await assert.rejects(api.loadNotificationPage(a.id));
    await assert.rejects(api.markNotificationRead(a.id, firstNotice));
    pass('the production typed service parses live rows and rejects an account identity mismatch');
    await send(b, 'Independent unread notice for the other account');
    assert.equal(await unread(a), 1);
    assert.equal(await rpc(b, 'mark_all_my_notifications_read_v2'), 1);
    assert.equal(await unread(b), 0); assert.equal(await unread(a), 1);
    assert.equal(await rpc(b, 'mark_all_my_notifications_read_v2'), 0);
    await denied(anon, 'mark_all_my_notifications_read_v2');
    pass('mark-all is idempotent, account-scoped and returns the actual number changed');
    await pause(300); aLive.events.length = 0;
    await aLive.channel.send({ type: 'broadcast', event: 'notifications_changed', payload: { forged: true } });
    await pause(300); assert.equal(aLive.events.length, 0);
    pass('a subscribed client cannot forge notification invalidation broadcasts');
    await bLive.transport.removeAllChannels(); await bLive.transport.disconnect();
    const disconnected = await send(a, 'Saved while notification socket was disconnected');
    const resumed = await subscribe(b, 'notifications:' + b.id);
    assert.equal(resumed.status, 'SUBSCRIBED');
    assert.ok((await notices(b)).some(row => row.message_id === disconnected.id)); assert.equal(await unread(b), 1);
    pass('reconnection can refetch durable notifications missed while offline');
    await send(a, 'Live notification after reconnect');
    await waitFor(() => resumed.events.length === 1, 'reconnected notification'); assertPayload(resumed.events);
    pass('private notification events resume after reconnect');
    const campus = sql("select id from public.campuses where slug='burnaby'");
    const requestId = await rpc(a, 'save_my_request', { p_payload: {
      category: 'delivery', title: 'Notification integration fixture', description: 'Temporary local notification test.', campus_id: campus,
      room_location: 'Library', deadline_at: '2099-01-01T00:00:00Z', points: 10, item_size: 'small',
      details: { pickup_location: 'Cafe', dropoff_location: 'Library' },
    } });
    const offerId = await rpc(b, 'create_my_request_offer_for_terms', { p_request_id: requestId, p_expected_round: 1, p_expected_points: 10, p_message: null });
    const createdNotice = (await notices(a)).find(row => row.request_id === requestId && row.event_type === 'offer_created');
    assert.ok(createdNotice); assert.equal(createdNotice.actor_id, b.id);
    assert.equal((await notices(outsider)).length, 0);
    pass('a real offer creates a durable notice for its poster without leaking to unrelated accounts');
    await rpc(a, 'decide_request_offer_for_round', { p_offer_id: offerId, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });
    assert.ok((await notices(b)).some(row => row.request_id === requestId && row.event_type === 'offer_accepted'));
    pass('accepting an offer creates a targeted notice for the helper');
    await rpc(a, 'complete_my_request', { p_request_id: requestId, p_expected_round: 1 });
    const completed = (await notices(b)).filter(row => row.request_id === requestId && row.event_type === 'request_completed');
    assert.equal(completed.length, 1);
    await rpc(a, 'complete_my_request', { p_request_id: requestId, p_expected_round: 1 });
    assert.equal((await notices(b)).filter(row => row.request_id === requestId && row.event_type === 'request_completed').length, 1);
    pass('poster-confirmed completion creates one helper notification even when confirmation is retried');
    await pause(500);
    assert.equal(publicTopic.events.length, 0); assert.equal(wrongTopic.events.length, 0); assert.equal(anonymous.events.length, 0);
    assert.equal(outsiderLive.events.length, 0);
    pass('public same-name channels and unrelated private subscribers receive no recipient events');
    sql(`update auth.users set banned_until=now()+interval '1 day' where id='${b.id}';`);
    resumed.events.length = 0;
    await assert.rejects(send(a, 'No message to a newly ineligible recipient'), error => error.code === '42501');
    // A trusted event can still be stored while its recipient is ineligible.
    // Its private invalidation must not reach the previously subscribed socket.
    sql(`insert into public.notifications(recipient_id,event_type,title,body,navigation_key,source_event_key)
      values('${b.id}','request_expired','Request expired','Disposable eligibility check.','request_details','eligibility:${crypto.randomUUID()}')`);
    await pause(500); assert.equal(resumed.events.length, 0);
    await denied(b, 'get_my_notifications_v2'); await denied(b, 'mark_all_my_notifications_read_v2');
    pass('an already-connected recipient loses event fan-out and API access after becoming ineligible');
  } finally {
    for (const stop of productionStops) stop();
    for (const transport of transports) { await transport.removeAllChannels(); await transport.disconnect(); }
    await Promise.allSettled([...users.map(user => user.client), ...extraClients].map(auth => auth.auth.signOut()));
    cleanupStudentFixtures(users.map(user => user.credentials));
    assert.equal(fingerprint(), before, 'Existing application rows must be unchanged after fixture cleanup');
    pass('all temporary fixtures removed and every existing public-table fingerprint unchanged');
  }
  console.log(`${checks} local notification integration checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
