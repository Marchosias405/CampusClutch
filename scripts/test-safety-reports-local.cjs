/* global __dirname */
// Real Auth/PostgREST checks for private report intake, including concurrent callers.
// Local-only generated identities are deleted, including their private report rows.
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
  return execFileSync('psql', ['-X', '-qAt', '-w', '-h', '127.0.0.1', '-p', '54322',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: statement, encoding: 'utf8', timeout: 30000, windowsHide: true,
    env: { ...process.env, PGHOSTADDR: '127.0.0.1', PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' },
  }).trim();
}
function fingerprint() {
  const tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname='public' or (schemaname='points_private' and tablename='starter_grant_claims') or (schemaname='safety_private' and tablename='reports') order by schemaname,tablename").split(/\r?\n/).filter(Boolean);
  return tables.map(table => {
    assert.match(table, /^[a-z_]+\.[a-z_]+$/);
    return table + ':' + sql(`select count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${table} t`);
  }).join('\n');
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function student() {
  const fixture = createStudentFixture();
  fixtures.push(fixture);
  const auth = client();
  const signup = await auth.auth.signUp(fixture);
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='Safety API Tester',is_discoverable=true,onboarding_completed_at=now() where id='${id}';`);
  const signin = await auth.auth.signInWithPassword(fixture);
  if (signin.error) throw signin.error;
  return { id, client: auth };
}
const submit = (user, args) => user.client.rpc('submit_safety_report', args);
const payload = (target, details = 'A report from the local API fixture.') => ({
  p_operation_id: randomUUID(), p_target_type: 'student', p_target_id: target.id,
  p_reason: 'other', p_details: details,
});
function countFor(user) {
  return Number(sql(`select count(*) from safety_private.reports where reporter_id='${user.id}'`));
}

async function main() {
  const before = fingerprint();
  try {
    const reporter = await student();
    const target = await student();
    const secondReporter = await student();
    const anonymous = await submit({ client: client() }, payload(target));
    assert.equal(anonymous.error?.code, '42501');
    pass('real anonymous HTTP caller cannot submit a report');

    const identical = payload(target);
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => submit(reporter, identical)));
    duplicates.forEach(({ data, error }) => {
      assert.equal(error, null);
      assert.deepEqual(data, duplicates[0].data);
      assert.deepEqual(Object.keys(data).sort(), ['created_at', 'report_id']);
    });
    assert.equal(countFor(reporter), 1);
    pass('eight simultaneous identical API requests return one durable receipt and row');

    for (let i = 0; i < 7; i++) {
      const result = await submit(reporter, payload(target));
      assert.equal(result.error, null);
    }
    const burst = await Promise.all(Array.from({ length: 6 }, () => submit(reporter, payload(target))));
    assert.equal(burst.filter(result => !result.error).length, 2);
    assert.equal(burst.filter(result => result.error?.code === '54000').length, 4);
    assert.equal(countFor(reporter), 10);
    pass('simultaneous new reports cannot exceed the shared 10-report quota');

    const atLimit = await Promise.all(Array.from({ length: 4 }, () => submit(reporter, identical)));
    atLimit.forEach(result => {
      assert.equal(result.error, null);
      assert.deepEqual(result.data, duplicates[0].data);
    });
    assert.equal(countFor(reporter), 10);
    pass('concurrent exact retries remain safe when the reporter is at the limit');

    const conflict = payload(target, 'Original details for the competing attempt.');
    const conflictResults = await Promise.all([
      submit(secondReporter, conflict),
      submit(secondReporter, { ...conflict, p_details: 'Different details for the same operation.' }),
    ]);
    assert.equal(conflictResults.filter(result => !result.error).length, 1);
    assert.equal(conflictResults.filter(result => result.error?.code === '22023').length, 1);
    assert.equal(countFor(secondReporter), 1);
    pass('competing payloads with one operation id cannot overwrite each other');

    const privateRead = await reporter.client.schema('safety_private').from('reports').select('*');
    assert.equal(privateRead.data, null);
    assert.ok(privateRead.error);
    const guessedPublicTable = await reporter.client.from('reports').select('*');
    assert.equal(guessedPublicTable.data, null);
    assert.ok(guessedPublicTable.error);
    pass('PostgREST exposes no report-table read endpoint');

    sql(`update public.profiles set is_discoverable=false where id='${target.id}'`);
    const hidden = await submit(secondReporter, payload(target));
    assert.equal(hidden.error?.code, '42501');
    const retryAfterHidden = await submit(reporter, identical);
    assert.equal(retryAfterHidden.error, null);
    assert.deepEqual(retryAfterHidden.data, duplicates[0].data);
    pass('HTTP retries return saved receipts after visibility changes while new reports are denied');
  } finally {
    cleanupStudentFixtures(fixtures);
    assert.equal(fingerprint(), before, 'All original public data and private report/starter receipts must remain unchanged');
    pass('all disposable identities and rows removed; original database fingerprints unchanged');
  }
  console.log(`Safety report API checks passed: ${checks}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Safety report API check failed');
  process.exitCode = 1;
});
