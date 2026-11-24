const assert = require('node:assert/strict');
const { openRoute, reloadSignedIn } = require('./browser-auth-navigation.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { countStudentFixtureReports } = require('./local-student-fixtures.cjs');

async function capture(page, name) {
  const folder = process.env.CONTENT_REPORT_SCREENSHOT_DIR;
  if (!folder) return;
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, 'content-reports-' + name + '.png') });
}

async function fits(control) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= -1 && box.x + box.width <= 321,
    'Content report controls fit the 320px viewport with 48px targets');
}
async function switchAccount(page, origin, account, name) {
  await openRoute(page, origin);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByText('Log Out', { exact: true }).click();
  await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(account.email);
  await page.getByPlaceholder('Enter your password').fill(account.password);
  await page.getByText('Sign In', { exact: true }).click();
  await page.getByText('Hi, ' + name, { exact: true }).waitFor();
}
async function loseReportResponse(page, account, type) {
  const rpc = '**/rest/v1/rpc/submit_safety_report';
  const before = countStudentFixtureReports(account, type);
  let original;
  const lose = async route => {
    original = route.request().postDataJSON();
    const response = await route.fetch();
    assert.equal(response.status(), 200, 'The local server saved the report before losing its response');
    await route.abort('connectionfailed');
  };
  await page.route(rpc, lose);
  try {
    const submit = page.getByRole('button', { name: 'Submit report', exact: true });
    await fits(submit); await submit.click();
    await page.getByText('Unable to confirm the report.', { exact: false }).waitFor();
    assert.equal(countStudentFixtureReports(account, type), before + 1);
    assert.equal(await page.getByRole('textbox', { name: 'Report details', exact: true }).isEditable(), false);
  } finally { await page.unroute(rpc, lose); }
  return { original, before, rpc };
}
async function retryReport(page, account, type, saved) {
  let retry;
  const observe = route => { retry = route.request().postDataJSON(); return route.continue(); };
  await page.route(saved.rpc, observe);
  try {
    const control = page.getByRole('button', { name: 'Retry report', exact: true });
    await control.waitFor(); await fits(control); await control.click();
    await page.getByText('Report received', { exact: true }).waitFor();
    assert.deepEqual(retry, saved.original, 'Same-session retry preserves the complete canonical report payload');
    assert.equal(countStudentFixtureReports(account, type), saved.before + 1, 'Exact retry never duplicates a report');
  } finally { await page.unroute(saved.rpc, observe); }
}

async function checkContentSafetyReports({ poster, helper, origin, accounts, conversationUrl, body, offering }) {
  const a = poster.page, b = helper.page;
  await a.setViewportSize({ width: 320, height: 760 });
  await b.setViewportSize({ width: 320, height: 760 });
  await openRoute(b, conversationUrl); await b.getByText(body, { exact: true }).waitFor();
  assert.equal(await b.getByRole('button', { name: 'Report message', exact: true }).count(), 0,
    'The author cannot report any of their own confirmed messages');
  await openRoute(a, conversationUrl); await a.getByText(body, { exact: true }).waitFor();
  const entry = a.getByRole('button', { name: 'Report message', exact: true }).first();
  await fits(entry); await capture(a, 'message-entry'); await entry.click();
  await a.getByText('Direct message', { exact: true }).waitFor();
  assert.equal(await a.getByText(body, { exact: true }).filter({ visible: true }).count(), 0, 'The report context does not copy the private message');
  assert.equal(await a.getByText(helper.name, { exact: true }).filter({ visible: true }).count(), 0, 'Report context exposes no author identity');
  await a.getByRole('radio', { name: 'Harassment', exact: true }).click();
  const details = 'Browser message concern with a pending same-session retry.';
  await a.getByRole('textbox', { name: 'Report details', exact: true }).fill(details);
  const messageReportUrl = a.url();
  const savedMessage = await loseReportResponse(a, accounts[0], 'message');
  await openRoute(a, messageReportUrl);
  await a.getByRole('button', { name: 'Retry report', exact: true }).waitFor();
  assert.equal(await a.getByRole('textbox', { name: 'Report details', exact: true }).inputValue(), details);
  await switchAccount(a, origin, accounts[1], helper.name);
  await openRoute(a, messageReportUrl);
  await a.getByText('This item is not available to your account.', { exact: false }).waitFor();
  assert.equal(await a.getByRole('textbox', { name: 'Report details', exact: true }).inputValue(), '', 'A new account cannot see the old account report draft');
  assert.equal(await a.getByRole('button', { name: 'Retry report', exact: true }).count(), 0);
  await switchAccount(a, origin, accounts[0], poster.name);
  await openRoute(a, messageReportUrl);
  await a.getByRole('radio', { name: 'Other', exact: true }).click();
  assert.equal(await a.getByRole('textbox', { name: 'Report details', exact: true }).inputValue(), '', 'Signing back in starts a fresh report');
  assert.equal(await a.getByRole('button', { name: 'Retry report', exact: true }).count(), 0);
  assert.equal(countStudentFixtureReports(accounts[0], 'message'), savedMessage.before + 1, 'Switching accounts never resubmits the report');
  await openRoute(a, conversationUrl); await a.getByText(body, { exact: true }).waitFor();
  console.log('PASS narrow message reporting, safe context, own rejection, lost response, reload and old/new account isolation');

  const code = offering.split(',')[0];
  const reviewsUrl = origin + '/courses/reviews?code=' + encodeURIComponent(code);
  await openRoute(a, reviewsUrl);
  await a.getByRole('button', { name: 'Write a review', exact: true }).click();
  await a.getByRole('button', { name: 'Difficulty 2 out of 5', exact: true }).click();
  await a.getByRole('button', { name: 'Workload 3 out of 5', exact: true }).click();
  await a.getByRole('button', { name: 'Yes', exact: true }).click();
  const reviewText = 'Browser content report fixture: practical examples made this course useful.';
  await a.getByRole('textbox', { name: 'Your course review', exact: true }).fill(reviewText);
  const saveResponse = a.waitForResponse(response => response.url().endsWith('/rest/v1/rpc/save_my_course_review'));
  await a.getByRole('button', { name: 'Save review', exact: true }).click();
  const reviewId = await (await saveResponse).json();
  assert.match(reviewId, /^[0-9a-f-]{36}$/);
  await a.getByText('Your review was saved.', { exact: false }).waitFor();
  assert.equal(await a.getByTestId('report-review-' + reviewId).count(), 0, 'Own anonymous review has no report control');
  await openRoute(b, reviewsUrl); await b.getByText(reviewText, { exact: true }).waitFor();
  const reviewEntry = b.getByTestId('report-review-' + reviewId);
  await fits(reviewEntry); await capture(b, 'review-entry'); await reviewEntry.click();
  await b.getByText(code + ' course review', { exact: true }).waitFor();
  await capture(b, 'report-form');
  assert.equal(await b.getByText(poster.name, { exact: true }).filter({ visible: true }).count(), 0);
  assert.equal(await b.getByText(reviewText, { exact: true }).filter({ visible: true }).count(), 0);
  await b.getByRole('radio', { name: 'Other', exact: true }).click();
  const reviewDetails = 'Browser review concern preserved after the original review is removed.';
  await b.getByRole('textbox', { name: 'Report details', exact: true }).fill(reviewDetails);
  const reviewReportUrl = b.url();
  const savedReview = await loseReportResponse(b, accounts[1], 'course_review');
  await reloadSignedIn(a, accounts[0]); await a.getByText(reviewText, { exact: true }).waitFor();
  await a.getByRole('button', { name: /^Delete your .* review$/ }).click();
  await a.getByRole('button', { name: 'Delete review', exact: true }).click();
  await a.getByText('Your review was removed.', { exact: false }).waitFor();
  await openRoute(b, reviewReportUrl);
  await b.getByRole('button', { name: 'Retry report', exact: true }).waitFor();
  assert.equal(await b.getByRole('textbox', { name: 'Report details', exact: true }).inputValue(), reviewDetails);
  await retryReport(b, accounts[1], 'course_review', savedReview);
  await openRoute(b, reviewReportUrl);
  await b.getByText('This item is not available to your account.', { exact: false }).waitFor();
  await b.getByRole('radio', { name: 'Spam', exact: true }).click();
  assert.equal(await b.getByRole('button', { name: 'Submit report', exact: true }).isDisabled(), true,
    'A deleted target rejects a new operation while its saved exact operation can reconcile');
  await openRoute(b, reviewsUrl);
  await b.getByText('Reviews from all terms', { exact: true }).waitFor();
  assert.equal(await b.getByText(reviewText, { exact: true }).count(), 0);
  console.log('PASS anonymous course-review report, own-entry suppression, safe context and exact retry after review deletion');
}

module.exports = { checkContentSafetyReports };
