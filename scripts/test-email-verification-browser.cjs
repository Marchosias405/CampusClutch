const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const serveStatic = require('serve-static');
const { localClientConfig, createStudentFixture, cleanupStudentFixtures } = require('./local-student-fixtures.cjs');
const { readMailLink, cleanupMail } = require('./email-link-test-helpers.cjs');
async function run() {
  localClientConfig();
  const files = serveStatic(path.resolve(process.argv[2] || '.expo/email-verification-web'), { extensions: ['html'] });
  const server = http.createServer((req, res) => files(req, res, () => res.writeHead(404).end()));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const student = createStudentFixture(), emails = new Set(); let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let page = await phone.newPage(); await page.goto(origin);
    await page.getByText('New to CampusClutch? Create Account', { exact: true }).click();
    await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(student.email);
    await page.getByPlaceholder('At least 8 characters').fill(student.password);
    await page.getByPlaceholder('Enter your password again').fill(student.password);
    await page.getByText('Create Account', { exact: true }).click();
    await page.getByLabel('Verification email address', { exact: true }).waitFor();
    await page.getByText('Open the verification link on any device. Then return to CampusClutch and sign in.', { exact: true }).waitFor();
    await page.screenshot({ path: '.expo/email-verification-screen.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 360 });
    for (const control of [page.getByLabel('Verification email address', { exact: true }), page.getByRole('button', { name: 'Return to Sign In', exact: true }), page.getByText('Resend Verification Email', { exact: true })]) {
      await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 321 && box.y >= 0 && box.y + box.height <= 361);
    }
    const link = await readMailLink(student.email, emails);
    const laptop = await browser.newContext();
    const reader = await laptop.newPage(); await reader.goto(link);
        await reader.getByText(/Email verification complete/).waitFor();
    assert.equal(await reader.evaluate(() => localStorage.length), 0, 'Reading the link does not save an app session on the other device');
    await page.getByRole('button', { name: 'Return to Sign In', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'student@example.com', exact: true }).inputValue(), student.email);
    assert.equal(await page.locator('input[placeholder="Enter your password"]:visible').inputValue(), '');
    await phone.close();
    const restarted = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await restarted.newPage(); await page.goto(origin);
    await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(student.email);
    await page.getByPlaceholder('Enter your password').fill(student.password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await page.getByPlaceholder('Alex Rivera').waitFor();
    console.log('PASS signup phone UI, separate browser email confirmation, small-screen controls and fresh-app password sign-in');
  } finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
    cleanupStudentFixtures([student]); await cleanupMail(emails);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
