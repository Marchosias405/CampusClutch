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
  const body = await response.text();
  return { status: response.status, data: body ? JSON.parse(body) : null };
}
async function rpc(user, name, args = {}) {
  const result = await api(user, name, args); assert.ok([200,204].includes(result.status), JSON.stringify(result)); return result.data;
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
    const reporter = await student(), target = await student(), mod = await student(), admin = await student(), colleague = await student();
    grant(mod,'moderator'); grant(admin,'admin'); grant(colleague,'admin');
    const reports = Array.from({ length: 10 }, () => randomUUID());
    reports.forEach(id => sql(`insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
      values('${id}','${reporter.id}','${target.id}',gen_random_uuid(),'student','spam','',extensions.digest('${id}','sha256'),'{}','escalated')`));
    const action = (index, kind='warn') => ({ p_report_id: reports[index], p_operation_id: randomUUID(), p_expected_version: 0,
      p_kind: kind, p_reason: 'Please follow the community rules.', p_review_updated_at: null });
    await denied(reporter,'enforce_moderation_report',action(0));
    await denied(mod,'enforce_moderation_report',action(0));
    assert.ifError((await target.client.auth.updateUser({ data: { role: 'admin', warning_count: 0, suspended_until: null } })).error);
    await denied(target,'enforce_moderation_report',action(0));
    pass('ordinary accounts, editable metadata and moderator roles cannot enforce');

    const first = action(0);
    const receipts = await Promise.all([rpc(admin,'enforce_moderation_report',first),rpc(admin,'enforce_moderation_report',first)]);
    assert.deepEqual(receipts[0],receipts[1]); assert.equal(receipts[0].warning_count,1);
    assert.equal((await api(admin,'enforce_moderation_report',{ ...first,p_kind:'suspend_7_days' })).status,400);
    assert.equal((await api(colleague,'enforce_moderation_report',{ ...action(0),p_expected_version:1 })).status,409);
    pass('simultaneous exact retries count one warning and changed/repeated actions are rejected');

    assert.deepEqual((await rpc(target,'get_my_account_standing')).notices,[]);
    assert.ok(Array.isArray(await rpc(target,'get_request_feed')));
    const warnings=await rpc(target,'get_my_notifications_v2');
    assert.equal(warnings.length,1);assert.equal(warnings[0].event_type,'account_warning');
    assert.equal(warnings[0].navigation_key,'account_notice');
    assert.ok(warnings[0].body.includes(first.p_reason));
    for(const field of ['actor_id','request_id','offer_id','conversation_id','message_id'])assert.equal(warnings[0][field],null);
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),1);
    assert.deepEqual(await rpc(reporter,'get_my_notifications_v2'),[]);
    assert.deepEqual(await rpc(target,'get_my_notifications'),[]);
    assert.equal(await rpc(target,'mark_all_my_notifications_read'),0);
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),1);
    await rpc(target,'mark_my_notification_read',{p_notification_id:warnings[0].id});
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),0);
    assert.equal((await rpc(target,'get_my_notifications_v2')).length,1);
    pass('warnings deliver once to the private bell inbox without gating access, leaking identities or breaking older clients');

    const concurrent = await Promise.all([rpc(admin,'enforce_moderation_report',action(1)),rpc(colleague,'enforce_moderation_report',action(2))]);
    assert.deepEqual(concurrent.map(x=>x.warning_count).sort(),[2,3]);
    assert.equal(concurrent.filter(x=>x.automatic_suspension).length,1);
    let standing = await rpc(target,'get_my_account_standing'); assert.equal(standing.suspended,true);
    assert.equal(standing.warning_count,3); assert.equal(standing.notices.length,3);
    pass('concurrent warnings on different reports serialize and trigger one third-warning suspension');

    for (const [name,args] of [['get_request_feed',{}],['get_my_conversations',{}],['start_direct_conversation',{p_other_profile_id:reporter.id}],['get_my_moderation_access',{}]]) {
      const result=await api(target,name,args); assert.equal(result.status,403,JSON.stringify(result.data)); assert.equal(result.data.code,'PT403');
    }
    const direct = await target.client.from('profiles').select('id'); assert.ifError(direct.error); assert.deepEqual(direct.data,[]);
    const directCourses = await target.client.from('courses').select('id'); assert.ifError(directCourses.error); assert.deepEqual(directCourses.data,[]);
    const own = await target.client.auth.getUser(); assert.ifError(own.error);
    assert.equal(own.data.user.id,target.id,'JWT is still valid; live DB enforcement denies access');
    assert.equal((await rpc(reporter,'get_my_account_standing')).warning_count,0);
    assert.ok(standing.notices.every(n => !('actor_id' in n) && !('reporter_id' in n)));
    pass('old valid JWTs cannot access RPCs or direct tables, while own notices and other accounts remain available');

    await rpc(target,'acknowledge_account_notice',{p_through:standing.notices[0].created_at});
    assert.equal((await rpc(target,'get_my_account_standing')).notices.length,0);
    sql(`update safety_private.account_standing set suspended_until=now()-interval '1 second' where profile_id='${target.id}'`);
    assert.equal((await rpc(target,'get_my_account_standing')).suspended,false);
    assert.ok(Array.isArray(await rpc(target,'get_request_feed')));
    for(let i=3;i<6;i++) await rpc(admin,'enforce_moderation_report',action(i));
    standing=await rpc(target,'get_my_account_standing'); assert.equal(standing.warning_count,6); assert.equal(standing.suspended,true);
    pass('notice acknowledgement is private, expiry restores access and the next three warnings start another suspension');

    const manual = await rpc(admin,'enforce_moderation_report',action(6,'suspend_7_days'));
    assert.equal(manual.warning_count,6); assert.equal(manual.automatic_suspension,false);
    const reviewId = randomUUID();
    sql(`insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment)
      select '${reviewId}',code,term_id,'${target.id}',3,4,true,'Disposable review for incident deduplication.' from public.courses limit 1;
      update safety_private.reports set target_type='course_review',course_review_id='${reviewId}' where id in ('${reports[8]}','${reports[9]}')`);
    const viewBefore = Number(sql(`select count(*) from safety_private.report_views where report_id='${reports[8]}'`));
    await rpc(admin,'get_moderation_enforcement',{p_report_id:reports[8]});
    assert.equal(Number(sql(`select count(*) from safety_private.report_views where report_id='${reports[8]}'`)),viewBefore+1);
    assert.equal((await rpc(admin,'enforce_moderation_report',action(8))).warning_count,7);
    assert.equal((await api(colleague,'enforce_moderation_report',action(9))).status,409);
    grant(admin,'admin',false);
    await denied(admin,'enforce_moderation_report',action(7));
    pass('manual suspension preserves totals, duplicate incident reports cannot double-warn, evidence reads audit, and revoked admins cannot act');
  } finally {
    if (fixtures.length) {
      const emails = fixtures.map(({ email }) => { assert.match(email, /^journey-[0-9a-f-]{36}@test\.local$/); return `'${email}'`; }).join(',');
      sql(`begin;
        create temporary table moderation_fixture_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table moderation_fixture_reports on commit drop as select id from safety_private.reports
          where reporter_id in (select id from moderation_fixture_users) or reported_profile_id in (select id from moderation_fixture_users);
        delete from safety_private.enforcement_actions where report_id in (select id from moderation_fixture_reports);
        delete from safety_private.account_standing where profile_id in (select id from moderation_fixture_users);
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
  console.log(`Moderation enforcement API checks passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
