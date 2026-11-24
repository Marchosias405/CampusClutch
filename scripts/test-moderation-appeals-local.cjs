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
 const before=fingerprint();
 try {
   const reporter=await student(),target=await student(),mod=await student(),admin=await student(),colleague=await student();
   grant(admin,'admin');grant(colleague,'admin');grant(mod,'moderator');
   const reports=Array.from({length:8},()=>randomUUID());
   reports.forEach(id=>sql(`insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
     values('${id}','${reporter.id}','${target.id}',gen_random_uuid(),'student','spam','',extensions.digest('${id}','sha256'),'{}','escalated')`));
   const issue=i=>rpc(admin,'enforce_moderation_report',{p_report_id:reports[i],p_operation_id:randomUUID(),p_expected_version:0,p_kind:'warn',p_reason:'Please follow the community rules.',p_review_updated_at:null});
   const warnings=[];for(let i=0;i<3;i++)warnings.push(await issue(i));
   const submit=i=>({p_action_id:warnings[i].action_id,p_operation_id:randomUUID(),p_explanation:'Please reconsider this decision with the additional context.'});
   const attempt=submit(0);
   const ids=await Promise.all([rpc(target,'submit_moderation_appeal',attempt),rpc(target,'submit_moderation_appeal',attempt)]);
   assert.equal(ids[0],ids[1]);
   const otherAttempt=submit(0);
   assert.equal((await api(target,'submit_moderation_appeal',otherAttempt)).status,409);
   assert.equal((await api(target,'submit_moderation_appeal',{...attempt,p_explanation:'A different explanation after the first attempt.'})).status,400);
   assert.equal((await api(target,'get_request_feed')).status,403);
   assert.equal((await rpc(target,'get_my_moderation_actions')).length,3);
   pass('suspended real Auth session can appeal exactly once under simultaneous retries while app data stays blocked');
   await denied(reporter,'submit_moderation_appeal',submit(1));
   await denied(reporter,'get_moderation_appeal',{p_appeal_id:ids[0]});
   await denied(mod,'list_moderation_appeals');
   assert.deepEqual(await rpc(reporter,'get_my_moderation_actions'),[]);
   const own=await rpc(target,'get_my_moderation_actions');
   assert.ok(!JSON.stringify(own).includes(reporter.id));assert.ok(!JSON.stringify(own).includes(admin.id));
   pass('other students and moderators cannot see appeals; own history excludes reporter and admin identities');
   const outcome={p_appeal_id:ids[0],p_operation_id:randomUUID(),p_expected_version:0,p_outcome:'overturned',p_reason:'This warning was incorrect after reviewing the context.'};
   const decisions=await Promise.all([rpc(admin,'resolve_moderation_appeal',outcome),rpc(admin,'resolve_moderation_appeal',outcome)]);
   assert.deepEqual(decisions[0],decisions[1]);
   assert.equal((await api(colleague,'resolve_moderation_appeal',{...outcome,p_operation_id:randomUUID()})).status,409);
   let standing=await rpc(target,'get_my_account_standing');assert.equal(standing.warning_count,2);assert.equal(standing.suspended,false);
   const inbox=await rpc(target,'get_my_notifications_v2');assert.equal(inbox.filter(n=>n.title==='Warning overturned').length,1);
   pass('concurrent resolution retry creates one audit result and an earlier-warning reversal removes its derived suspension');
   const a2=await rpc(target,'submit_moderation_appeal',submit(1));
   const contested={p_appeal_id:a2,p_operation_id:randomUUID(),p_expected_version:0,p_outcome:'upheld',p_reason:'The existing warning is supported by the evidence.'};
   const competition=await Promise.all([api(admin,'resolve_moderation_appeal',contested),api(colleague,'resolve_moderation_appeal',{...contested,p_operation_id:randomUUID(),p_outcome:'overturned'})]);
   assert.deepEqual(competition.map(x=>x.status).sort(),[200,409]);
   assert.equal(sql(`select count(*) from safety_private.appeal_decisions where appeal_id='${a2}'`),'1');
   pass('competing admins get one committed result and one explicit conflict');
   const a3=await rpc(target,'submit_moderation_appeal',submit(2));
   const reverse={p_appeal_id:a3,p_operation_id:randomUUID(),p_expected_version:0,p_outcome:'overturned',p_reason:'The additional evidence clears this warning.'};
   await Promise.all([rpc(admin,'resolve_moderation_appeal',reverse),issue(3)]);
   const count=Number(sql(`select count(*) from safety_private.enforcement_actions where subject_id='${target.id}' and kind='warn' and revoked_at is null`));
   standing=await rpc(target,'get_my_account_standing');assert.equal(standing.warning_count,count);
   pass('new enforcement and appeal reversal serialize without losing a warning-count update');
   grant(admin,'admin',false);await denied(admin,'list_moderation_appeals');await denied(admin,'resolve_moderation_appeal',reverse);
   grant(reporter,'admin');assert.deepEqual(await rpc(reporter,'list_moderation_appeals',{p_status:'upheld'}),[]);
   await denied(reporter,'get_moderation_appeal',{p_appeal_id:a2});
   pass('live role revocation blocks old JWTs and report authors remain excluded even after becoming admin');
   await target.client.auth.signOut();
   await denied(target,'get_my_moderation_actions');await denied(target,'submit_moderation_appeal',submit(1));
   pass('signed-out session token cannot read or submit appeals');
  } finally {
    if (fixtures.length) {
      const emails = fixtures.map(({ email }) => { assert.match(email, /^journey-[0-9a-f-]{36}@test\.local$/); return `'${email}'`; }).join(',');
      sql(`begin;
        create temporary table moderation_fixture_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table moderation_fixture_reports on commit drop as select id from safety_private.reports
          where reporter_id in (select id from moderation_fixture_users) or reported_profile_id in (select id from moderation_fixture_users);
        create temporary table appeal_fixtures on commit drop as select ap.id from safety_private.appeals ap join safety_private.enforcement_actions a on a.id=ap.action_id where a.report_id in (select id from moderation_fixture_reports);
        delete from safety_private.appeal_views where appeal_id in (select id from appeal_fixtures);
        delete from safety_private.appeal_decisions where appeal_id in (select id from appeal_fixtures);
        delete from safety_private.appeals where id in (select id from appeal_fixtures);
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
  console.log(`Moderation appeals API checks passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
