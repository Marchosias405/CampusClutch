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
async function profile(page, origin) { await openRoute(page, origin); await page.getByRole('tab', { name: 'Profile', exact: true }).click(); await page.getByRole('button', { name: 'Log Out', exact: true }).waitFor(); }
async function fits(page, control) {
  await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= -1 && box.x + box.width <= 321, '48px target fits narrow screen: ' + JSON.stringify(box));
}
async function main() {
  const folder=path.resolve(process.argv[2] || '.expo/task14-web');
  assert.ok(fs.existsSync(path.join(folder,'index.html')));
  const before=fingerprint(); let browser,page,server;
  try {
    const reporter=await student('Reporter Fixture'),target=await student('Target Fixture'),admin=await student('Admin Fixture');
    grant(admin);
    const reports=Array.from({length:4},()=>randomUUID());
    for(const id of reports)sql(`insert into safety_private.reports(id,reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,triage_status)
      values('${id}','${reporter.id}','${target.id}',gen_random_uuid(),'student','spam','',extensions.digest('${id}','sha256'),'{}','escalated')`);
    const files=serveStatic(folder,{extensions:['html']});
    server=http.createServer((req,res)=>files(req,res,()=>res.writeHead(404).end()));
    server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({channel:'chrome',headless:true});
    async function context(){const c=await browser.newContext({viewport:{width:320,height:760}});
      await c.route('**/*',route=>{const v=route.request().url();return v.startsWith(origin+'/')||v.startsWith(url+'/')||v.startsWith('data:')?route.continue():route.abort();});return c;}
    const adminContext=await context(),targetContext=await context();
    page=await adminContext.newPage();page.setDefaultTimeout(25000);
    const studentPage=await targetContext.newPage();studentPage.setDefaultTimeout(25000);
    await page.goto(origin);await login(page,admin);await studentPage.goto(origin);await login(studentPage,target);
    const issue=(index)=>rpc(admin,'enforce_moderation_report',{p_report_id:reports[index],p_operation_id:randomUUID(),p_expected_version:0,p_kind:'warn',p_reason:`Test incident number ${index+1}: please follow the community rules.`,p_review_updated_at:null});
    const first=await issue(0);
    await profile(studentPage,origin);
    await studentPage.getByRole('button',{name:'Account decisions and appeals',exact:true}).click();
    await studentPage.getByText('Current formal warnings: 1',{exact:true}).waitFor();
    let card=studentPage.getByTestId('account-action-'+first.action_id);
    await card.getByText('Formal warning',{exact:true}).waitFor();
    const explanation='Please reconsider this first decision; the context was misunderstood.';
    await card.getByRole('button',{name:'Appeal this decision',exact:true}).click();
    await card.getByRole('textbox',{name:'Appeal explanation',exact:true}).fill(explanation);
    await card.getByRole('button',{name:'Review appeal',exact:true}).click();
    await card.getByRole('button',{name:'Keep editing',exact:true}).click();
    assert.equal(sql(`select count(*) from safety_private.appeals where appellant_id='${target.id}'`),'0');
    await card.getByRole('button',{name:'Review appeal',exact:true}).click();
    const submitEndpoint='**/rest/v1/rpc/submit_moderation_appeal';
    const lose=async route=>{await route.fetch();await route.abort('connectionfailed');};
    await studentPage.route(submitEndpoint,lose);
    await card.getByRole('button',{name:'Confirm appeal',exact:true}).click();
    await card.getByRole('button',{name:'Retry saved attempt',exact:true}).waitFor();
    await studentPage.unroute(submitEndpoint,lose);await reloadSignedIn(studentPage, target.credentials);
    await studentPage.getByText('Awaiting review',{exact:true}).waitFor();
    assert.equal(sql(`select count(*) from safety_private.appeals where appellant_id='${target.id}'`),'1');
    const appealId=sql(`select id from safety_private.appeals where action_id='${first.action_id}'`);
    pass('student profile entry, confirmation cancellation and lost-response restart preserve one appeal');
    await openRoute(page, origin+'/moderation/appeals');
    await page.getByRole('button',{name:'Review appeal '+appealId.slice(0,8),exact:true}).click();
    await page.getByText(explanation,{exact:true}).waitFor();
    await page.getByText(/Issued by you/).waitFor();
    await fits(page,page.getByRole('button',{name:'View original report and evidence',exact:true}));
    await page.getByRole('textbox',{name:'Appeal decision reason',exact:true}).fill('The original warning remains appropriate after considering your explanation.');
    await page.getByRole('button',{name:'Review decision',exact:true}).click();
    await page.getByRole('button',{name:'Confirm appeal decision',exact:true}).click();
    await page.getByText('Appeal decision recorded.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Refresh result',exact:true}).click();
    await page.getByText('Original decision upheld',{exact:true}).waitFor();
    // A visible appeal page updates without requiring a manual refresh.
    await studentPage.getByText('Original decision upheld',{exact:true}).waitFor({timeout:40000});
    await studentPage.getByText('Current formal warnings: 1',{exact:true}).waitFor();
    await openRoute(studentPage, origin+'/notifications');
    await studentPage.getByRole('button',{name:/Appeal decided: decision upheld/}).click();
    await studentPage.getByText('Current formal warnings: 1',{exact:true}).waitFor();
    await studentPage.getByText('Original decision upheld',{exact:true}).waitFor();
    assert.equal(sql(`select count(*) from public.notifications where recipient_id='${target.id}' and event_type='appeal_decided' and read_at is not null`),'1');
    pass('upheld appeal refreshes automatically, leaves count unchanged and opens from its own read-tracked bell notice');
    const second=await issue(1);await issue(2);
    await reloadSignedIn(studentPage, target.credentials);await studentPage.getByText('Account temporarily suspended',{exact:true}).waitFor();
    await studentPage.getByRole('button',{name:'Account decisions & appeals',exact:true}).click();
    await studentPage.getByText('Current formal warnings: 3',{exact:true}).waitFor();
    card=studentPage.getByTestId('account-action-'+second.action_id);
    await card.getByRole('button',{name:'Appeal this decision',exact:true}).click();
    await card.getByRole('textbox',{name:'Appeal explanation',exact:true}).fill('Please reconsider this second warning and restore my access.');
    await card.getByRole('button',{name:'Review appeal',exact:true}).click();
    const offline=route=>route.abort('internetdisconnected');
    await studentPage.route(submitEndpoint,offline);
    await card.getByRole('button',{name:'Confirm appeal',exact:true}).click();
    await card.getByRole('button',{name:'Retry saved attempt',exact:true}).waitFor();
    await reloadSignedIn(studentPage, target.credentials);await studentPage.getByRole('button',{name:'Account decisions & appeals',exact:true}).click();
    card=studentPage.getByTestId('account-action-'+second.action_id);
    await card.getByRole('button',{name:'Retry saved attempt',exact:true}).waitFor();
    await studentPage.unroute(submitEndpoint,offline);await card.getByRole('button',{name:'Retry saved attempt',exact:true}).click();
    await card.getByText('Your appeal was received.',{exact:true}).waitFor();
    await card.getByRole('button',{name:'Refresh result',exact:true}).click();
    await studentPage.screenshot({path:'.expo/appeals-student-check.png'});
    pass('suspended student can appeal, retain an offline attempt across restart and retry once');
    const secondAppeal=sql(`select id from safety_private.appeals where action_id='${second.action_id}'`);
    await page.getByRole('button',{name:'Back to appeals',exact:true}).click();
    await page.getByRole('button',{name:'Review appeal '+secondAppeal.slice(0,8),exact:true}).click();
    await page.getByRole('button',{name:'Overturn',exact:true}).click();
    await page.getByRole('textbox',{name:'Appeal decision reason',exact:true}).fill('The evidence does not support this warning; the decision is overturned.');
    await page.getByRole('button',{name:'Review decision',exact:true}).click();
    await fits(page,page.getByRole('button',{name:'Confirm appeal decision',exact:true}));
    const resolveEndpoint='**/rest/v1/rpc/resolve_moderation_appeal';
    await page.route(resolveEndpoint,lose);await page.getByRole('button',{name:'Confirm appeal decision',exact:true}).click();
    await page.getByRole('button',{name:'Retry saved attempt',exact:true}).waitFor();
    await page.unroute(resolveEndpoint,lose);await page.getByRole('button',{name:'Retry saved attempt',exact:true}).click();
    await page.getByText('Appeal decision recorded.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Refresh result',exact:true}).click();
    await page.getByText('Original decision overturned',{exact:true}).waitFor();
    assert.equal(sql(`select count(*) from safety_private.appeal_decisions where appeal_id='${secondAppeal}'`),'1');
    await page.screenshot({path:'.expo/appeals-admin-check.png'});
    await studentPage.getByRole('button',{name:'Refresh decisions',exact:true}).click();
    await studentPage.getByText('Original decision overturned',{exact:true}).waitFor();
    await studentPage.getByText('Current formal warnings: 2',{exact:true}).waitFor();
    await studentPage.getByRole('button',{name:'Back',exact:true}).click();
    // Leaving the suspension overlay restores the original profile/appeals route.
    // Navigate home to prove the existing session can access the app again.
    await openRoute(studentPage, origin);
    await studentPage.getByText('Hi, Target Fixture',{exact:true}).waitFor();
    assert.equal((await rpc(target,'get_my_account_standing')).warning_count,2);
    await openRoute(studentPage, origin+'/notifications');
    await studentPage.getByRole('button',{name:/Appeal decided: decision overturned/}).click();
    await studentPage.getByText('Current formal warnings: 2',{exact:true}).waitFor();
    await studentPage.screenshot({path:'.expo/appeal-notices-student-check.png',fullPage:true});
    assert.equal(sql(`select count(*) from public.notifications where recipient_id='${target.id}' and event_type='appeal_decided'`),'2');
    // A failed status refresh must never manufacture a zero warning count.
    const standingEndpoint='**/rest/v1/rpc/get_my_account_standing';
    await studentPage.getByRole('button',{name:'Appeal this decision',exact:true}).click();
    const unfinished=studentPage.getByRole('textbox',{name:'Appeal explanation',exact:true});
    await unfinished.fill('Unsubmitted explanation must survive a connection failure.');
    await studentPage.route(standingEndpoint,offline);
    await studentPage.getByRole('button',{name:'Refresh decisions',exact:true}).click();
    await studentPage.getByText(/Couldn’t refresh decisions or warning count/).waitFor();
    assert.equal(await studentPage.getByTestId('current-warning-count').count(),0);
    assert.equal(await unfinished.inputValue(),'Unsubmitted explanation must survive a connection failure.');
    await studentPage.unroute(standingEndpoint,offline);
    await studentPage.getByRole('button',{name:'Refresh decisions',exact:true}).click();
    await studentPage.getByText('Current formal warnings: 2',{exact:true}).waitFor();
    assert.equal(await unfinished.inputValue(),'Unsubmitted explanation must survive a connection failure.');
    pass('overturn exact retry lifts only the related automatic suspension and restores the existing session');
    await profile(studentPage,origin);await studentPage.getByRole('button',{name:'Log Out',exact:true}).click();
    await login(studentPage,reporter);await openRoute(studentPage, origin+'/profile/appeals');
    await studentPage.getByText('No account decisions.',{exact:true}).waitFor();
    await studentPage.getByText('Current formal warnings: 0',{exact:true}).waitFor();
    await openRoute(studentPage, origin+'/moderation/appeals');await studentPage.getByText('Moderation access required',{exact:true}).waitFor();
    assert.equal(await studentPage.getByText(explanation,{exact:true}).count(),0);
    pass('account switching isolates personal appeals and ordinary accounts cannot open the admin queue');
  } catch (error) {
    console.error('Browser check failed:', error);
    if (page) await page.screenshot({ path: '.expo/appeals-failure.png' }).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
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
        delete from safety_private.staff_roles where profile_id in (select id from moderation_fixture_users); commit;`);
      cleanupStudentFixtures(fixtures);
    }
    assert.equal(fingerprint(), before, 'Original Auth/public/private data must remain unchanged');
    pass('temporary roles, audit entries and accounts removed; original data fingerprints match');
  }
  console.log(`Appeals browser checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
