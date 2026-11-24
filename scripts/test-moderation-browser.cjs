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
function grant(user, enabled = true) { sql(`select safety_private.assign_staff_role('${user.id}','moderator',${enabled},'Disposable local browser test assignment')`); }
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
  const folder = path.resolve(process.argv[2] || '.expo/task14-web');
  assert.ok(fs.existsSync(path.join(folder, 'index.html')), 'Export the local web app first');
  const bundleFolder = path.join(folder, '_expo/static/js/web');
  assert.ok(fs.readdirSync(bundleFolder).filter(name => name.endsWith('.js'))
    .some(name => fs.readFileSync(path.join(bundleFolder, name), 'utf8').includes(url)),
  'The web export must use the same local API as this test. Re-export with --clear after changing ports.');
  const before = fingerprint(); let browser, page, server;
  try {
    const reporter = await student('Reporter Fixture'), target = await student('Target Fixture');
    const mod = await student('Reviewer Fixture'), colleague = await student('Colleague Fixture');
    grant(mod); grant(colleague);
    const conversation = await rpc(reporter, 'start_direct_conversation', { p_other_profile_id: target.id });
    const evidence = 'Private evidence fixture: only the selected message is visible.';
    const message = await rpc(target, 'send_conversation_message', { p_conversation_id: conversation, p_client_message_id: randomUUID(), p_body: evidence });
    const report = await rpc(reporter, 'submit_safety_report', { p_operation_id: randomUUID(), p_target_type: 'message', p_target_id: message.id,
      p_reason: 'spam', p_details: 'Testing moderator evidence and durable decisions.' });
    const own = await rpc(mod, 'submit_safety_report', { p_operation_id: randomUUID(), p_target_type: 'student', p_target_id: target.id,
      p_reason: 'spam', p_details: 'Conflicted report must be excluded.' });
    // Extra disposable queue rows exercise a real 20-row cursor without spending
    // student quotas or creating unrelated accounts. All use this test's actors.
    sql(`insert into safety_private.reports(reporter_id,reported_profile_id,operation_id,target_type,reason,details,payload_hash,evidence,created_at)
      select reporter_id,reported_profile_id,gen_random_uuid(),'student','spam','Pagination fixture',payload_hash,
        jsonb_build_object('display_name','Queue fixture student'),created_at - n*interval '1 second'
      from safety_private.reports cross join generate_series(1,21) n where id='${report.report_id}'`);
    const files = serveStatic(folder, { extensions: ['html'] });
    server = http.createServer((req, res) => files(req, res, () => {
      const match = /^\/moderation\/[0-9a-f-]{36}\/?$/.exec(new URL(req.url, 'http://localhost').pathname);
      if (!match) { res.writeHead(404).end(); return; }
      req.url = '/moderation/%5Bid%5D.html'; files(req, res, () => res.writeHead(404).end());
    }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 760 } });
    await context.route('**/*', route => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(origin + '/') || requestUrl.startsWith(url + '/') || requestUrl.startsWith('data:')) return route.continue();
      return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.goto(origin); await login(page, reporter); await profile(page, origin);
    assert.equal(await page.getByRole('button', { name: 'Review reports', exact: true }).count(), 0);
    await openRoute(page, origin + '/moderation'); await page.getByText('Moderation access required', { exact: true }).waitFor();
    await openRoute(page, origin + '/moderation/' + report.report_id); await page.getByText('Moderation access required', { exact: true }).waitFor();
    assert.equal(await page.getByText(evidence, { exact: true }).count(), 0);
    pass('ordinary accounts have no staff entry and direct links cannot reveal reports');

    await profile(page, origin); await page.getByRole('button', { name: 'Log Out', exact: true }).click(); await login(page, mod); await profile(page, origin);
    await page.getByRole('button', { name: 'Review reports', exact: true }).click();
    await page.getByRole('button', { name: 'Load more reports', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Review (message|student) report / }).count(), 20);
    assert.equal(await page.getByText(evidence, { exact: true }).count(), 0);
    assert.equal(await page.getByText('Conflicted report must be excluded.', { exact: true }).count(), 0);
    const controls = ['New', 'Reviewing', 'Escalated', 'Dismissed', 'Refresh reports', 'Load more reports'];
    for (const label of controls) await fits(page, page.getByRole('button', { name: label, exact: true }));
    await page.getByRole('button', { name: 'Load more reports', exact: true }).click();
    await page.getByRole('button', { name: /^Review (message|student) report / }).nth(21).waitFor();
    await page.getByRole('button', { name: 'Load more reports', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: /^Review (message|student) report / }).count(), 22);
    await page.getByRole('button', { name: 'Review message report ' + report.report_id.slice(0, 8), exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.expo/moderation-queue-check.png' });
    await page.getByRole('button', { name: 'Reviewing', exact: true }).click();
    await page.getByText('No reviewing reports available to your account.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Review (message|student) report / }).count(), 0);
    const queueEndpoint = '**/rest/v1/rpc/list_moderation_reports';
    const failedQueue = route => route.abort('connectionfailed');
    await page.route(queueEndpoint, failedQueue); await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('button', { name: 'Retry reports', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Review (message|student) report / }).count(), 0);
    await page.unroute(queueEndpoint, failedQueue); await page.getByRole('button', { name: 'Retry reports', exact: true }).click();
    await page.getByRole('button', { name: 'Load more reports', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Review (message|student) report / }).count(), 20);
    pass('assigned staff queue paginates without duplicates and keeps evidence out of summaries');

    await page.getByRole('button', { name: 'Review message report ' + report.report_id.slice(0, 8), exact: true }).click();
    await page.getByText(evidence, { exact: true }).waitFor();
    await fits(page, page.getByRole('button', { name: 'Back', exact: true }));
    await fits(page, page.getByRole('button', { name: 'Record decision', exact: true }));
    assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).isDisabled(), true);
    await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).fill('short');
    assert.equal(await page.getByRole('button', { name: 'Record decision', exact: true }).isDisabled(), true);
    const note = 'Reviewed the selected message and started investigation.';
    await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).fill(note);
    await page.getByRole('button', { name: 'Record decision', exact: true }).click();
    await fits(page, page.getByRole('button', { name: 'Confirm decision', exact: true }));
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '0');
    await page.getByText('Submitted evidence', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.expo/moderation-detail-check.png' });
    pass('private snapshot renders, required explanation validates and cancelled confirmation writes nothing');

    const endpoint = '**/rest/v1/rpc/record_moderation_decision'; let committed;
    const lost = async route => { committed = route.request().postDataJSON(); const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('connectionfailed'); };
    await page.route(endpoint, lost);
    await page.getByRole('button', { name: 'Record decision', exact: true }).click(); await page.getByRole('button', { name: 'Confirm decision', exact: true }).click();
    await page.getByRole('button', { name: 'Retry saved decision', exact: true }).waitFor(); await page.unroute(endpoint, lost);
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '1');
    await reloadSignedIn(page, mod.credentials); await page.getByRole('button', { name: 'Retry saved decision', exact: true }).waitFor();
    const saved = await page.evaluate(() => Object.entries(localStorage).filter(([name]) => name.startsWith('campusclutch:moderation-decision:')).map(([, raw]) => JSON.parse(raw)));
    assert.equal(saved.length, 1); assert.equal(saved[0].attempt.note, note); assert.equal(JSON.stringify(saved).includes(evidence), false);
    assert.equal(await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).count(), 0);
    const exactRetry = async route => { assert.deepEqual(route.request().postDataJSON(), committed); await route.continue(); };
    await page.route(endpoint, exactRetry); await page.getByRole('button', { name: 'Retry saved decision', exact: true }).click();
    await page.getByText('Decision recorded', { exact: true }).waitFor(); await page.unroute(endpoint, exactRetry);
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '1');
    await page.getByRole('button', { name: 'Reload report', exact: true }).click(); await page.getByText(note, { exact: true }).waitFor();
    pass('committed response loss survives reload and exact retry records one decision with visible history');

    await rpc(colleague, 'record_moderation_decision', { p_report_id: report.report_id, p_operation_id: randomUUID(), p_expected_version: 1,
      p_status: 'escalated', p_note: 'A colleague escalated this report while it was open.' });
    await page.getByRole('button', { name: 'Dismissed', exact: true }).click();
    await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).fill('Stale decision must not overwrite a colleague.');
    await page.getByRole('button', { name: 'Record decision', exact: true }).click(); await page.getByRole('button', { name: 'Confirm decision', exact: true }).click();
    await page.getByRole('button', { name: 'Review latest version', exact: true }).waitFor();
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '2');
    await page.getByRole('button', { name: 'Review latest version', exact: true }).click();
    await page.getByText('Escalated', { exact: true }).waitFor();
    await page.getByText('Version 2', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).inputValue(), '');
    pass('a competing decision produces a conflict and forces review of the latest version');

    const offline = route => route.abort('connectionfailed'); await page.route(endpoint, offline);
    await page.getByRole('textbox', { name: 'Reason for decision', exact: true }).fill('Pending decision belongs only to this moderator.');
    await page.getByRole('button', { name: 'Record decision', exact: true }).click(); await page.getByRole('button', { name: 'Confirm decision', exact: true }).click();
    await page.getByRole('button', { name: 'Retry saved decision', exact: true }).waitFor(); await page.unroute(endpoint, offline);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByText(evidence, { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(evidence, { exact: true }).count(), 0, 'blur unmounts private content');
    await profile(page, origin); await page.getByRole('button', { name: 'Log Out', exact: true }).click(); await login(page, reporter);
    await openRoute(page, origin + '/moderation/' + report.report_id); await page.getByText('Moderation access required', { exact: true }).waitFor();
    assert.equal(await page.getByText('Pending decision belongs only to this moderator.', { exact: true }).count(), 0);
    await profile(page, origin); await page.getByRole('button', { name: 'Log Out', exact: true }).click(); await login(page, mod);
    await openRoute(page, origin + '/moderation/' + report.report_id); await page.getByRole('button', { name: 'Retry saved decision', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry saved decision', exact: true }).click(); await page.getByText('Decision recorded', { exact: true }).waitFor();
    assert.equal(sql(`select count(*) from safety_private.report_decisions where report_id='${report.report_id}'`), '3');
    pass('offline attempts persist across real sign-out, stay isolated, and reconcile only in the original account');

    await page.getByRole('button', { name: 'Reload report', exact: true }).click(); await page.getByText(evidence, { exact: true }).waitFor();
    const readEndpoint = '**/rest/v1/rpc/get_moderation_report'; await page.route(readEndpoint, offline); await reloadSignedIn(page, mod.credentials);
    await page.getByRole('button', { name: 'Reload report', exact: true }).waitFor(); assert.equal(await page.getByText(evidence, { exact: true }).count(), 0);
    await page.unroute(readEndpoint, offline); await page.getByRole('button', { name: 'Reload report', exact: true }).click();
    await page.getByText(evidence, { exact: true }).waitFor();
    pass('failed evidence loading hides private content and recovers through explicit retry');

    grant(mod, false);
    await page.getByText('Moderation access required', { exact: true }).waitFor({ timeout: 45000 });
    assert.equal(await page.getByText(evidence, { exact: true }).count(), 0);
    await profile(page, origin); assert.equal(await page.getByRole('button', { name: 'Review reports', exact: true }).count(), 0);
    grant(mod); await openRoute(page, origin + '/moderation/' + own.report_id);
    await page.getByText('Unable to verify access', { exact: true }).waitFor();
    assert.equal(await page.getByText('Conflicted report must be excluded.', { exact: true }).count(), 0);
    pass('live role revocation hides evidence and self-involved reports remain inaccessible');
  } catch (error) {
    console.error('Browser check failed:', error);
    if (page) await page.screenshot({ path: '.expo/moderation-failure.png' }).catch(() => undefined);
    throw error;
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    if (fixtures.length) {
      const emails = fixtures.map(({ email }) => { assert.match(email, /^journey-[0-9a-f-]{36}@test\.local$/); return `'${email}'`; }).join(',');
      sql(`begin;
        create temporary table moderation_fixture_users on commit drop as select id from auth.users where email in (${emails});
        create temporary table moderation_fixture_reports on commit drop as select id from safety_private.reports
          where reporter_id in (select id from moderation_fixture_users) or reported_profile_id in (select id from moderation_fixture_users);
        delete from safety_private.report_views where report_id in (select id from moderation_fixture_reports);
        delete from safety_private.report_decisions where report_id in (select id from moderation_fixture_reports);
        delete from safety_private.staff_role_events where profile_id in (select id from moderation_fixture_users);
        delete from safety_private.staff_roles where profile_id in (select id from moderation_fixture_users); commit;`);
      cleanupStudentFixtures(fixtures);
    }
    assert.equal(fingerprint(), before, 'Original Auth/public/private data must remain unchanged');
    pass('temporary roles, audit entries and accounts removed; original data fingerprints match');
  }
  console.log(`Moderation browser checks passed: ${checks}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
