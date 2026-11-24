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
async function main() {
  const before=fingerprint();
  try {
    const target=await student(), admin=await student(), mod=await student();
    grant(admin,'admin');grant(mod,'moderator');
    const args={p_target_type:'student',p_target_id:target.id};
    await denied(target,'get_direct_moderation_context',args);await denied(mod,'get_direct_moderation_context',args);
    const context=await rpc(admin,'get_direct_moderation_context',args);
    const action={...args,p_operation_id:randomUUID(),p_kind:'warn',p_reason:'Please follow the community rules.',p_updated_at:context.updated_at};
    await denied(target,'take_direct_moderation_action',action);await denied(mod,'take_direct_moderation_action',action);
    pass('real student and moderator JWTs cannot inspect or execute direct actions');
    const receipts=await Promise.all([rpc(admin,'take_direct_moderation_action',action),rpc(admin,'take_direct_moderation_action',action)]);
    assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].warning_count,1);
    const notices=await rpc(target,'get_my_notifications_v3');assert.equal(notices.length,1);assert.ok(notices[0].body.includes(action.p_reason));
    assert.equal((await api(admin,'take_direct_moderation_action',{...action,p_reason:'A different explanation for this operation.'})).status,400);
    pass('simultaneous identical submissions produce one warning and one explained notification');
    const reviewId=randomUUID();
    sql(`insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,comment)
      select '${reviewId}',code,term_id,'${target.id}',4,5,true,'Disposable direct moderation review.' from public.courses limit 1;`);
    const reviewContext=await rpc(admin,'get_direct_moderation_context',{p_target_type:'course_review',p_target_id:reviewId});
    assert.equal(reviewContext.evidence.difficulty,4);assert.equal(reviewContext.evidence.workload,5);assert.equal(JSON.stringify(reviewContext).includes(target.id),false);
    const remove={p_target_type:'course_review',p_target_id:reviewId,p_operation_id:randomUUID(),p_kind:'remove_review',p_reason:'Please revise the misleading claims in this review.',p_updated_at:reviewContext.updated_at};
    const removed=await rpc(admin,'take_direct_moderation_action',remove);assert.deepEqual(await rpc(admin,'take_direct_moderation_action',remove),removed);
    assert.equal(sql(`select removed_at is not null from course_reviews_private.reviews where id='${reviewId}'`),'t');
    assert.ok((await rpc(target,'get_my_notifications_v3')).some(item=>item.title==='Course review removed'&&item.body.includes(remove.p_reason)));
    pass('review author stays anonymous; removal retry reconciles and author receives explanation');
    const requestId=await rpc(target,'save_my_request',{p_request_id:null,p_payload:{category:'delivery',title:'Direct API fixture',description:'A disposable testing request.',
      campus_id:sql('select id from public.campuses limit 1'),room_location:'Library',deadline_at:new Date(Date.now()+86400000).toISOString(),points:10,item_size:'medium',
      details:{pickup_location:'Cafe',dropoff_location:'Library'}}});
    const requestContext=await rpc(admin,'get_direct_moderation_context',{p_target_type:'request',p_target_id:requestId});
    const requestAction={p_target_type:'request',p_target_id:requestId,p_operation_id:randomUUID(),p_kind:'remove_request',p_reason:'This request does not meet the community rules.',p_updated_at:requestContext.updated_at};
    const r=await rpc(admin,'take_direct_moderation_action',requestAction);assert.equal(r.kind,'remove_request');
    assert.deepEqual(await rpc(admin,'take_direct_moderation_action',requestAction),r);
    assert.ok((await rpc(target,'get_my_notifications_v3')).some(item=>item.title==='Request removed'&&item.body.includes(requestAction.p_reason)));
    pass('request removal REST action and receipt retry both succeed with explained notification');
    grant(admin,'admin',false);await denied(admin,'take_direct_moderation_action',action);
    pass('revoked admin cannot even replay a privileged receipt');
  } finally {
    if (fixtures.length) {
      const emails = fixtures.map(({ email }) => { assert.match(email, /^journey-[0-9a-f-]{36}@test\.local$/); return `'${email}'`; }).join(',');
      sql(`begin;
        create temporary table moderation_fixture_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table moderation_fixture_reports on commit drop as select id from safety_private.reports
          where reporter_id in (select id from moderation_fixture_users) or reported_profile_id in (select id from moderation_fixture_users);
        delete from safety_private.direct_action_receipts where actor_id in (select id from moderation_fixture_users);
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
  console.log(`Direct moderation API checks passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
