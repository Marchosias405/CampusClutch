// Run against an Expo web export and the local Supabase stack. Each browser
// context has its own storage, just as two students' devices would.
const assert = require('node:assert/strict');
const { openRoute, reloadSignedIn } = require('./browser-auth-navigation.cjs');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const serveStatic = require('serve-static');
const { localClientConfig, createStudentFixture, cleanupStudentFixtures } = require('./local-student-fixtures.cjs');

async function register(page, origin, credentials, name) {
  await page.goto(origin);
  await page.getByText('New to CampusClutch? Create Account', { exact: true }).click();
  await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(credentials.email);
  await page.getByPlaceholder('At least 8 characters').fill(credentials.password);
  await page.getByPlaceholder('Enter your password again').fill(credentials.password);
  await page.getByText('Create Account', { exact: true }).click();
  await page.getByPlaceholder('Alex Rivera').fill(name);
  await page.getByRole('switch', { name: 'Show me to other students' }).check();
  await page.getByText('Continue', { exact: true }).click();
  await page.getByText('Hi, ' + name, { exact: true }).waitFor();
}

async function enroll(page, offering) {
  await page.getByText('Add a course', { exact: true }).click();
  // The course picker defaults to the current term. Reuse the exact offering
  // across browsers, including campus, on both a seeded and an imported catalog.
  const add = offering ? page.getByRole('button', { name: 'Add ' + offering, exact: true })
    : page.getByRole('button', { name: /^Add [A-Z]+ [^,]+,/ }).first();
  const label = (await add.getAttribute('aria-label')).slice('Add '.length);
  await add.click();
  await page.getByText('Course added to My Courses.', { exact: true }).waitFor();
  return label;
}

async function checkHomeLayout(page, name) {
  await page.setViewportSize({ width: 320, height: 760 });
  for (const label of ['View points', 'View all courses', 'Add a course', 'Find a campus request']) {
    const control = page.getByRole('button', { name: label, exact: true });
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert.ok(box && box.width >= 48 && box.height >= 48, label + ' has a 48px target');
    assert.ok(box.x >= 0 && box.x + box.width <= 320, label + ' fits the viewport');
  }
  const greeting = page.getByText('Hi, ' + name, { exact: true });
  await greeting.scrollIntoViewIfNeeded();
  const greetingBox = await greeting.boundingBox();
  const pointsBox = await page.getByRole('button', { name: 'View points', exact: true }).boundingBox();
  if (greetingBox.y + greetingBox.height > pointsBox.y) {
    await page.screenshot({ path: '.expo/home-web-check.png' });
  }
  assert.ok(greetingBox.y + greetingBox.height <= pointsBox.y,
    'The long greeting stacks above View points: ' + JSON.stringify({ greetingBox, pointsBox }));
  for (const label of ['Home', 'Courses', 'Requests', 'Messages', 'Profile']) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    const box = await tab.boundingBox();
    assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= 0 && box.x + box.width <= 321,
      label + ' remains reachable in the bottom bar');
    await tab.click();
    await page.locator('[role="tab"][aria-selected="true"]').getByText(label, { exact: true }).waitFor();
  }
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Add a course', exact: true }).waitFor();
}

async function checkHomeRetry(page, code) {
  const course = page.getByRole('button', { name: new RegExp('^' + code + ', .*View classmates$') });
  await course.waitFor();
  const unavailable = route => route.abort();
  await page.route('**/rest/v1/course_memberships?*', unavailable);
  try {
    await page.getByRole('tab', { name: 'Profile', exact: true }).click();
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    await page.getByText('Unable to refresh your courses. Check your connection and try again.', { exact: true }).waitFor();
    assert.ok(await course.isVisible(), 'An unavailable refresh preserves the existing course');
    assert.equal(await page.getByRole('button', { name: 'Add a course', exact: true }).count(), 0);
    const retry = page.getByRole('button', { name: 'Retry home courses', exact: true });
    await retry.scrollIntoViewIfNeeded();
    const box = await retry.boundingBox();
    assert.ok(box && box.width >= 48 && box.height >= 48 && box.x + box.width <= 320);
  } finally {
    await page.unroute('**/rest/v1/course_memberships?*', unavailable);
  }
  await page.getByRole('button', { name: 'Retry home courses', exact: true }).click();
  await page.getByRole('button', { name: 'Retry home courses', exact: true }).waitFor({ state: 'hidden' });
  await course.waitFor();
}

async function targetFits(page, control, name) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48, name + ' has a 48px target');
  assert.ok(box.x >= -1 && box.x + box.width <= 321, name + ' fits at 320px');
}

async function checkStudentScreens(page, origin, code) {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByRole('tab', { name: 'Courses', exact: true }).click();
  const reviews = page.getByRole('button', { name: new RegExp('^Read reviews for ' + code + ',') });
  await reviews.waitFor();
  for (const control of [reviews, page.getByRole('button', { name: 'Find classmates in ' + code, exact: true }),
    page.getByRole('button', { name: 'Remove ' + code, exact: true }), page.getByRole('button', { name: 'Add a course', exact: true })]) {
    await targetFits(page, control, await control.getAttribute('aria-label'));
  }
  await reviews.click();
  await page.getByText('Reviews from all terms', { exact: true }).waitFor();
  const writeReview = page.getByRole('button', { name: 'Write a review', exact: true });
  await targetFits(page, writeReview, 'Write a review');
  await writeReview.click();
  await page.getByRole('textbox', { name: 'Your course review', exact: true }).fill('A useful course with interesting practical examples.');
  await targetFits(page, page.getByRole('button', { name: 'Save review', exact: true }), 'Save review');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Back to courses', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit profile', exact: true });
  await targetFits(page, edit, 'Edit profile');
  await edit.click();
  const major = page.getByRole('textbox', { name: 'Major (optional)', exact: true });
  await major.fill('Computing Science and Interactive Arts');
  await targetFits(page, page.getByRole('button', { name: 'Save Changes', exact: true }), 'Save profile');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.getByText('Profile updated.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back from Edit Profile', exact: true }).click();
  await edit.waitFor();
  await openRoute(page, origin + '/notification-preferences');
  await page.getByRole('switch', { name: 'Allow push notifications', exact: true }).waitFor();
  await targetFits(page, page.getByRole('button', { name: 'Back', exact: true }), 'Push settings Back');
  await openRoute(page, origin);
}

async function run() {
  const backend = localClientConfig();
  const folder = path.resolve(process.argv[2] || '.expo/task12-web');
  assert.ok(fs.existsSync(path.join(folder, 'index.html')), 'Export the local web app before running the browser test');
  const files = serveStatic(folder, { extensions: ['html'] });
  const server = http.createServer((req, res) => files(req, res, () => {
    // Match the exported dynamic route template when a test reloads a concrete
    // student, request or conversation URL (a production host needs this too).
    const match = /^\/(students|requests|messages)\/[0-9a-f-]{36}\/?$/.exec(new URL(req.url, 'http://localhost').pathname);
    if (!match) { res.writeHead(404).end(); return; }
    req.url = '/' + match[1] + '/%5Bid%5D.html';
    files(req, res, () => res.writeHead(404).end());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const accounts = [];
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await require('./browser-credential-storage.cjs').checkWebCredentialUpgrade(browser, origin, backend);
    const students = [];
    for (const role of ['Poster', 'Helper']) {
      const account = createStudentFixture();
      accounts.push(account);
      const name = role + ' Alexandria Montgomery-Wellington ' + account.email.slice(8, 16);
      const context = await browser.newContext({ viewport: { width: 480, height: 920 }, serviceWorkers: 'block' });
      // A stale export configured for a hosted backend must never create accounts there.
      await context.route('**/*', route => {
        const target = new URL(route.request().url()).origin;
        return target === origin || target === backend.url ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await register(page, origin, account, name);
      students.push({ page, name, account });
    }
    const [poster, helper] = students;
    console.log('PASS two browser sessions register and complete discoverable profiles');
    await checkHomeLayout(poster.page, poster.name);
    console.log('PASS narrow Home layout and all five bottom-tab destinations');

    await poster.page.getByText('Profile', { exact: true }).last().click();
    await poster.page.getByText('Log Out', { exact: true }).click();
    await poster.page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(accounts[0].email);
    await poster.page.getByPlaceholder('Enter your password').fill(accounts[0].password);
    await poster.page.getByText('Sign In', { exact: true }).click();
    await poster.page.getByText('Hi, ' + poster.name).waitFor();
    await reloadSignedIn(poster.page, accounts[0]);
    await poster.page.getByText('Hi, ' + poster.name).waitFor();
    console.log('PASS a student signs out and signs in again after a browser reload');

    const offering = await enroll(poster.page);
    await openRoute(poster.page, origin);
    await checkHomeRetry(poster.page, offering.split(',')[0]);
    console.log('PASS Home retains current courses through failed refresh and reconnects with Retry');
    await checkStudentScreens(poster.page, origin, offering.split(',')[0]);
    console.log('PASS narrow Courses, review editor, profile editing and notification settings');
    await enroll(helper.page, offering);
    await helper.page.setViewportSize({ width: 320, height: 760 });
    await helper.page.getByRole('button', { name: 'Classmates for ' + offering, exact: true }).click();
    await targetFits(helper.page, helper.page.getByLabel("View " + poster.name + "'s profile", { exact: true }), 'Classmate profile');
    await helper.page.getByLabel("View " + poster.name + "'s profile", { exact: true }).click();
    await helper.page.waitForURL(/\/students\//);
    await require('./browser-safety-report.cjs').checkStudentReport(helper.page, accounts[1]);
    const posterProfileUrl = helper.page.url();
    await helper.page.getByRole('button').filter({ has: helper.page.getByText('Message', { exact: true }) }).click();
    const body = 'Hello from ' + helper.name;
    await helper.page.setViewportSize({ width: 320, height: 500 });
    await helper.page.getByLabel('Message text', { exact: true }).fill(body);
    const conversationUrl = helper.page.url();
    const peerProfile = helper.page.getByRole('button', { name: "View " + poster.name + "'s profile", exact: true });
    await targetFits(helper.page, peerProfile, 'Conversation profile');
    await peerProfile.click();
    await helper.page.waitForURL(posterProfileUrl);
    await helper.page.getByText(poster.name, { exact: true }).filter({ visible: true }).waitFor();
    await helper.page.getByRole('button', { name: 'Back from Student Profile', exact: true }).click();
    await helper.page.waitForURL(conversationUrl);
    assert.equal(await helper.page.getByLabel('Message text', { exact: true }).inputValue(), body,
      'Opening the conversation peer profile and returning preserves the unsent message');
    console.log('PASS the DM header opens the correct profile and Back preserves the draft at 320px width');
    const blockMessages = route => route.abort();
    await helper.page.route('**/rest/v1/**', blockMessages);
    try {
      await helper.page.getByRole('button', { name: 'Send message', exact: true }).click();
      const retry = helper.page.getByRole('button', { name: 'Retry saved message', exact: true });
      await retry.waitFor({ timeout: 30000 });
      const box = await retry.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 501,
        'Offline Retry stays inside the short viewport');
      assert.equal(await helper.page.getByLabel('Message text', { exact: true }).inputValue(), body);
    } finally {
      await helper.page.unroute('**/rest/v1/**', blockMessages);
    }
    await helper.page.getByRole('button', { name: 'Retry saved message', exact: true }).click();
    await helper.page.getByText(body, { exact: true }).waitFor();
    assert.equal(await helper.page.getByText(body, { exact: true }).count(), 1);
    await helper.page.setViewportSize({ width: 320, height: 760 });
    console.log('PASS offline DM retains its message and exposes Retry in a short viewport, then sends once');
    console.log('PASS classmates find each other, open a profile and send a direct message');

    await openRoute(poster.page, origin);
    await poster.page.getByRole('tab', { name: 'Messages, 1 unread messages', exact: true }).waitFor();
    await poster.page.getByRole('button', { name: /^Notifications,/ }).click();
    await poster.page.getByRole('button', { name: /^New message\./ }).click();
    await poster.page.getByText(body, { exact: true }).waitFor();
    console.log('PASS the notification opens the conversation containing the new message');

    await openRoute(poster.page, origin);
    await openRoute(helper.page, origin);
    await poster.page.setViewportSize({ width: 480, height: 920 });
    await require('./browser-request-offer.cjs').checkRequestOffer(poster.page, helper.page, 'Study with ' + helper.name);
    console.log('PASS all four request forms, posting, offering help and opening the offer notification');
    await require('./browser-safety-report.cjs').checkRequestReport(poster.page, helper.page, accounts[1], accounts[0]);
    await require('./browser-student-blocks.cjs').checkStudentBlocks({ poster, helper, origin, posterProfileUrl, conversationUrl, body });
    await require('./browser-content-safety-reports.cjs').checkContentSafetyReports({ poster, helper, origin, accounts, conversationUrl, body, offering });
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      await new Promise(resolve => server.close(resolve));
      cleanupStudentFixtures(accounts);
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
