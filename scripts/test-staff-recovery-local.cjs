/* global __dirname */
// Owner recovery against disposable local accounts. Never accepts a hosted URL.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql: sql } = require('./local-student-fixtures.cjs');
process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [];
const run = promisify(execFile);
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function fingerprint() {
  const tables=sql("select schemaname||'.'||tablename from pg_tables where schemaname='public' or right(schemaname,8)='_private' or (schemaname='auth' and tablename in ('users','identities')) order by schemaname,tablename").split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(t=>/^[a-z_]+\.[a-z_]+$/.test(t)));
  return sql(tables.map(t=>`select '${t}:'||count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${t} t`).join(' union all ')).split(/\r?\n/).sort().join('\n');
}
function client() { return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}); }
async function student() {
  const credentials=createStudentFixture();fixtures.push(credentials);
  const auth=client();const signup=await auth.auth.signUp(credentials);assert.ifError(signup.error);
  const id=signup.data.user?.id;assert.match(id,/^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Staff recovery fixture',onboarding_completed_at=now(),is_discoverable=true where id='${id}';`);
  const login=await auth.auth.signInWithPassword(credentials);assert.ifError(login.error);
  return {id,credentials,token:login.data.session.access_token,refresh:login.data.session.refresh_token};
}
async function api(user,name,args={}) {
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  const body=await r.text();return {status:r.status,data:body?JSON.parse(body):null};
}
async function rpc(user,name,args={}) {const r=await api(user,name,args);assert.ok([200,204].includes(r.status),JSON.stringify(r));return r.data;}
async function owner(query) {
  try {
    const r=await run('psql',['-X','-qAt','-w','-h','127.0.0.1','-p',process.env.CAMPUSCLUTCH_TEST_DB_PORT||'54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',`begin; set local statement_timeout='15s'; ${query}; commit;`],{encoding:'utf8',timeout:20000,windowsHide:true,env:{...process.env,PGHOSTADDR:'127.0.0.1',PGPASSWORD:'postgres'}});
    return {ok:true,data:JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1))};
  } catch(e) {return {ok:false,error:e.stderr||e.message};}
}
const grant=(user,role,enabled=true)=>sql(`select safety_private.assign_staff_role('${user.id}','${role}',${enabled},'Disposable recovery assignment for API tests')`);
const stamp=user=>sql(`select updated_at from safety_private.staff_roles where profile_id='${user.id}'`);
const restore=(user,version,operation)=>`select safety_private.owner_restore_staff_access('${user.id}','${operation}','${version}','Owner verified this disposable test account.')`;

async function main() {
  const before=fingerprint();
  try {
    const staff=await student(),admin=await student(),reporter=await student(),ordinary=await student();
    grant(staff,'moderator',false);grant(admin,'admin');
    const version=stamp(staff),operation=randomUUID(),query=restore(staff,version,operation);
    for(const user of [ordinary,admin]) {
      assert.equal((await api(user,'owner_restore_staff_access',{p_profile_id:staff.id,p_operation_id:randomUUID(),p_expected_role_updated_at:version,p_reason:'Cannot promote myself through REST.'})).status,404);
    }
    pass('ordinary and admin Auth tokens cannot discover a public recovery endpoint');
    const results=await Promise.all(Array.from({length:4},()=>owner(query)));
    results.forEach(r=>{assert.equal(r.ok,true,r.error);assert.deepEqual(r.data,results[0].data);});
    assert.equal(sql(`select count(*) from safety_private.staff_recovery_events where operation_id='${operation}'`),'1');
    assert.equal(results[0].data.role,'moderator');
    assert.equal((await rpc(staff,'get_my_moderation_access')).role,null);
    assert.equal((await api(staff,'list_moderation_reports')).status,403);
    const refresh=await client().auth.refreshSession({refresh_token:staff.refresh});assert.ok(refresh.error,'Revoked session cannot refresh');
    const login=await client().auth.signInWithPassword(staff.credentials);assert.ifError(login.error);staff.token=login.data.session.access_token;
    assert.equal((await rpc(staff,'get_my_moderation_access')).role,'moderator');
    pass('simultaneous exact recovery retries commit once; old JWT/refresh fail and fresh sign-in restores the original role');
    grant(staff,'moderator',false);
    const retried=await owner(query);assert.equal(retried.ok,true);assert.deepEqual(retried.data,results[0].data);
    assert.equal((await rpc(staff,'get_my_moderation_access')).role,null);
    pass('retrying an old successful operation cannot undo a later role revocation');
    const newer=stamp(staff);
    const competing=await Promise.all([owner(restore(staff,newer,randomUUID())),owner(restore(staff,newer,randomUUID()))]);
    assert.equal(competing.filter(r=>r.ok).length,1);assert.match(competing.find(r=>!r.ok).error,/staff role changed/);
    pass('competing recovery operations produce one success and one stale-version conflict');

    // Model a historical suspension while a staff role was disabled.
    grant(staff,'moderator',false);
    const report=randomUUID();
    sql(`insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status) values('${report}','${reporter.id}','${staff.id}',gen_random_uuid(),'student','spam','',extensions.digest('${report}','sha256'),'{}','escalated')`);
    const action=await rpc(admin,'enforce_moderation_report',{p_report_id:report,p_operation_id:randomUUID(),p_expected_version:0,p_kind:'suspend_7_days',p_reason:'Disposable suspension for owner recovery testing.',p_review_updated_at:null});
    const suspendedLogin=await client().auth.signInWithPassword(staff.credentials);assert.ifError(suspendedLogin.error);staff.token=suspendedLogin.data.session.access_token;
    const appeal=await rpc(staff,'submit_moderation_appeal',{p_action_id:action.action_id,p_operation_id:randomUUID(),p_explanation:'Please reconsider this disposable suspension.'});
    grant(staff,'moderator');const finalVersion=stamp(staff);
    const refused=await owner(restore(staff,finalVersion,randomUUID()));assert.equal(refused.ok,false);assert.match(refused.error,/Resolve the staff suspension/);
    const args={p_appeal_id:appeal,p_operation_id:randomUUID(),p_expected_version:0,p_outcome:'overturned',p_reason:'Staff sanctions require owner review.'};
    assert.equal((await api(admin,'resolve_moderation_appeal',args)).status,403);
    pass('suspended staff can appeal, but restoring access cannot clear a suspension and an app admin cannot decide it');
    const decide=op=>`select safety_private.owner_review_staff_appeal('${appeal}','${op}',0,'${finalVersion}','overturned','Owner verified that this suspension was incorrect.')`;
    const decided=await Promise.all([owner(decide(randomUUID())),owner(decide(randomUUID()))]);
    assert.equal(decided.filter(r=>r.ok).length,1);assert.match(decided.find(r=>!r.ok).error,/appeal changed/);
    const standing=await rpc(staff,'get_my_account_standing');assert.equal(standing.suspended,false);
    const notices=await rpc(staff,'get_my_notifications_v3');assert.equal(notices.filter(n=>n.event_type==='appeal_decided').length,1);
    const history=await rpc(staff,'get_my_moderation_actions');assert.equal(history[0].appeal.status,'overturned');
    assert.equal(history[0].appeal.decision_reason,'Owner verified that this suspension was incorrect.');
    assert.ok(!JSON.stringify(history).includes('database_actor'));
    pass('competing owner decisions finalize once; existing app APIs expose the result, corrected standing and one private bell notice');
  } finally {
    if(fixtures.length) {
      const emails=fixtures.map(({email})=>{assert.match(email,/^journey-[0-9a-f-]{36}@test\.local$/);return `'${email}'`;}).join(',');
      sql(`begin;
        create temporary table recovery_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table recovery_reports on commit drop as select id from safety_private.reports where reporter_id in(select id from recovery_users) or reported_profile_id in(select id from recovery_users);
        create temporary table recovery_appeals on commit drop as select ap.id from safety_private.appeals ap join safety_private.enforcement_actions a on a.id=ap.action_id where a.report_id in(select id from recovery_reports);
        delete from safety_private.staff_recovery_events where subject_id in(select id from recovery_users);
        delete from safety_private.appeal_views where appeal_id in(select id from recovery_appeals);
        delete from safety_private.appeal_decisions where appeal_id in(select id from recovery_appeals);
        delete from safety_private.appeals where id in(select id from recovery_appeals);
        delete from safety_private.enforcement_actions where report_id in(select id from recovery_reports);
        delete from safety_private.report_views where report_id in(select id from recovery_reports);
        delete from safety_private.report_decisions where report_id in(select id from recovery_reports);
        delete from safety_private.staff_role_events where profile_id in(select id from recovery_users);
        commit;`);
      cleanupStudentFixtures(fixtures);
    }
    assert.equal(fingerprint(),before,'Preserve original Auth/public/private data');
    pass('all disposable accounts, recovery events and moderation fixtures removed; original data fingerprints match');
  }
  console.log(`Staff recovery API groups passed: ${checks}`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1;});
