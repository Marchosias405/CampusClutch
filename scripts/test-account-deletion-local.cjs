/* global __dirname */
// Read-only deletion readiness with real disposable Auth sessions, local only.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql: sql } = require('./local-student-fixtures.cjs');
process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [], ids = [], jobs = [];
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function fingerprint() {
  const tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname='public' or right(schemaname,8)='_private' or (schemaname='auth' and tablename in ('users','identities','sessions')) order by schemaname,tablename").split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(t => /^[a-z_]+\.[a-z_]+$/.test(t)));
  return sql(tables.map(t => `select '${t}:'||count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${t} t`).join(' union all ')).split(/\r?\n/).sort().join('\n');
}
function client() { return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function student() {
  const credentials = createStudentFixture(); fixtures.push(credentials);
  const auth = client(); const signup = await auth.auth.signUp(credentials); assert.ifError(signup.error);
  const id = signup.data.user?.id; assert.match(id, /^[0-9a-f-]{36}$/); ids.push(id);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Deletion readiness fixture',onboarding_completed_at=now(),is_discoverable=true where id='${id}'`);
  const login = await auth.auth.signInWithPassword(credentials); assert.ifError(login.error);
  return { id, credentials, token: login.data.session.access_token, refresh: login.data.session.refresh_token };
}
async function api(user, args = {}, name = 'get_my_account_deletion_preflight') {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
    apikey: key, ...(user ? { Authorization: `Bearer ${user.token}` } : {}), 'Content-Type': 'application/json',
  }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  return { status: r.status, data: await r.json() };
}
async function readiness(user) { const r = await api(user); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; }

async function main() {
  const before = fingerprint();
  try {
    const poster = await student(), helper = await student(), staff = await student();
    assert.ok([401,403].includes((await api(null)).status));
    assert.equal((await api(helper, { p_profile_id: poster.id })).status, 404);
    assert.equal((await api(helper, {}, 'deletion_preflight')).status, 404);
    const clean = await readiness(poster); assert.equal(clean.eligible, true); assert.equal(clean.points_balance, '100');
    assert.deepEqual(Object.keys(clean).sort(), ['accepted_jobs','blockers','checked_at','course_memberships','course_reviews','eligible','open_requests','pending_offers','point_reservations','points_balance','points_reserved','policy_version']);
    pass('real JWT permits only the caller readiness; anonymous, target substitution and private endpoint requests fail');

    sql(`select safety_private.assign_staff_role('${staff.id}','admin',true,'Disposable deletion readiness role')`);
    assert.deepEqual((await readiness(staff)).blockers, ['staff_access']);
    sql(`select safety_private.assign_staff_role('${staff.id}','admin',false,'Disposable role handover completed')`);
    assert.equal((await readiness(staff)).eligible, true);
    sql(`insert into safety_private.account_standing(profile_id,warning_count,suspended_until) values('${staff.id}',3,now()+interval '7 days')`);
    assert.equal((await readiness(staff)).eligible, true);
    pass('enabled staff must arrange handover; an app suspension still permits their own deletion guidance');

    const job = randomUUID(); jobs.push(job);
    sql(`begin;
      insert into public.requests(id,owner_id,category,title,description,campus_id,room_location,deadline_at,points,item_size,status)
        values('${job}','${poster.id}','delivery','Deletion readiness test','Disposable job for readiness',(select id from public.campuses limit 1),'Test room',now()+interval '1 day',20,'medium','accepted');
      insert into public.delivery_request_details(request_id,pickup_location,dropoff_location) values('${job}','Library','Student centre');
      insert into public.request_offers(request_id,offering_user_id,status,decided_at) values('${job}','${helper.id}','accepted',now());
      insert into public.request_point_reservations(request_id,offer_round,poster_id,helper_id,amount) values('${job}',1,'${poster.id}','${helper.id}',20);
      update public.points_wallets set reserved=20 where profile_id='${poster.id}'; commit;`);
    for (const person of [poster, helper]) {
      const r = await readiness(person); assert.equal(r.accepted_jobs, 1); assert.equal(r.eligible, false);
      assert.deepEqual(r.blockers, ['accepted_jobs','reserved_points']);
    }
    assert.equal((await readiness(helper)).points_reserved, '0');
    assert.equal((await readiness(staff)).accepted_jobs, 0);
    sql(`update public.requests set deadline_at=now()-interval '1 day' where id='${job}'`);
    assert.equal((await readiness(helper)).eligible, false);
    sql(`begin; update public.requests set status='cancelled',cancelled_at=now() where id='${job}';
      update public.request_point_reservations set status='released',released_at=now() where request_id='${job}';
      update public.points_wallets set reserved=0 where profile_id='${poster.id}'; commit;`);
    assert.equal((await readiness(poster)).eligible, true); assert.equal((await readiness(helper)).eligible, true);
    pass('accepted work blocks both parties even after its deadline, and resolving work and reservations restores readiness');

    const stable = fingerprint();
    const polled = await Promise.all(Array.from({ length: 8 }, () => readiness(poster)));
    assert.ok(polled.every(r => r.eligible)); assert.equal(fingerprint(), stable);
    pass('concurrent readiness requests change no jobs, points, reviews, staff records, sessions or other application data');

    sql(`update auth.sessions set created_at=now()-interval '11 minutes' where user_id='${poster.id}'`);
    assert.deepEqual((await readiness(poster)).blockers, ['recent_sign_in']);
    const refreshed = await client().auth.refreshSession({ refresh_token: poster.refresh }); assert.ifError(refreshed.error);
    assert.deepEqual((await readiness({ ...poster, token: refreshed.data.session.access_token })).blockers, ['recent_sign_in']);
    const signedIn = await client().auth.signInWithPassword(poster.credentials); assert.ifError(signedIn.error);
    poster.token = signedIn.data.session.access_token;
    assert.equal((await readiness(poster)).eligible, true);
    pass('refreshing an old session cannot satisfy recent sign-in; entering credentials again can');

    sql(`delete from auth.sessions where user_id='${helper.id}'`);
    assert.equal((await api(helper)).status, 403);
    const revoked = await client().auth.refreshSession({ refresh_token: helper.refresh }); assert.ok(revoked.error);
    assert.equal((await readiness(poster)).eligible, true);
    pass('revoked session loses readiness immediately despite a still-unexpired JWT; other accounts remain isolated');
  } finally {
    if (jobs.length) sql(`delete from public.request_point_reservations where request_id in (${jobs.map(id => `'${id}'`).join(',')})`);
    if (ids.length) sql(`delete from safety_private.staff_role_events where profile_id in (${ids.map(id => `'${id}'`).join(',')})`);
    cleanupStudentFixtures(fixtures);
    assert.equal(fingerprint(), before, 'Preserve original Auth/public/private data');
    pass('disposable fixtures removed and every original data fingerprint preserved');
  }
  console.log(`Account deletion readiness API groups passed: ${checks}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
