/* global __dirname */
// Privileged API checks use disposable local accounts only. Never accepts hosted URLs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql: sql } = require('./local-student-fixtures.cjs');

process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [];
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function fingerprint() {
  const tables = sql(`select schemaname||'.'||tablename from pg_tables
    where schemaname='public' or schemaname like '%\\_private' escape '\\'
      or (schemaname='auth' and tablename in ('users','identities')) order by schemaname,tablename`).split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+\.[a-z_]+$/.test(table)));
  return sql(tables.map(table => `select '${table}:'||count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${table} t`).join(' union all ')).split(/\r?\n/).sort().join('\n');
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function student() {
  const credentials = createStudentFixture(); fixtures.push(credentials);
  const auth = client(); const signup = await auth.auth.signUp(credentials); assert.ifError(signup.error);
  const id = signup.data.user?.id; assert.match(id, /^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='Moderation API fixture',is_discoverable=true,onboarding_completed_at=now() where id='${id}';`);
  const login = await auth.auth.signInWithPassword(credentials); assert.ifError(login.error);
  return { id, client: auth, token: login.data.session.access_token };
}
async function api(user, name, args = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}
async function rpc(user, name, args = {}) {
  const result = await api(user, name, args); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data;
}
async function denied(user, name, args = {}) {
  const result = await api(user, name, args); assert.equal(result.status, 403); assert.equal(result.data.code, '42501');
}
function grant(user, role, enabled = true) {
  assert.ok(['moderator', 'admin'].includes(role));
  sql(`select safety_private.assign_staff_role('${user.id}','${role}',${enabled},'Disposable local API test assignment')`);
}
const decide = (report, operation, version, status = 'reviewing', note = 'Reviewing the submitted evidence.') => ({
  p_report_id: report, p_operation_id: operation, p_expected_version: version, p_status: status, p_note: note,
});

async function main() {
  const before = fingerprint();
  try {
    const reporter = await student(), target = await student(), mod = await student(), admin = await student();
    assert.ifError((await reporter.client.auth.updateUser({ data: { role: 'admin', is_admin: true } })).error);
    assert.ifError((await reporter.client.auth.refreshSession()).error);
    reporter.token = (await reporter.client.auth.getSession()).data.session.access_token;
    assert.deepEqual(await rpc(reporter, 'get_my_moderation_access'), { role: null });
    await denied(reporter, 'list_moderation_reports');
    const anonymous = await fetch(`${url}/rest/v1/rpc/list_moderation_reports`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok([401, 403].includes(anonymous.status));
    pass('real student metadata and signed-out calls cannot grant moderation access');

    grant(mod, 'moderator'); grant(admin, 'admin');
    assert.deepEqual(await rpc(mod, 'get_my_moderation_access'), { role: 'moderator' });
    assert.deepEqual(await rpc(admin, 'get_my_moderation_access'), { role: 'admin' });
    const conversation = await rpc(reporter, 'start_direct_conversation', { p_other_profile_id: target.id });
    const message = await rpc(target, 'send_conversation_message', { p_conversation_id: conversation, p_client_message_id: randomUUID(), p_body: 'Retained reported message fixture.' });
    const report = await rpc(reporter, 'submit_safety_report', { p_operation_id: randomUUID(), p_target_type: 'message', p_target_id: message.id, p_reason: 'spam', p_details: 'Testing private evidence review.' });
    await denied(reporter, 'get_moderation_report', { p_report_id: report.report_id });
    await denied(target, 'get_moderation_report', { p_report_id: report.report_id });
    const detail = await rpc(mod, 'get_moderation_report', { p_report_id: report.report_id });
    assert.equal(detail.evidence.body, 'Retained reported message fixture.');
    for (const name of ['reporter_id', 'reported_profile_id', 'moderator_id', 'email']) assert.equal(Object.hasOwn(detail, name), false);
    assert.equal(sql(`select count(*) from safety_private.report_views where report_id='${report.report_id}' and moderator_id='${mod.id}'`), '1');
    pass('only assigned staff can read submitted evidence and successful evidence reads are audited');

    const conflict = await rpc(mod, 'submit_safety_report', { p_operation_id: randomUUID(), p_target_type: 'student', p_target_id: target.id, p_reason: 'spam', p_details: 'Own report cannot be triaged.' });
    await denied(mod, 'get_moderation_report', { p_report_id: conflict.report_id });
    await denied(mod, 'record_moderation_decision', decide(conflict.report_id, randomUUID(), 0));
    const queue = await rpc(mod, 'list_moderation_reports');
    assert.ok(queue.length <= 20);
    assert.ok(queue.every(row => row.report_id !== conflict.report_id && !Object.hasOwn(row, 'evidence') && !Object.hasOwn(row, 'details')));
    pass('conflicted staff cannot inspect or decide their own reports; queue omits evidence');

    const attempt = decide(report.report_id, randomUUID(), 0);
    const retries = await Promise.all(Array.from({ length: 8 }, () => api(mod, 'record_moderation_decision', attempt)));
    const first = retries[0].data;
    for (const result of retries) { assert.equal(result.status, 200); assert.deepEqual(result.data, first); }
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '1');
    const changed = await api(mod, 'record_moderation_decision', { ...attempt, p_note: 'Different details with the same operation.' });
    assert.equal(changed.status, 400); assert.equal(changed.data.code, '22023');
    pass('eight concurrent retries produce one decision and altered retries are rejected');

    const race = await Promise.all([
      api(mod, 'record_moderation_decision', decide(report.report_id, randomUUID(), 1, 'escalated', 'Requires additional investigation.')),
      api(admin, 'record_moderation_decision', decide(report.report_id, randomUUID(), 1, 'dismissed', 'Reviewed and dismissed this concern.')),
    ]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
    assert.equal(race.find(result => result.status === 409).data.code, 'PT409');
    const winner = race.find(result => result.status === 200).data;
    assert.equal(winner.triage_version, 2);
    assert.deepEqual(await rpc(mod, 'record_moderation_decision', attempt), first);
    const latest = await rpc(admin, 'get_moderation_report', { p_report_id: report.report_id });
    assert.equal(latest.triage_status, winner.triage_status); assert.equal(latest.history.length, 2);
    pass('simultaneous moderators get one success and one conflict; old retries cannot revert newer decisions');

    sql(`delete from public.messages where id='${message.id}'`);
    assert.equal((await rpc(admin, 'get_moderation_report', { p_report_id: report.report_id })).evidence.body, detail.evidence.body);
    pass('submitted evidence and decision history survive deletion of the original message');

    grant(mod, 'moderator', false);
    assert.deepEqual(await rpc(mod, 'get_my_moderation_access'), { role: null });
    await denied(mod, 'list_moderation_reports');
    await denied(mod, 'get_moderation_report', { p_report_id: report.report_id });
    await denied(mod, 'record_moderation_decision', attempt);
    grant(mod, 'moderator');
    assert.ifError((await mod.client.auth.signOut({ scope: 'global' })).error);
    // Deliberately reuse the old unexpired JWT. Auth session deletion must win.
    await denied(mod, 'list_moderation_reports');
    assert.deepEqual(await rpc(mod, 'get_my_moderation_access'), { role: null });
    pass('live revocation and logout deny old unexpired JWTs including saved decision retries');
  } finally {
    if (fixtures.length) {
      const emails = fixtures.map(({ email }) => { assert.match(email, /^journey-[0-9a-f-]{36}@test\.local$/); return `'${email}'`; }).join(',');
      sql(`begin;
        create temporary table moderation_fixture_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table moderation_fixture_reports on commit drop as select id from safety_private.reports
          where reporter_id in (select id from moderation_fixture_users) or reported_profile_id in (select id from moderation_fixture_users);
        delete from safety_private.report_views where report_id in (select id from moderation_fixture_reports);
        delete from safety_private.report_decisions where report_id in (select id from moderation_fixture_reports);
        delete from safety_private.staff_role_events where profile_id in (select id from moderation_fixture_users);
        delete from safety_private.staff_roles where profile_id in (select id from moderation_fixture_users);
        commit;`);
      cleanupStudentFixtures(fixtures);
    }
    assert.equal(fingerprint(), before, 'Preserve all existing Auth, public and private data');
    pass('temporary staff assignments and fixtures removed; original data fingerprints match');
  }
  console.log(`Moderation triage API checks passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
