/* global __dirname */
// Real local Auth/PostgREST regression coverage. Never accepts a hosted backend.
// Only generated identities/course data are mutated; cleanup verifies all originals.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig } = require('./local-student-fixtures.cjs');

process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [];
const courseId = randomUUID(), groupId = randomUUID(), groupMessageId = randomUUID();
const courseCode = 'SAFETY ' + randomBytes(5).toString('hex').toUpperCase();
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function sql(statement) {
  return execFileSync('psql', ['-X', '-qAt', '-w', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: statement, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, PGHOSTADDR: '127.0.0.1', PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' },
  }).trim();
}
function fingerprint(includeReports = true) {
  const tables = sql(`select schemaname||'.'||tablename from pg_tables
    where schemaname='public' or schemaname like '%\\_private' escape '\\'
      or (schemaname='auth' and tablename in ('users','identities')) order by schemaname,tablename`)
    .split(/\r?\n/).filter(table => table && (includeReports || table !== 'safety_private.reports'));
  assert.ok(tables.every(table => /^[a-z_]+\.[a-z_]+$/.test(table)));
  return sql(tables.map(table => `select '${table}:'||count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${table} t`).join(' union all '));
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function student() {
  const credentials = createStudentFixture(); fixtures.push(credentials);
  const auth = client(); const signup = await auth.auth.signUp(credentials); assert.ifError(signup.error);
  const id = signup.data.user?.id; assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='Content Safety API Tester',is_discoverable=true,onboarding_completed_at=now() where id='${id}';`);
  assert.ifError((await auth.auth.signInWithPassword(credentials)).error);
  return { id, client: auth };
}
async function rpc(user, name, args) {
  const result = await user.client.rpc(name, args); assert.ifError(result.error); return result.data;
}
const args = (type, id, operationId = randomUUID()) => ({ p_operation_id: operationId, p_target_type: type, p_target_id: id, p_reason: 'spam', p_details: 'Local content safety regression.' });
const submit = (user, input) => user.client.rpc('submit_safety_report', input);
const resolve = (user, type, id) => user.client.rpc('get_safety_report_target', { p_target_type: type, p_target_id: id });
const count = user => Number(sql(`select count(*) from safety_private.reports where reporter_id='${user.id}'`));
function receipt(result) {
  assert.ifError(result.error); assert.deepEqual(Object.keys(result.data).sort(), ['created_at', 'report_id']);
  assert.match(result.data.report_id, /^[0-9a-f-]{36}$/); return result.data;
}
async function unavailable(user, type, id) {
  for (const result of [await resolve(user, type, id), await submit(user, args(type, id))]) {
    assert.equal(result.error?.code, '42501');
    assert.equal(result.error?.message, 'This report target is not available.');
    assert.equal(result.data, null);
  }
}

async function main() {
  const before = fingerprint();
  try {
    const a = await student(), b = await student(), outsider = await student();
    const termId = sql("select id from public.academic_terms where status='current' order by starts_on desc limit 1");
    assert.match(termId, /^[0-9a-f-]{36}$/);
    sql(`insert into public.courses(id,code,title,term_id,status) values('${courseId}','${courseCode}','Content safety fixture','${termId}','active');`);
    await rpc(b, 'join_my_course', { p_course_id: courseId });
    const reviewId = await rpc(b, 'save_my_course_review', { p_course_code: courseCode, p_term_id: termId, p_difficulty: 2, p_workload: 3, p_recommend: true, p_grade: 'A', p_comment: 'A unique fixture review with useful practical examples.', p_tips: '', p_instructor: '', p_tags: [] });
    const conversationId = await rpc(a, 'start_direct_conversation', { p_other_profile_id: b.id });
    const send = (who, body) => rpc(who, 'send_conversation_message', { p_conversation_id: conversationId, p_client_message_id: randomUUID(), p_body: body });
    const incoming = await send(b, 'A private incoming fixture message.');
    const own = await send(a, 'The reporting account owns this message.');
    // Groups are deferred in the product. A narrowly generated stored group row
    // proves a guessed group-message ID cannot bypass direct-only reporting.
    sql(`insert into public.conversations(id,type,created_by) values('${groupId}','group','${b.id}');
      insert into public.conversation_members(conversation_id,profile_id) values('${groupId}','${a.id}'),('${groupId}','${b.id}');
      insert into public.messages(id,conversation_id,sender_id,client_message_id,sequence,body) values('${groupMessageId}','${groupId}','${b.id}','${randomUUID()}',1,'Deferred group fixture message.');`);
    const requestId = await rpc(b, 'save_my_request', { p_payload: { category: 'delivery', title: 'Content report quota fixture', description: 'Temporary local request for mixed report quotas.', campus_id: sql("select id from public.campuses where slug='burnaby'"), room_location: 'Library', deadline_at: '2099-01-01T00:00:00Z', points: 10, item_size: 'small', details: { pickup_location: 'Cafe', dropoff_location: 'Library' } } });

    const anon = { client: client() };
    for (const [type, id] of [['message', incoming.id], ['course_review', reviewId]]) {
      assert.equal((await resolve(anon, type, id)).error?.code, '42501');
      assert.equal((await submit(anon, args(type, id))).error?.code, '42501');
    }
    await unavailable(a, 'message', own.id);
    await unavailable(outsider, 'message', incoming.id);
    await unavailable(a, 'message', groupMessageId);
    await unavailable(a, 'message', randomUUID());
    await unavailable(b, 'course_review', reviewId);
    await unavailable(a, 'course_review', randomUUID());
    pass('anonymous, own, missing, unrelated and deferred-group content cannot be reported');

    const publicReviews = await rpc(outsider, 'list_course_reviews', { p_course_code: courseCode });
    assert.equal(publicReviews.length, 1); assert.equal(publicReviews[0].is_mine, false);
    const publicText = JSON.stringify(publicReviews);
    for (const user of [a, b, outsider]) assert.ok(!publicText.includes(user.id));
    for (const name of ['author_id', 'email', 'display_name', 'profile_id']) assert.ok(!publicText.includes('"' + name + '"'));
    for (const [type, id, label] of [['message', incoming.id, 'Direct message'], ['course_review', reviewId, courseCode + ' course review']]) {
      const result = await resolve(a, type, id); assert.ifError(result.error);
      assert.deepEqual(result.data, { target_type: type, target_id: id, target_label: label });
    }
    const outsiderContext = await resolve(outsider, 'course_review', reviewId); assert.ifError(outsiderContext.error);
    sql(`update auth.users set banned_until=now()+interval '1 hour' where id='${outsider.id}'`);
    assert.equal((await outsider.client.rpc('list_course_reviews', { p_course_code: courseCode })).error?.code, '42501');
    assert.equal((await resolve(outsider, 'course_review', reviewId)).error?.code, '42501');
    assert.equal((await submit(outsider, args('course_review', reviewId))).error?.code, '42501');
    sql(`update auth.users set banned_until=null where id='${outsider.id}'`);
    pass('review reporting follows current read eligibility without exposing its anonymous author');

    await rpc(a, 'set_student_block', { p_profile_id: b.id, p_blocked: true, p_expected_revision: 0 });
    const history = await a.client.from('messages').select('id').eq('id', incoming.id); assert.ifError(history.error);
    assert.deepEqual(history.data, [{ id: incoming.id }]);
    assert.ifError((await resolve(a, 'message', incoming.id)).error);
    const effectsBefore = fingerprint(false);
    const messageAttempt = args('message', incoming.id), reviewAttempt = args('course_review', reviewId);
    const messageResults = await Promise.all(Array.from({ length: 6 }, () => submit(a, messageAttempt)));
    const messageReceipt = receipt(messageResults[0]);
    messageResults.forEach(result => assert.deepEqual(receipt(result), messageReceipt));
    const reviewResults = await Promise.all(Array.from({ length: 6 }, () => submit(a, reviewAttempt)));
    const reviewReceipt = receipt(reviewResults[0]);
    reviewResults.forEach(result => assert.deepEqual(receipt(result), reviewReceipt));
    assert.equal(count(a), 2);
    assert.equal(fingerprint(false), effectsBefore, 'Reports cannot change content, points, enrollment, blocks or notification rows');
    pass('blocked-peer history stays reportable; concurrent exact retries save once with no content/points/notification effects');
    await rpc(a, 'set_student_block', { p_profile_id: b.id, p_blocked: false, p_expected_revision: 1 });

    for (const who of [a, b]) {
      for (const read of [await who.client.schema('safety_private').from('reports').select('*'), await who.client.from('reports').select('*')]) {
        assert.equal(read.data, null); assert.ok(read.error);
      }
    }
    const privateReview = await a.client.schema('course_reviews_private').from('reviews').select('author_id');
    assert.equal(privateReview.data, null); assert.ok(privateReview.error);
    pass('neither reporter nor content author can read private reports or reviewer identities through REST');

    const competingOperation = randomUUID();
    const competing = await Promise.all([submit(outsider, args('course_review', reviewId, competingOperation)), submit(outsider, args('student', b.id, competingOperation))]);
    assert.equal(competing.filter(result => !result.error).length, 1);
    assert.equal(competing.filter(result => result.error?.code === '22023').length, 1);
    assert.equal(count(outsider), 1);
    const targets = [['student', b.id], ['request', requestId], ['message', incoming.id], ['course_review', reviewId]];
    for (let i = 0; i < 6; i++) receipt(await submit(a, args(...targets[i % targets.length])));
    const mixed = await Promise.all(Array.from({ length: 8 }, (_, i) => submit(a, args(...targets[i % targets.length]))));
    assert.equal(mixed.filter(result => !result.error).length, 2);
    assert.equal(mixed.filter(result => result.error?.code === '54000').length, 6);
    assert.equal(count(a), 10);
    pass('operation conflicts and concurrent quota limits span all four report target types');

    sql(`delete from public.messages where id='${incoming.id}'`);
    assert.equal(await rpc(b, 'delete_my_course_review', { p_review_id: reviewId }), true);
    await unavailable(outsider, 'message', incoming.id);
    await unavailable(outsider, 'course_review', reviewId);
    const retries = await Promise.all([submit(a, messageAttempt), submit(a, reviewAttempt), submit(a, messageAttempt), submit(a, reviewAttempt)]);
    retries.forEach((result, index) => assert.deepEqual(receipt(result), index % 2 ? reviewReceipt : messageReceipt));
    assert.equal(count(a), 10);
    assert.equal((await submit(a, { ...reviewAttempt, p_details: 'Changed retry after content deletion.' })).error?.code, '22023');
    pass('saved exact receipts survive target deletion and quota exhaustion; changed retries are rejected');
  } finally {
    cleanupStudentFixtures(fixtures);
    sql(`delete from public.courses where id='${courseId}'`);
    assert.equal(fingerprint(), before, 'All original Auth, public and private data must survive fixture cleanup');
    pass('exact disposable cleanup preserves every original application/Auth/private fingerprint');
  }
  console.log(`Content safety report API checks passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
