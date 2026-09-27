/* global __dirname */
// Exercise the actual typed messaging service against local Auth/PostgREST.
// Creates temporary accounts and deletes only their fixtures in finally.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
const ts = require(path.join(root, 'node_modules/typescript'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (env.EXPO_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('Local API required; hosted projects are never used by this test.');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const users = [];
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/messages.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledAssignments = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/requestConversations.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiledContacts = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/requestContacts.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function sql(query) {
  const out = cp.spawnSync('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { env: { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8', timeout: 30000 });
  if (out.error) throw out.error;
  if (out.status !== 0) throw Error(out.stderr);
  return out.stdout.trim();
}
function service(client) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, require: name => {
    if (name === './supabase') return { supabase: client };
    throw Error('Unexpected runtime import: ' + name);
  } });
  const assignments = {};
  vm.runInNewContext(compiledAssignments, { exports: assignments, Error, require: name => {
    if (name === './supabase') return { supabase: client };
    if (name === './messages') return exports;
    throw Error('Unexpected runtime import: ' + name);
  } });
  const contacts = {};
  vm.runInNewContext(compiledContacts, { exports: contacts, Error, require: name => {
    if (name === './supabase') return { supabase: client };
    if (name === './messages') return exports;
    throw Error('Unexpected runtime import: ' + name);
  } });
  return { ...exports, ...assignments, ...contacts };
}
function dataFingerprint() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename").split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+$/.test(table)));
  return tables.map(table => table + ':' + sql(`select count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from public.${table} t`)).join('\n');
}
async function account() {
  const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = 'messages-api-' + crypto.randomUUID() + '@test.local';
  const password = crypto.randomBytes(24).toString('hex');
  const signup = await client.auth.signUp({ email, password });
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, client, api: service(client) };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Messaging API Tester',major='Testing',year_of_study=2,is_discoverable=true,onboarding_completed_at=now(),campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';`);
  const signin = await client.auth.signInWithPassword({ email, password });
  if (signin.error) throw signin.error;
  return user;
}
async function denied(user, name, args) {
  const { error } = await user.client.rpc(name, args);
  assert.ok(error, name + ' must reject this caller');
  return error;
}
async function rpc(user, name, args) {
  const { data, error } = await user.client.rpc(name, args);
  if (error) throw error;
  return data;
}
(async () => {
  const before = dataFingerprint();
  try {
    const a = await account(), b = await account(), c = await account();
    const id = await a.api.startDirectConversation(a.id, b.id);
    assert.equal(await b.api.startDirectConversation(b.id, a.id), id);
    pass('opposite participants reuse one persisted direct conversation');
    let summary = await a.api.loadConversationSummary(a.id, id);
    assert.equal(summary.other_profile_id, b.id);
    assert.equal(summary.last_message_sequence, '0');
    assert.equal(summary.unread_count, 0);
    assert.equal(await a.api.loadUnreadMessageCount(a.id), 0);
    pass('empty conversation summary uses exact string cursors and the authorized counterpart');
    assert.equal((await a.api.loadMessagePage(a.id, id)).items.length, 0);
    pass('empty message history is persistent and empty');
    const retryId = crypto.randomUUID();
    const first = await a.api.sendMessage(a.id, { conversationId: id, clientMessageId: retryId, body: '  First persisted message  ' });
    assert.equal(first.body, 'First persisted message');
    assert.equal(first.sequence, '1');
    assert.equal(first.sender_id, a.id);
    assert.equal((await a.api.sendMessage(a.id, { conversationId: id, clientMessageId: retryId, body: 'First persisted message' })).id, first.id);
    pass('retrying a send returns the original row without duplication');
    await assert.rejects(a.api.sendMessage(a.id, { conversationId: id, clientMessageId: retryId, body: 'Changed content' }));
    pass('a retry key cannot rewrite already-sent content');
    const second = await b.api.sendMessage(b.id, { conversationId: id, clientMessageId: crypto.randomUUID(), body: 'Reply from the helper' });
    assert.equal(second.sequence, '2');
    assert.equal((await b.api.loadConversationSummary(b.id, id)).unread_count, 1);
    assert.equal((await a.api.loadConversationSummary(a.id, id)).unread_count, 1);
    assert.equal(await a.api.loadUnreadMessageCount(a.id), 1);
    assert.equal(await b.api.loadUnreadMessageCount(b.id), 1);
    pass('both participants see only the other participant’s messages counted as unread');
    const latest = await a.api.loadMessagePage(a.id, id, { limit: 1 });
    assert.equal(latest.items[0].id, second.id);
    const older = await a.api.loadMessagePage(a.id, id, { limit: 1, beforeSequence: second.sequence });
    assert.equal(older.items[0].id, first.id);
    pass('history pages load by sequence without repeating the cursor message');
    assert.equal(await a.api.markConversationRead(a.id, id, second.sequence), '2');
    assert.equal(await a.api.markConversationRead(a.id, id, first.sequence), '2');
    assert.equal((await a.api.loadConversationSummary(a.id, id)).unread_count, 0);
    assert.equal((await b.api.loadConversationSummary(b.id, id)).unread_count, 1);
    assert.equal(await a.api.loadUnreadMessageCount(a.id), 0);
    pass('read cursors persist monotonically and affect only the caller');
    await assert.rejects(a.api.markConversationRead(a.id, id, '3'));
    pass('a future read cursor cannot hide later messages');
    const personalState = await a.client.from('conversation_members').select('*').eq('conversation_id', id);
    assert.ifError(personalState.error);
    assert.equal(personalState.data.length, 1);
    assert.equal(personalState.data[0].profile_id, a.id);
    pass('raw membership reads reveal no peer read cursor');
    assert.equal((await c.api.loadConversationPage(c.id)).items.length, 0);
    await assert.rejects(c.api.loadConversationSummary(c.id, id));
    await assert.rejects(c.api.loadMessagePage(c.id, id));
    await assert.rejects(c.api.sendMessage(c.id, { conversationId: id, clientMessageId: crypto.randomUUID(), body: 'Unauthorized' }));
    await assert.rejects(c.api.markConversationRead(c.id, id, '1'));
    pass('nonmembers cannot discover, read, send or mark another conversation');
    const outsiderRows = await c.client.from('messages').select('id').eq('conversation_id', id);
    assert.ifError(outsiderRows.error);
    assert.equal(outsiderRows.data.length, 0);
    pass('direct REST reads enforce message membership');
    const anon = { client: createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } }) };
    await denied(anon, 'get_conversation_summary', { p_conversation_id: id });
    await denied(anon, 'send_conversation_message', { p_conversation_id: id, p_client_message_id: crypto.randomUUID(), p_body: 'Anonymous' });
    pass('anonymous clients cannot use the messaging API');
    sql(`update public.profiles set is_discoverable=false where id='${b.id}';`);
    assert.equal(await a.api.startDirectConversation(a.id, b.id), id);
    await assert.rejects(c.api.startDirectConversation(c.id, b.id));
    pass('privacy changes preserve an existing chat but prevent new unsolicited contact');
    // Narrow relationship identity is available without making the whole profile public.
    assert.equal((await a.api.loadConversationSummary(a.id, id)).other_display_name, 'Messaging API Tester');
    const profileRows = await a.client.from('profiles').select('id').eq('id', b.id);
    assert.ifError(profileRows.error);
    assert.equal(profileRows.data.length, 0);
    pass('conversation identity does not broaden profile visibility');
    const campus = sql("select id from public.campuses where slug='burnaby'");
    const requestId = await rpc(a, 'save_my_request', { p_payload: {
      category: 'delivery', title: 'Messaging fixture', description: 'Temporary messaging API test.', campus_id: campus,
      room_location: 'Library', deadline_at: '2099-01-01T00:00:00Z', points: 10, item_size: 'small',
      details: { pickup_location: 'Cafe', dropoff_location: 'Library' },
    } });
    sql(`update public.profiles set is_discoverable=false where id='${a.id}';`);
    const contact = await b.api.loadRequestContact(b.id, requestId, a.id);
    assert.equal(contact.profileId, a.id);
    assert.equal(contact.displayName, 'Messaging API Tester');
    assert.deepEqual(Object.keys(contact).sort(), ['campusDisplayName','displayName','major','profileId','yearOfStudy']);
    const hiddenPoster = await b.client.from('profiles').select('id').eq('id', a.id);
    assert.ifError(hiddenPoster.error);
    assert.equal(hiddenPoster.data.length, 0);
    pass('preoffer identity is available through the request while the hidden full profile remains private');
    await assert.rejects(c.api.startDirectConversation(c.id, a.id));
    const preofferChat = await c.api.startRequestContactConversation(c.id, requestId, a.id);
    assert.equal(await c.api.startRequestContactConversation(c.id, requestId, a.id), preofferChat);
    assert.equal(await b.api.startRequestContactConversation(b.id, requestId, a.id), id);
    assert.equal(sql(`select count(*) from public.request_conversations where request_id='${requestId}'`), '0');
    pass('preoffer request messaging permits a hidden poster, reuses pairs and creates no assignment links');
    await assert.rejects(a.api.loadRequestContact(a.id, requestId, c.id));
    await assert.rejects(b.api.loadRequestContact(b.id, requestId, c.id));
    await denied(anon, 'get_request_contact', { p_request_id: requestId, p_other_profile_id: a.id });
    await denied(anon, 'get_my_unread_message_count', {});
    pass('request contact and unread RPCs reject anonymous or unrelated targets');
    const offerId = await rpc(b, 'create_my_request_offer_for_terms', { p_request_id: requestId, p_expected_round: 1, p_expected_points: 10, p_message: null });
    assert.equal((await a.api.loadRequestContact(a.id, requestId, b.id)).profileId, b.id);
    assert.equal(await a.api.startRequestContactConversation(a.id, requestId, b.id), id);
    pass('poster can inspect and message a hidden pending helper before deciding');
    await assert.rejects(b.api.openRequestConversation(b.id, requestId, 1));
    assert.equal((await b.api.loadRequestConversationAssignments(b.id, requestId)).items.length, 0);
    pass('a pending offer cannot grant request-conversation access');
    await rpc(a, 'decide_request_offer_for_round', { p_offer_id: offerId, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });
    assert.equal(await b.api.openRequestConversation(b.id, requestId, 1), id);
    await assert.rejects(c.api.openRequestConversation(c.id, requestId, 1));
    pass('accepted assignment links the original pair and excludes outsiders');
    const assignment = (await b.api.loadRequestConversationAssignments(b.id, requestId)).items[0];
    assert.deepEqual(JSON.parse(JSON.stringify(assignment)), {
      request_id: requestId, offer_round: 1, poster_id: a.id, helper_id: b.id, status: 'reserved',
    });
    assert.equal((await a.api.loadRequestConversationAssignments(a.id, requestId)).items.length, 1);
    assert.equal((await c.api.loadRequestConversationAssignments(c.id, requestId)).items.length, 0);
    assert.equal((await b.api.loadRequestConversationAssignments(b.id, requestId, 1)).items.length, 0);
    pass('assignment history exposes only exact participants and honors the round cursor');
    await rpc(b, 'cancel_my_accepted_help', { p_request_id: requestId, p_expected_round: 1 });
    assert.equal(await b.api.openRequestConversation(b.id, requestId, 1), id);
    assert.equal((await b.api.loadRequestConversationAssignments(b.id, requestId)).items[0].status, 'released');
    pass('cancelled assignment retains its original authorized conversation');
    const replacement = await rpc(c, 'create_my_request_offer_for_terms', { p_request_id: requestId, p_expected_round: 2, p_expected_points: 10, p_message: null });
    await rpc(a, 'decide_request_offer_for_round', { p_offer_id: replacement, p_action: 'accepted', p_expected_round: 2, p_expected_points: 10 });
    const posterHistory = await a.api.loadRequestConversationAssignments(a.id, requestId);
    assert.deepEqual(JSON.parse(JSON.stringify(posterHistory.items.map(row => row.offer_round))), [2, 1]);
    assert.equal((await a.api.loadRequestConversationAssignments(a.id, requestId, 2)).items[0].helper_id, b.id);
    assert.equal((await b.api.loadRequestConversationAssignments(b.id, requestId)).items.length, 1);
    assert.equal((await b.api.loadRequestConversationAssignments(b.id, requestId)).items[0].offer_round, 1);
    assert.equal((await c.api.loadRequestConversationAssignments(c.id, requestId)).items.length, 1);
    assert.equal((await c.api.loadRequestConversationAssignments(c.id, requestId)).items[0].offer_round, 2);
    await assert.rejects(b.api.openRequestConversation(b.id, requestId, 2));
    await assert.rejects(c.api.openRequestConversation(c.id, requestId, 1));
    const replacementChat = await c.api.openRequestConversation(c.id, requestId, 2);
    assert.equal(replacementChat, preofferChat);
    assert.notEqual(replacementChat, id);
    assert.equal((await c.api.loadMessagePage(c.id, replacementChat)).items.length, 0);
    assert.equal(await b.api.openRequestConversation(b.id, requestId, 1), id);
    pass('replacement helpers see only their own assignment and never inherit prior chat history');
    const session = (await a.client.auth.getSession()).data.session;
    const freshClient = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.ifError((await freshClient.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })).error);
    const restored = await service(freshClient).loadMessagePage(a.id, id);
    assert.equal(restored.items.length, 2);
    assert.equal(restored.items[0].id, second.id);
    pass('a recreated client loads the same saved history');
    summary = (await a.api.loadConversationPage(a.id)).items.find(item => item.id === id);
    assert.equal(summary.last_message_body, second.body);
    assert.equal(summary.last_read_sequence, '2');
    pass('inbox summary reflects persisted latest message and read state');
    await assert.rejects(a.api.loadConversationPage(b.id));
    await assert.rejects(a.api.loadRequestConversationAssignments(b.id, requestId));
    await assert.rejects(a.api.loadUnreadMessageCount(b.id));
    await assert.rejects(a.api.loadRequestContact(b.id, requestId, a.id));
    pass('typed service rejects calls made with a different account identity');
    console.log('Local messaging API checks passed: ' + checks + '.');
  } finally {
    if (users.length) {
      const ids = users.map(user => `'${user.id}'`).join(',');
      const owned = `select id from public.conversations where created_by in (${ids})`;
      sql(`begin;
        delete from public.request_conversations where conversation_id in (${owned});
        delete from public.messages where conversation_id in (${owned});
        delete from public.conversation_members where conversation_id in (${owned});
        delete from public.direct_conversation_pairs where conversation_id in (${owned});
        delete from public.conversations where created_by in (${ids});
        delete from public.requests where owner_id in (${ids});
        delete from auth.users where id in (${ids});
        commit;`);
    }
    assert.equal(dataFingerprint(), before, 'Existing application rows must remain unchanged after fixture cleanup');
    console.log('PASS all existing public-table data remains unchanged after exact fixture cleanup');
  }
})().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
