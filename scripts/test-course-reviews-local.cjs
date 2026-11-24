/* global __dirname */
// Real Auth + PostgREST smoke coverage for the shipped course-review client.
// Local only. Random fixture courses/accounts and their exact welcome claims
// are removed in finally; existing application/Auth rows are fingerprinted.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321', 'Only local Supabase is supported');
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(key, 'Local publishable key is required');
const users = [], attemptedEmails = [];
const courseIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const courseCode = 'REVIEW ' + crypto.randomBytes(5).toString('hex').toUpperCase();
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function sql(query) {
  const pgEnv = { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=20000' };
  delete pgEnv.PGHOSTADDR; delete pgEnv.PGSERVICE; delete pgEnv.PGSERVICEFILE;
  const out = cp.spawnSync('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { env: pgEnv, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (out.error) throw out.error;
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}
function fingerprint() {
  const tables = sql("select schemaname || '.' || tablename from pg_tables where schemaname in ('public','course_reviews_private','points_private','messaging_private') or (schemaname='auth' and tablename in ('users','identities')) order by schemaname,tablename")
    .split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+\.[a-z_]+$/.test(table)));
  // Only counts and digests leave PostgreSQL; raw Auth data and HMAC keys never do.
  return sql(tables.map(table => `select '${table}' || ':' || count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from ${table} t`).join(' union all '));
}
const compile = relative => ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const types = {};
vm.runInNewContext(compile('src/types/courseReview.ts'), { exports: types });
const compiled = compile('src/lib/courseReviews.ts');
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
function service(supabase) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, require: name => {
    if (name === '@/lib/supabase') return { supabase };
    if (name === '@/types/courseReview') return types;
    throw Error('Unexpected runtime import: ' + name);
  } });
  return exports;
}
async function account() {
  const supabase = client();
  const email = 'reviews-api-' + crypto.randomUUID() + '@test.local';
  const password = crypto.randomBytes(24).toString('hex');
  attemptedEmails.push(email);
  const signup = await supabase.auth.signUp({ email, password });
  assert.ifError(signup.error);
  const id = signup.data.user?.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, supabase, api: service(supabase) };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id=${quote(id)};
    update public.profiles set display_name='Course Review API Tester',onboarding_completed_at=now() where id=${quote(id)};`);
  assert.ifError((await supabase.auth.signInWithPassword({ email, password })).error);
  return user;
}
async function rpc(user, name, args) {
  const { data, error } = await user.supabase.rpc(name, args);
  assert.ifError(error);
  return data;
}
const gradeCount = (summary, grade) => summary.gradeCounts.find(bin => bin.grade === grade).count;
function assertAnonymous(value, knownUsers) {
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    for (const [name, nested] of Object.entries(item)) {
      assert.ok(!['author_id', 'profile_id', 'email', 'display_name', 'avatar_path'].includes(name), 'No author field: ' + name);
      visit(nested);
    }
  };
  visit(value);
  const text = JSON.stringify(value);
  for (const user of knownUsers) assert.ok(!text.includes(user.id), 'No author ID in HTTP response');
  assert.ok(!text.includes('Course Review API Tester'), 'No profile name in HTTP response');
}
(async () => {
  assert.equal(sql("select to_regclass('course_reviews_private.reviews')::text"), 'course_reviews_private.reviews', 'Apply the local review migration first');
  const before = fingerprint();
  try {
    const currentTerm = sql("select id from public.academic_terms where status='current' order by starts_on desc limit 1");
    const pastTerm = sql("select id from public.academic_terms where status='past' order by starts_on desc limit 1");
    assert.match(currentTerm, /^[0-9a-f-]{36}$/); assert.match(pastTerm, /^[0-9a-f-]{36}$/);
    sql(`insert into public.courses(id,code,title,term_id,campus_id,status) values
      (${quote(courseIds[0])},${quote(courseCode)},'Temporary course review test',${quote(currentTerm)},null,'active'),
      (${quote(courseIds[1])},${quote(courseCode)},'Temporary course review test',${quote(pastTerm)},null,'active'),
      (${quote(courseIds[2])},${quote(courseCode)},'Temporary course review test',${quote(currentTerm)},(select id from public.campuses where slug='burnaby'),'active');`);
    const a = await account(), b = await account(), outsider = await account();
    const anon = client();
    const denied = await anon.rpc('get_course_review_summary', { p_course_code: courseCode });
    assert.ok(denied.error);
    pass('signed-out HTTP clients cannot access review RPCs');
    assert.equal((await outsider.api.getCourseReviewSummary(courseCode, outsider.id)).reviewCount, 0);
    await rpc(a, 'join_my_course', { p_course_id: courseIds[0] });
    await rpc(a, 'join_my_course', { p_course_id: courseIds[2] });
    await rpc(b, 'join_my_course', { p_course_id: courseIds[1] });
    const input = { termId: currentTerm, difficulty: 2, workload: 4, recommend: true, grade: 'A',
      comment: 'A useful course with clear explanations and practical work.', tips: 'Plan revision time each week.',
      instructor: 'Test Instructor', tags: ['Useful', 'Practical skills'] };
    assert.equal((await a.api.getCourseReviewSummary(courseCode, a.id)).eligibleTerms.length, 1);
    pass('current memberships across campuses deduplicate to one review term');
    await assert.rejects(outsider.api.saveCourseReview(courseCode, outsider.id, input), /Add this course/);
    pass('nonmembers cannot bypass enrollment eligibility through HTTP writes');
    const idA = await a.api.saveCourseReview(courseCode, a.id, input);
    assert.equal(await a.api.saveCourseReview(courseCode, a.id, input), idA);
    const idB = await b.api.saveCourseReview(courseCode, b.id, { ...input, termId: pastTerm, difficulty: 4, workload: 2, recommend: false, grade: 'B-' });
    let summary = await a.api.getCourseReviewSummary(courseCode.toLowerCase(), a.id);
    assert.equal(summary.reviewCount, 2);
    assert.equal(summary.averageDifficulty, 3); assert.equal(summary.averageWorkload, 3);
    assert.equal(summary.recommendPercent, 50);
    assert.equal(gradeCount(summary, 'A'), 1); assert.equal(gradeCount(summary, 'B-'), 1);
    assert.equal(summary.myReviews.length, 1); assert.equal(summary.myReviews[0].id, idA);
    pass('retry-safe saves and cross-semester reviews feed one authoritative summary');
    const rawSummary = await rpc(outsider, 'get_course_review_summary', { p_course_code: courseCode });
    const rawReviews = await rpc(outsider, 'list_course_reviews', { p_course_code: courseCode });
    assertAnonymous(rawSummary, users); assertAnonymous(rawReviews, users);
    assert.deepEqual(rawSummary.my_reviews, []);
    assert.ok(rawReviews.every(review => !review.is_mine));
    assert.ok(rawReviews.every(review => typeof review.term_name === 'string'));
    assert.equal(rawReviews.find(review => review.id === idB).created_at, rawReviews.find(review => review.id === idB).updated_at);
    const privateRead = await outsider.supabase.schema('course_reviews_private').from('reviews').select('author_id');
    assert.ok(privateRead.error);
    const privateRpc = await outsider.supabase.schema('course_reviews_private').rpc('require_actor');
    assert.ok(privateRpc.error);
    pass('real PostgREST responses contain no reviewer identity and private schema is not exposed');
    await outsider.api.deleteCourseReview(idA, outsider.id);
    assert.equal((await outsider.api.getCourseReviewSummary(courseCode, outsider.id)).reviewCount, 2);
    await assert.rejects(a.api.saveCourseReview(courseCode, b.id, input), /account changed/i);
    pass('ownership and client account pinning prevent cross-account mutations');
    await a.api.saveCourseReview(courseCode, a.id, { ...input, grade: 'C+', difficulty: 5 });
    summary = await b.api.getCourseReviewSummary(courseCode, b.id);
    assert.equal(summary.reviewCount, 2); assert.equal(gradeCount(summary, 'A'), 0); assert.equal(gradeCount(summary, 'C+'), 1);
    assert.equal(summary.averageDifficulty, 4.5);
    pass('another client sees edited scores and replacement grade without duplicate contributions');
    const page = await b.api.getCourseReviews(courseCode, b.id);
    assert.equal(page.reviews.length, 2); assert.equal(page.nextCursor, null);
    assert.equal(page.reviews.find(review => review.id === idB).isMine, true);
    assert.equal(page.reviews.find(review => review.id === idA).isMine, false);
    pass('the production review client maps anonymous feed and own-review status correctly');
    await a.api.deleteCourseReview(idA, a.id);
    summary = await b.api.getCourseReviewSummary(courseCode, b.id);
    assert.equal(summary.reviewCount, 1); assert.equal(gradeCount(summary, 'C+'), 0); assert.equal(gradeCount(summary, 'B-'), 1);
    await b.api.deleteCourseReview(idB, b.id);
    summary = await outsider.api.getCourseReviewSummary(courseCode, outsider.id);
    assert.equal(summary.reviewCount, 0); assert.equal(summary.averageDifficulty, null);
    assert.ok(summary.gradeCounts.every(bin => bin.count === 0));
    pass('deletes immediately remove grade and aggregate contributions through HTTP');
  } finally {
    if (attemptedEmails.length) {
      const emails = attemptedEmails.map(quote).join(',');
      sql(`begin;
        delete from auth.users where email in (${emails});
        delete from points_private.starter_grant_claims where email_fingerprint in
          (select points_private.email_fingerprint(email) from unnest(array[${emails}]::text[]) email);
        delete from public.courses where id in (${courseIds.map(quote).join(',')});
        commit;`);
    } else {
      sql(`delete from public.courses where id in (${courseIds.map(quote).join(',')})`);
    }
    for (const user of users) await user.supabase.auth.stopAutoRefresh();
    assert.equal(fingerprint(), before, 'Existing application/Auth/private data must survive exact fixture cleanup unchanged');
    pass('exact fixture cleanup preserves all original application, Auth and private data');
  }
  console.log(`Local course reviews API: ${checks} checks passed.`);
})().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
