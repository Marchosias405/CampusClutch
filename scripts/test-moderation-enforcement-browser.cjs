/* global __dirname */
// Local-only moderator UI journey. No existing account receives a staff role.
const assert = require('node:assert/strict');
const { openRoute, reloadSignedIn } = require('./browser-auth-navigation.cjs');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const serveStatic = require('serve-static');
const { createClient } = require('@supabase/supabase-js');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig, localSql: sql } = require('./local-student-fixtures.cjs');
process.chdir(path.resolve(__dirname, '..'));
const { url, key } = localClientConfig();
const fixtures = [];
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function fingerprint() {
  const tables = sql(`select schemaname||'.'||tablename from pg_tables where schemaname='public' or schemaname like '%\\_private' escape '\\'
    or (schemaname='auth' and tablename in ('users','identities')) order by schemaname,tablename`).split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+\.[a-z_]+$/.test(table)));
  return sql(tables.map(table => `select '${table}:'||count(*)::text||':'||md5(coalesce(string_agg(row_to_json(t)::text,chr(10) order by row_to_json(t)::text),'')) from ${table} t`).join(' union all '))
    .split(/\r?\n/).sort().join('\n');
}
async function student(name) {
  const credentials = createStudentFixture(); fixtures.push(credentials);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await client.auth.signUp(credentials); assert.ifError(signup.error);
  const id = signup.data.user?.id; assert.match(id, /^[0-9a-f-]{36}$/); assert.match(name, /^[A-Za-z ]+$/);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='${name}',is_discoverable=true,onboarding_completed_at=now() where id='${id}';`);
  const login = await client.auth.signInWithPassword(credentials); assert.ifError(login.error);
  return { id, client, credentials, name };
}
async function rpc(user, name, args) { const { data, error } = await user.client.rpc(name, args); assert.ifError(error); return data; }
function grant(user, enabled = true) { sql(`select safety_private.assign_staff_role('${user.id}','admin',${enabled},'Disposable local browser test assignment')`); }
async function login(page, user) {
  await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(user.credentials.email);
  await page.getByPlaceholder('Enter your password').fill(user.credentials.password);
  await page.getByText('Sign In', { exact: true }).click();
  await page.getByText('Hi, ' + user.name, { exact: true }).waitFor();
}
async function fits(page, control) {
  await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= -1 && box.x + box.width <= 321, '48px target fits narrow screen: ' + JSON.stringify(box));
}
async function main() {
  const folder = path.resolve(process.argv[2] || '.expo/task14-web');
  assert.ok(fs.existsSync(path.join(folder,'index.html')));
  const before=fingerprint(); let browser,page,server;
  try {
    const reporter=await student('Reporter Fixture'),target=await student('Target Fixture'),admin=await student('Admin Fixture');
    grant(admin);
    const course=JSON.parse(sql(`select row_to_json(c) from (select code,id,term_id from public.courses where term_id in
      (select id from public.academic_terms where status='current') limit 1) c`));
    const reviewId=randomUUID();
    sql(`insert into course_reviews_private.reviews(id,course_code,term_id,author_id,difficulty,workload,recommend,grade,comment)
      values('${reviewId}','${course.code}','${course.term_id}','${target.id}',4,5,true,'B','Disposable course review for enforcement testing.')`);
    sql(`insert into public.course_memberships(profile_id,course_id,status) values('${target.id}','${course.id}','enrolled')`);
    const report=await rpc(reporter,'submit_safety_report',{p_operation_id:randomUUID(),p_target_type:'course_review',p_target_id:reviewId,p_reason:'spam',p_details:'Disposable review report.'});
    const otherReports=[randomUUID(),randomUUID()];
    sql(`update safety_private.reports set triage_status='escalated' where id='${report.report_id}';
      insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
      select id,'${reporter.id}','${target.id}',gen_random_uuid(),'student','spam','',extensions.digest(id::text,'sha256'),'{}','escalated'
      from unnest(array['${otherReports[0]}'::uuid,'${otherReports[1]}'::uuid]) id`);
    const files=serveStatic(folder,{extensions:['html']});
    server=http.createServer((req,res)=>files(req,res,()=>{
      const match=/^\/moderation\/[0-9a-f-]{36}\/?$/.exec(new URL(req.url,'http://localhost').pathname);
      if(!match){res.writeHead(404).end();return;}
      req.url='/moderation/%5Bid%5D.html';files(req,res,()=>res.writeHead(404).end());
    }));
    server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});
    async function context(){
      const c=await browser.newContext({viewport:{width:320,height:760}});
      await c.route('**/*',route=>{
        const value=route.request().url();return value.startsWith(origin+'/')||value.startsWith(url+'/')||value.startsWith('data:')?route.continue():route.abort();
      });return c;
    }
    const adminContext=await context(),targetContext=await context();
    page=await adminContext.newPage();page.setDefaultTimeout(25000);
    const studentPage=await targetContext.newPage();studentPage.setDefaultTimeout(25000);
    await page.goto(origin);await login(page,admin);await studentPage.goto(origin);await login(studentPage,target);
    await openRoute(page, origin+'/moderation/'+report.report_id);
    await page.getByText('Difficulty: 4/5',{exact:true}).waitFor();
    await page.getByText('Workload: 5/5',{exact:true}).waitFor();
    assert.equal(await page.getByText('4/5',{exact:true}).count(),1);
    assert.equal(await page.getByText('5/5',{exact:true}).count(),1);
    for(const label of ['Issue a warning','Suspend for 7 days','Hide course review'])await fits(page,page.getByRole('button',{name:label,exact:true}));
    pass('reported scores and current review appear; all admin actions fit a narrow screen');
    const reason='Please keep course reviews relevant and respectful.';
    async function prepare(kind,why){
      await page.getByRole('button',{name:kind,exact:true}).click();
      await page.getByRole('textbox',{name:'Reason for admin action',exact:true}).fill(why);
      await page.getByRole('button',{name:'Review admin action',exact:true}).click();
      await page.getByRole('button',{name:'Confirm admin action',exact:true}).waitFor();
    }
    await prepare('Issue a warning',reason);
    await page.getByRole('button',{name:'Keep editing action',exact:true}).click();
    assert.equal(sql(`select count(*) from safety_private.enforcement_actions where subject_id='${target.id}'`),'0');
    await page.getByRole('button',{name:'Review admin action',exact:true}).click();
    const endpoint='**/rest/v1/rpc/enforce_moderation_report';
    const lose=async route=>{await route.fetch();await route.abort('connectionfailed');};
    await page.route(endpoint,lose);await page.getByRole('button',{name:'Confirm admin action',exact:true}).click();
    await page.getByRole('button',{name:'Retry saved action',exact:true}).waitFor();
    await page.unroute(endpoint,lose);await reloadSignedIn(page, admin.credentials);
    await page.getByRole('button',{name:'Retry saved action',exact:true}).click();
    await page.getByText('Action recorded.',{exact:true}).waitFor();
    assert.equal(sql(`select warning_count from safety_private.account_standing where profile_id='${target.id}'`),'1');
    pass('confirmation can be cancelled and a lost response retries exactly once after reload');
    await studentPage.getByRole('button',{name:'Notifications, 1 unread',exact:true}).waitFor();
    pass('the recipient bell updates live for a formal warning without reloading');
    await reloadSignedIn(studentPage, target.credentials);
    await studentPage.getByText('Hi, Target Fixture',{exact:true}).waitFor();
    assert.equal(await studentPage.getByRole('tab',{name:'Messages',exact:true}).count(),1);
    assert.equal(await studentPage.getByRole('button',{name:'Acknowledge and continue',exact:true}).count(),0);
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),1);
    await openRoute(studentPage, origin+'/notifications');
    await studentPage.getByText('Formal warning',{exact:true}).waitFor();
    await studentPage.getByText('View decision & warning count',{exact:true}).waitFor();
    assert.ok((await studentPage.locator('body').innerText()).includes(reason));
    await studentPage.getByText('Formal warning',{exact:true}).click();
    await studentPage.getByText('Current formal warnings: 1',{exact:true}).waitFor();
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),0);
    assert.equal(new URL(studentPage.url()).pathname,'/profile/appeals');
    await openRoute(studentPage, origin+'/notifications');await reloadSignedIn(studentPage, target.credentials);await studentPage.getByText('Formal warning',{exact:true}).waitFor();
    await studentPage.getByText('View decision & warning count',{exact:true}).waitFor();
    assert.equal(await rpc(target,'get_my_notification_unread_count_v2'),0);
    assert.equal(await studentPage.getByText('This notification is no longer available.',{exact:true}).count(),0);
    pass('one warning appears in the bell inbox, remains after reading and reload, and never blocks normal access');
    await rpc(admin,'enforce_moderation_report',{p_report_id:otherReports[0],p_operation_id:randomUUID(),p_expected_version:0,p_kind:'warn',p_reason:reason,p_review_updated_at:null});
    await openRoute(page, origin+'/moderation/'+otherReports[1]);await prepare('Issue a warning',reason);
    await page.getByText('Issue one formal warning. This is the third warning and will also suspend app access for 7 days.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Confirm admin action',exact:true}).click();
    await page.getByText('Action recorded. The third warning also suspended this account for 7 days.',{exact:true}).waitFor();
    await reloadSignedIn(studentPage, target.credentials);await studentPage.getByText('Account temporarily suspended',{exact:true}).waitFor();
    assert.equal(await studentPage.getByRole('button',{name:'Acknowledge and continue',exact:true}).count(),0);
    await fits(studentPage,studentPage.getByRole('button',{name:'Sign out',exact:true}));
    await studentPage.screenshot({path:'.expo/enforcement-suspension-check.png'});
    sql(`update safety_private.account_standing set suspended_until=now()-interval '1 second' where profile_id='${target.id}'`);
    await studentPage.getByRole('button',{name:'Check again',exact:true}).click();
    await openRoute(studentPage, origin);
    await studentPage.getByText('Hi, Target Fixture',{exact:true}).waitFor();
    assert.equal(await studentPage.getByRole('button',{name:'Acknowledge and continue',exact:true}).count(),0);
    pass('third-warning confirmation, suspension screen and expiry recovery work for an existing session');
    await openRoute(page, origin+'/moderation/'+report.report_id);await prepare('Hide course review','This review has been removed for violating the review guidelines.');
    await page.getByRole('button',{name:'Confirm admin action',exact:true}).click();await page.getByText('Action recorded.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Reload report',exact:true}).click();
    await page.getByText('Review hidden from the course page and statistics.',{exact:false}).waitFor();
    assert.equal((await rpc(reporter,'get_course_review_summary',{p_course_code:course.code})).review_count,0);
    assert.equal(sql(`select evidence->>'difficulty' from safety_private.reports where id='${report.report_id}'`),'4');
    await page.screenshot({path:'.expo/enforcement-admin-check.png'});
    pass('review removal updates aggregates while keeping scores and evidence in the admin report');
    await reloadSignedIn(studentPage, target.credentials);
    await studentPage.getByRole('button',{name:'Acknowledge and continue',exact:true}).click();
    await studentPage.getByText('Hi, Target Fixture',{exact:true}).waitFor();
    const reviewUrl=origin+'/courses/reviews?code='+encodeURIComponent(course.code);
    await openRoute(studentPage, reviewUrl);
    await studentPage.getByText('Hidden by moderation. Edit to publish a revision, or delete and start again.',{exact:true}).waitFor();
    await studentPage.getByRole('button',{name:/^Edit your .* review$/}).click();
    assert.equal(await studentPage.getByRole('textbox',{name:'Your course review',exact:true}).inputValue(),'Disposable course review for enforcement testing.');
    const revised='Revised constructive feedback after reading the moderation notice.';
    await studentPage.getByRole('textbox',{name:'Your course review',exact:true}).fill(revised);
    const saveEndpoint='**/rest/v1/rpc/save_my_course_review';
    await studentPage.route(saveEndpoint,lose);
    await studentPage.getByRole('button',{name:'Save review',exact:true}).click();
    await studentPage.getByText("We couldn't confirm this action. Check your connection and retry; your review will not be added twice.",{exact:true}).waitFor();
    assert.equal(await studentPage.getByRole('textbox',{name:'Your course review',exact:true}).inputValue(),revised);
    await studentPage.unroute(saveEndpoint,lose);
    await studentPage.getByRole('button',{name:'Save review',exact:true}).click();
    await studentPage.getByText('Your review was saved. Thank you for sharing your experience.',{exact:true}).waitFor();
    const current=await rpc(target,'get_course_review_summary',{p_course_code:course.code});
    assert.equal(current.review_count,1); assert.equal(current.my_reviews.length,1);
    assert.notEqual(current.my_reviews[0].id,reviewId); assert.equal(current.my_reviews[0].is_hidden,false);
    assert.equal(sql(`select comment from course_reviews_private.reviews where id='${reviewId}'`),'Disposable course review for enforcement testing.');
    await reloadSignedIn(studentPage, target.credentials); await studentPage.getByText(revised,{exact:true}).waitFor();
    await studentPage.screenshot({path:'.expo/review-republished-check.png'});
    pass('hidden review editor publishes one replacement after response loss and retry, retaining private original evidence');
    const replacementReport=await rpc(reporter,'submit_safety_report',{p_operation_id:randomUUID(),p_target_type:'course_review',p_target_id:current.my_reviews[0].id,p_reason:'spam',p_details:'Disposable replacement report.'});
    sql(`update safety_private.reports set triage_status='escalated' where id='${replacementReport.report_id}'`);
    await openRoute(page, origin+'/moderation/'+replacementReport.report_id);
    await prepare('Hide course review','Replacement review requires further corrections.');
    await page.getByRole('button',{name:'Confirm admin action',exact:true}).click();
    await page.getByText('Action recorded.',{exact:true}).waitFor();
    await reloadSignedIn(studentPage, target.credentials); await studentPage.getByRole('button',{name:'Acknowledge and continue',exact:true}).click();
    await studentPage.getByRole('tab', {name:'Home',exact:true}).waitFor();
    await openRoute(studentPage, reviewUrl);
    await studentPage.getByRole('button',{name:/^Delete your .* review$/}).click();
    await studentPage.getByText('Delete this hidden review and start again? Moderators keep the original record.',{exact:true}).waitFor();
    await studentPage.getByRole('button',{name:'Delete review',exact:true}).click();
    await studentPage.getByRole('button',{name:'Write a review',exact:true}).click();
    await studentPage.getByRole('button',{name:'Difficulty 2 out of 5',exact:true}).click();
    await studentPage.getByRole('button',{name:'Workload 3 out of 5',exact:true}).click();
    await studentPage.getByRole('button',{name:'Yes',exact:true}).click();
    await studentPage.getByRole('textbox',{name:'Your course review',exact:true}).fill('New review after discarding a hidden version.');
    await studentPage.getByRole('button',{name:'Save review',exact:true}).click();
    await studentPage.getByText('Your review was saved. Thank you for sharing your experience.',{exact:true}).waitFor();
    const fresh=await rpc(target,'get_course_review_summary',{p_course_code:course.code});
    assert.equal(fresh.review_count,1); assert.equal(fresh.my_reviews.length,1);
    assert.notEqual(fresh.my_reviews[0].id,current.my_reviews[0].id);
    assert.equal(sql(`select count(*) from course_reviews_private.reviews where author_id='${target.id}' and archived_at is not null`),'2');
    pass('admin can hide replacement separately; author can discard it and write a fresh review for the same term');
    await page.getByRole('button',{name:'Reload report',exact:true}).click();
    await prepare('Suspend for 7 days','Temporary suspension for repeated community guideline violations.');
    await page.getByRole('button',{name:'Confirm admin action',exact:true}).click();await page.getByText('Action recorded.',{exact:true}).waitFor();
    const final=await rpc(target,'get_my_account_standing');assert.equal(final.suspended,true);assert.equal(final.warning_count,3);
    await reloadSignedIn(studentPage, target.credentials);await studentPage.getByRole('button',{name:'Sign out',exact:true}).click();
    await studentPage.getByText('Sign In',{exact:true}).waitFor();
    pass('manual suspension keeps warning totals and the suspended user can sign out');
  } catch (error) {
    console.error('Browser check failed:', error);
    if (page) await page.screenshot({ path: '.expo/enforcement-failure.png' }).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
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
        delete from safety_private.staff_roles where profile_id in (select id from moderation_fixture_users); commit;`);
      cleanupStudentFixtures(fixtures);
    }
    assert.equal(fingerprint(), before, 'Original Auth/public/private data must remain unchanged');
    pass('temporary roles, audit entries and accounts removed; original data fingerprints match');
  }
  console.log(`Enforcement browser checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
