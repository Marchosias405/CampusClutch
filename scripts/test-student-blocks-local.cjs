/* global __dirname */
// Real Auth/PostgREST tests: pair locking, versioned retries, and data preservation.
// Only local disposable identities created by this process may be removed.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig } = require('./local-student-fixtures.cjs');
process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [];
let checks = 0;
function pass(label) { checks++; console.log('PASS ' + label); }
function sql(statement) {
  return execFileSync('psql', ['-X', '-qAt', '-w', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: statement, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, PGHOSTADDR: '127.0.0.1', PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' },
  }).trim();
}
function fingerprint() {
  const tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname='public' or schemaname='safety_private' or (schemaname='points_private' and tablename='starter_grant_claims') order by schemaname,tablename").split(/\r?\n/).filter(Boolean);
  return tables.map(table => {
    assert.match(table, /^[a-z_]+\.[a-z_]+$/);
    return table + ':' + sql(`select count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${table} t`);
  }).join('\n');
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function student() {
  const fixture = createStudentFixture(); fixtures.push(fixture);
  const auth = client();
  const signup = await auth.auth.signUp(fixture);
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Block API Tester',is_discoverable=true,onboarding_completed_at=now() where id='${id}';`);
  const signin = await auth.auth.signInWithPassword(fixture);
  if (signin.error) throw signin.error;
  return { id, client: auth };
}
// Intentional stale-version conflicts must finish as HTTP409; SQLSTATE40001
// can make PostgREST retry internally. Bound requests so that regression still
// reaches fixture cleanup instead of leaving an indefinitely running test.
const rpc = (user, name, args) => user.client.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
async function ok(user, name, args) {
  const result = await rpc(user, name, args);
  assert.equal(result.error, null, name + ': ' + JSON.stringify(result.error));
  return result.data;
}
const block = (user, peer, desired, revision) => rpc(user, 'set_student_block', { p_profile_id: peer.id, p_blocked: desired, p_expected_revision: revision });
const state = (user, peer) => ok(user, 'get_student_block_state', { p_profile_id: peer.id });
const send = (user, chat, id, body) => rpc(user, 'send_conversation_message', { p_conversation_id: chat, p_client_message_id: id, p_body: body });
const points = user => ok(user, 'get_my_points');
const expected = (peer, own, either, revision) => ({ profile_id: peer.id, blocked_by_me: own, interaction_blocked: either, revision: String(revision) });
async function request(user, amount = 10) {
  return ok(user, 'save_my_request', { p_payload: {
    category: 'delivery', title: 'Local blocking race', description: 'Disposable public workflow fixture.',
    campus_id: sql("select id from public.campuses where slug='burnaby'"), room_location: 'Library',
    deadline_at: new Date(Date.now() + 86400000).toISOString(), points: amount, item_size: 'medium',
    details: { pickup_location: 'Cafe', dropoff_location: 'Library' },
  } });
}
const offer = (user, requestId) => ok(user, 'create_my_request_offer_for_terms', { p_request_id: requestId, p_expected_round: 1, p_expected_points: 10 });
const acceptArgs = offerId => ({ p_offer_id: offerId, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });

async function main() {
  const before = fingerprint();
  let runError = null;
  try {
    const a = await student(), b = await student(), c = await student();
    assert.equal((await block({ client: client() }, b, true, '0')).error?.code, '42501');
    pass('anonymous HTTP caller cannot mutate blocks');
    for (const peer of [a, { id: randomUUID() }]) assert.ok((await block(a, peer, true, '0')).error);
    sql(`update public.profiles set is_discoverable=false where id='${c.id}'`);
    assert.equal((await block(a, c, true, '0')).error?.code, '42501');
    sql(`update public.profiles set is_discoverable=true where id='${c.id}'`);
    pass('self, random and inaccessible targets are rejected');
    assert.deepEqual(await state(a, b), expected(b, false, false, 0));
    const chat = await ok(a, 'start_direct_conversation', { p_other_profile_id: b.id });
    const oldId = randomUUID();
    const oldMessage = await send(b, chat, oldId, 'Preserved history');
    assert.equal(oldMessage.error, null);
    const walletBefore = [await points(a), await points(b)];
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => block(a, b, true, '0')));
    duplicates.forEach(result => { assert.equal(result.error, null); assert.deepEqual(result.data, expected(b, true, true, 1)); });
    assert.equal(Number(sql(`select count(*) from safety_private.student_blocks where blocker_id='${a.id}' and blocked_id='${b.id}'`)), 1);
    pass('eight simultaneous exact block retries produce one directional row and revision');
    assert.deepEqual(await state(b, a), expected(a, false, true, 0));
    assert.deepEqual(await ok(b, 'get_my_blocked_students'), []);
    const denied = await a.client.schema('safety_private').from('student_blocks').select('*');
    assert.ok(denied.error); assert.equal(denied.data, null);
    pass('reverse block rows remain private and unowned');
    const oldRetry = await send(b, chat, oldId, 'Preserved history');
    assert.equal(oldRetry.error, null); assert.deepEqual(oldRetry.data, oldMessage.data);
    assert.equal((await ok(a, 'get_conversation_messages', { p_conversation_id: chat })).length, 1);
    assert.equal((await send(a, chat, randomUUID(), 'Denied forward')).error?.code, '42501');
    assert.equal((await send(b, chat, randomUUID(), 'Denied reverse')).error?.code, '42501');
    assert.equal((await rpc(b, 'start_direct_conversation', { p_other_profile_id: a.id })).error?.code, '42501');
    assert.deepEqual([await points(a), await points(b)], walletBefore);
    pass('both directions reject new contact while history, exact retries and wallets are preserved');
    assert.equal((await block(b, a, true, '0')).error, null);
    const unblocks = await Promise.all(Array.from({ length: 6 }, () => block(a, b, false, '1')));
    unblocks.forEach(result => { assert.equal(result.error, null); assert.deepEqual(result.data, expected(b, false, true, 2)); });
    const stale = await block(a, b, true, '0');
    assert.equal(stale.error?.code, 'PT409'); assert.equal(stale.status, 409);
    assert.equal((await block(b, a, false, '1')).error, null);
    assert.deepEqual(await state(a, b), expected(b, false, false, 2));
    pass('mutual unblock removes only own direction and rejects delayed contradictory intent');

    // Stress the block/send ordering with actual independent HTTP transactions.
    let revision = 2;
    for (let attempt = 0; attempt < 5; attempt++) {
      const messageId = randomUUID();
      const [blocked, delivered] = await Promise.all([block(a, b, true, String(revision)), send(b, chat, messageId, 'Concurrent disposable message')]);
      assert.equal(blocked.error, null); revision++;
      assert.ok(delivered.error === null || delivered.error.code === '42501');
      assert.equal((await send(b, chat, randomUUID(), 'After completed block')).error?.code, '42501');
      assert.equal(Number(sql(`select count(*) from public.messages where sender_id='${b.id}' and client_message_id='${messageId}'`)), delivered.error ? 0 : 1);
      assert.equal((await block(a, b, false, String(revision))).error, null); revision++;
    }
    pass('concurrent send versus block is serialized; no send begins after completed block');

    // Acceptance can win the race, but a block never silently changes a job or hold.
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = await request(a), offered = await offer(b, job);
      const [blocked, accepted] = await Promise.all([block(a, b, true, String(revision)), rpc(a, 'decide_request_offer_for_round', acceptArgs(offered))]);
      assert.equal(blocked.error, null); revision++;
      assert.ok(accepted.error === null || accepted.error.code === '42501');
      const jobState = sql(`select status from public.requests where id='${job}'`);
      assert.equal(jobState, accepted.error ? 'open' : 'accepted');
      assert.equal((await points(a)).reserved, accepted.error ? 0 : 10);
      await ok(a, 'cancel_my_request_for_round', { p_request_id: job, p_expected_round: 1, p_expected_status: jobState });
      assert.equal((await points(a)).reserved, 0);
      assert.equal((await block(a, b, false, String(revision))).error, null); revision++;
    }
    pass('concurrent accept versus block preserves valid accepted work and cancellation releases exactly once');

    const job = await request(a), offered = await offer(b, job);
    await ok(a, 'decide_request_offer_for_round', acceptArgs(offered));
    assert.equal((await block(a, b, true, String(revision))).error, null); revision++;
    await Promise.all(Array.from({ length: 4 }, () => ok(a, 'complete_my_request', { p_request_id: job, p_expected_round: 1 })));
    assert.equal((await points(a)).balance, 90); assert.equal((await points(b)).balance, 110);
    assert.equal((await points(a)).reserved, 0);
    pass('four concurrent completion retries after blocking transfer points exactly once');
    const thirdChat = await ok(a, 'start_direct_conversation', { p_other_profile_id: c.id });
    assert.equal((await send(c, thirdChat, randomUUID(), 'Unaffected third party')).error, null);
    assert.equal((await block(a, c, true, '0')).error, null);
    const first = await ok(a, 'get_my_blocked_students', { p_limit: 1, p_offset: 0 });
    const second = await ok(a, 'get_my_blocked_students', { p_limit: 1, p_offset: 1 });
    assert.equal(first.length, 1); assert.equal(second.length, 1); assert.notEqual(first[0].profile_id, second[0].profile_id);
    assert.deepEqual(Object.keys(first[0]).sort(), ['blocked_at', 'display_name', 'profile_id', 'revision']);
    pass('unrelated students stay contactable and owned block pagination exposes only approved fields');
  } catch (error) {
    runError = error;
  } finally {
    try {
      cleanupStudentFixtures(fixtures);
      assert.equal(fingerprint(), before, 'All original public data and private block/report/starter receipts must remain unchanged');
      pass('all disposable identities and data removed; original database fingerprints unchanged');
    } catch (cleanupError) {
      if (runError) throw new AggregateError([runError, cleanupError], 'Blocking regression and cleanup verification both failed');
      throw cleanupError;
    }
  }
  if (runError) throw runError;
  console.log(`Student block API checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
