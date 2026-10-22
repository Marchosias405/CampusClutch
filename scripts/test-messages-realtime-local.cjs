/* global __dirname */
// Real private WebSocket authorization and database-trigger delivery. Creates
// temporary local accounts, then removes only those accounts and their rows.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { createClient, RealtimeClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
const url = env.EXPO_PUBLIC_SUPABASE_URL;
if (url !== 'http://127.0.0.1:54321') throw Error('This test requires local Supabase; hosted databases are never used.');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const users = [], transports = [];
const productionStops = [];
let checks = 0;
const pass = label => { checks += 1; console.log('PASS ' + label); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function sql(query) {
  const out = cp.spawnSync('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    env: { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8', timeout: 30000,
  });
  if (out.error) throw out.error;
  if (out.status !== 0) throw Error(out.stderr);
  return out.stdout.trim();
}
function fingerprint() {
  return sql("select tablename from pg_tables where schemaname='public' order by tablename")
    .split(/\r?\n/).filter(Boolean).map(table => {
      assert.match(table, /^[a-z_]+$/);
      return table + ':' + sql(`select count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from public.${table} t`);
    }).join('\n');
}
async function account(completed = true) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = 'direct-realtime-' + crypto.randomUUID() + '@test.local';
  const password = crypto.randomBytes(24).toString('hex');
  const signup = await client.auth.signUp({ email, password });
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, client };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    ${completed ? `update public.profiles set display_name='Realtime Tester',major='Testing',year_of_study=2,is_discoverable=true,onboarding_completed_at=now(),campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';` : ''}`);
  const signin = await client.auth.signInWithPassword({ email, password });
  if (signin.error) throw signin.error;
  user.token = signin.data.session.access_token;
  return user;
}
async function rpc(user, name, args) {
  const { data, error } = await user.client.rpc(name, args);
  if (error) throw error;
  return data;
}
async function subscribe(user, topic, privateChannel = true) {
  const transport = new RealtimeClient(url.replace('http:', 'ws:') + '/realtime/v1', {
    params: { apikey: key }, accessToken: async () => user?.token ?? key,
    timeout: 3000,
  });
  transports.push(transport);
  await transport.setAuth(user?.token ?? key);
  const events = [];
  const channel = transport.channel(topic, { config: { private: privateChannel, broadcast: { ack: true, self: true } } })
    .on('broadcast', { event: 'messages_changed' }, event => events.push(event.payload));
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WebSocket subscription did not settle')), 8000);
    channel.subscribe(state => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) {
        clearTimeout(timer); resolve(state);
      }
    });
  });
  return { transport, channel, events, status };
}
async function subscribeProduction(user) {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/messagesRealtimeTransport.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name === '@supabase/supabase-js') return { RealtimeClient };
    if (name === './env') return { env: { supabaseUrl: url, supabasePublishableKey: key } };
    throw Error('Unexpected transport import: ' + name);
  } });
  const events = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Production transport did not subscribe')), 8000);
    const stop = exports.connectAccountMessages(user.id, user.token)({
      changed: id => events.push(id),
      ready: () => { clearTimeout(timer); resolve(); },
      unavailable: () => { /* Transport uses reconnect handling in its caller. */ },
    });
    productionStops.push(stop);
  });
  return events;
}
async function waitFor(test, label) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (test()) return;
    await pause(40);
  }
  throw Error('Timed out: ' + label);
}
function assertPayload(events, id) {
  assert.ok(events.length > 0);
  for (const payload of events) {
    assert.equal(payload.conversation_id, id);
    // Supabase supplies a generated delivery ID; there is no content, sender
    // identity, read cursor or count in an invalidation event.
    assert.deepEqual(Object.keys(payload).sort(), ['conversation_id', 'id']);
    assert.match(payload.id, /^[0-9a-f-]{36}$/);
  }
}
(async () => {
  const before = fingerprint();
  try {
    const a = await account(), b = await account(), outsider = await account();
    const incomplete = await account(false), deleted = await account(), banned = await account();
    const aLive = await subscribe(a, 'messages:' + a.id);
    const bLive = await subscribe(b, 'messages:' + b.id);
    const productionEvents = await subscribeProduction(a);
    assert.equal(aLive.status, 'SUBSCRIBED'); assert.equal(bLive.status, 'SUBSCRIBED');
    pass('completed accounts can subscribe to their own private invalidation channels');
    const unauthorized = await subscribe(outsider, 'messages:' + a.id);
    assert.notEqual(unauthorized.status, 'SUBSCRIBED');
    pass('an authenticated outsider cannot subscribe to another account topic');
    const anonymous = await subscribe(null, 'messages:' + a.id);
    assert.notEqual(anonymous.status, 'SUBSCRIBED');
    pass('anonymous users cannot subscribe to private message topics');
    const unfinished = await subscribe(incomplete, 'messages:' + incomplete.id);
    assert.notEqual(unfinished.status, 'SUBSCRIBED');
    pass('an incomplete account cannot subscribe even to its own topic');
    sql(`update auth.users set deleted_at=now() where id='${deleted.id}';`);
    assert.notEqual((await subscribe(deleted, 'messages:' + deleted.id)).status, 'SUBSCRIBED');
    pass('soft-deleted accounts with previously issued JWTs cannot subscribe');
    sql(`update auth.users set banned_until=now()+interval '1 day' where id='${banned.id}';`);
    assert.notEqual((await subscribe(banned, 'messages:' + banned.id)).status, 'SUBSCRIBED');
    pass('banned accounts cannot subscribe with stale tokens');
    const publicLive = await subscribe(outsider, 'messages:' + a.id, false);
    // Public channels may be globally enabled by the local service. They must
    // never receive our private database events, even with the same topic.
    const id = await rpc(a, 'start_direct_conversation', { p_other_profile_id: b.id });
    await waitFor(() => aLive.events.length === 1 && bLive.events.length === 1, 'new conversation notifications');
    assertPayload(aLive.events, id); assertPayload(bLive.events, id);
    await waitFor(() => productionEvents.includes(id), 'production transport callback');
    pass('production session-scoped transport subscribes and forwards the conversation invalidation');
    pass('new direct conversation membership notifies both participants after commit');
    aLive.events.length = 0; bLive.events.length = 0;
    const clientId = crypto.randomUUID();
    const first = await rpc(a, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: clientId, p_body: 'Private content stays in authorized history' });
    await waitFor(() => aLive.events.length === 1 && bLive.events.length === 1, 'message invalidations');
    assertPayload(aLive.events, id); assertPayload(bLive.events, id);
    pass('a persisted direct message notifies both participants with no body or read state');
    assert.equal(await rpc(b, 'get_my_unread_message_count'), 1);
    assert.equal((await rpc(b, 'get_conversation_messages', { p_conversation_id: id }))[0].id, first.id);
    pass('event recipients refetch the persisted message and unread total through authorized RPCs');
    await rpc(a, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: clientId, p_body: first.body });
    await pause(250);
    assert.equal(aLive.events.length, 1); assert.equal(bLive.events.length, 1);
    pass('idempotent message retries emit no duplicate insertion event');
    aLive.events.length = 0; bLive.events.length = 0;
    await rpc(b, 'mark_conversation_read', { p_conversation_id: id, p_through_sequence: first.sequence });
    await waitFor(() => bLive.events.length === 1, 'read cursor own invalidation');
    await pause(250);
    assert.equal(aLive.events.length, 0); assertPayload(bLive.events, id);
    pass('read cursor updates notify only the reading account, never its peer');
    await rpc(b, 'mark_conversation_read', { p_conversation_id: id, p_through_sequence: first.sequence });
    await pause(250); assert.equal(bLive.events.length, 1);
    pass('unchanged read cursors emit no events and cannot create refetch loops');
    await aLive.channel.send({ type: 'broadcast', event: 'messages_changed', payload: { conversation_id: id, forged: true } });
    await pause(250); assert.equal(aLive.events.length, 0);
    pass('subscribed clients cannot forge broadcast invalidations');
    await bLive.transport.removeAllChannels();
    await bLive.transport.disconnect();
    await rpc(a, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: crypto.randomUUID(), p_body: 'Persisted while receiver disconnected' });
    const resumed = await subscribe(b, 'messages:' + b.id);
    assert.equal(resumed.status, 'SUBSCRIBED');
    assert.equal((await rpc(b, 'get_conversation_messages', { p_conversation_id: id })).length, 2);
    assert.equal(await rpc(b, 'get_my_unread_message_count'), 1);
    pass('reconnection refetch recovers messages missed while the socket was disconnected');
    await rpc(a, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: crypto.randomUUID(), p_body: 'Live after reconnect' });
    await waitFor(() => resumed.events.length === 1, 'reconnected delivery');
    assertPayload(resumed.events, id);
    pass('private invalidations resume after reconnect');
    assert.equal(publicLive.events.length, 0); assert.equal(unauthorized.events.length, 0); assert.equal(anonymous.events.length, 0);
    pass('public same-name channels and unauthorized subscribers receive no private events');
    sql(`update auth.users set banned_until=now()+interval '1 day' where id='${b.id}';`);
    resumed.events.length = 0;
    await rpc(a, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: crypto.randomUUID(), p_body: 'No event for newly ineligible receiver' });
    await pause(500); assert.equal(resumed.events.length, 0);
    pass('trigger fan-out stops immediately when an already-subscribed recipient becomes ineligible');
  } finally {
    for (const stop of productionStops) stop();
    for (const transport of transports) { await transport.removeAllChannels(); await transport.disconnect(); }
    for (const user of users) await user.client.auth.signOut();
    if (users.length) {
      const ids = users.map(user => `'${user.id}'`).join(',');
      const owned = `select id from public.conversations where created_by in (${ids})`;
      sql(`begin;
        delete from public.request_conversations where conversation_id in (${owned});
        delete from public.messages where conversation_id in (${owned});
        delete from public.group_membership_periods where conversation_id in (${owned});
        delete from public.conversation_members where conversation_id in (${owned});
        delete from public.direct_conversation_pairs where conversation_id in (${owned});
        delete from public.conversations where created_by in (${ids});
        delete from auth.users where id in (${ids});
        delete from realtime.messages where topic in (${users.map(user => `'messages:${user.id}'`).join(',')});
        commit;`);
    }
    assert.equal(fingerprint(), before);
    pass('all temporary fixtures cleaned; existing public data fingerprint unchanged');
  }
  console.log(`${checks} local Realtime checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
