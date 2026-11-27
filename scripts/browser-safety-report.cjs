const assert = require('node:assert/strict');
const { openRoute, reloadSignedIn } = require('./browser-auth-navigation.cjs');
const { countStudentFixtureReports } = require('./local-student-fixtures.cjs');

async function fits(page, control) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= -1 && box.x + box.width <= 321,
    'Report control fits the 320px viewport and has a 48px target');
}

async function checkStudentReport(page, account) {
  const profileUrl = page.url();
  await page.setViewportSize({ width: 320, height: 760 });
  const entry = page.getByRole('button', { name: 'Report student', exact: true });
  await fits(page, entry);
  await entry.click();
  const details = page.getByRole('textbox', { name: 'Report details', exact: true });
  const other = page.getByRole('radio', { name: 'Other', exact: true });
  await other.click();
  await details.fill('short');
  assert.equal(await page.getByRole('button', { name: 'Submit report', exact: true }).isDisabled(), true);
  const text = 'Browser fixture: private report retained after a lost response.';
  await details.fill(text);
  await reloadSignedIn(page, account);
  await details.waitFor();
  await other.click();
  assert.equal(await details.inputValue(), '', 'Reload clears in-memory private report text');
  await details.fill(text);
  const submit = page.getByRole('button', { name: 'Submit report', exact: true });
  await fits(page, submit);
  const initial = countStudentFixtureReports(account, 'student');
  const rpc = '**/rest/v1/rpc/submit_safety_report';
  let firstOperation;
  const loseResponse = async route => {
    firstOperation = route.request().postDataJSON().p_operation_id;
    const result = await route.fetch();
    assert.equal(result.status(), 200, 'The server saves the report before its response is lost');
    await route.abort('connectionfailed');
  };
  await page.route(rpc, loseResponse);
  try {
    await submit.click();
    await page.getByText('Unable to confirm the report.', { exact: false }).waitFor();
    assert.equal(await details.isEditable(), false, 'An unconfirmed attempt is frozen for exact retry');
    assert.equal(countStudentFixtureReports(account, 'student'), initial + 1);
    await openRoute(page, page.url());
    await page.getByRole('button', { name: 'Retry report', exact: true }).waitFor();
    assert.equal(await details.inputValue(), text, 'Pending report survives navigation in the same session');
    await page.getByRole('button', { name: 'Discard saved attempt', exact: true }).click();
    await page.getByRole('button', { name: 'Keep saved attempt', exact: true }).click();
    assert.equal(await details.inputValue(), text, 'Cancelling discard preserves the exact saved report');
  } finally { await page.unroute(rpc, loseResponse); }
  let retriedOperation;
  const observeRetry = route => {
    retriedOperation = route.request().postDataJSON().p_operation_id;
    return route.continue();
  };
  await page.route(rpc, observeRetry);
  try {
    const retry = page.getByRole('button', { name: 'Retry report', exact: true });
    await fits(page, retry);
    await retry.click();
    await page.getByText('Report received', { exact: true }).waitFor();
    assert.equal(retriedOperation, firstOperation, 'Same-session retry uses the same operation');
    assert.equal(countStudentFixtureReports(account, 'student'), initial + 1, 'Retry creates no duplicate report');
  } finally { await page.unroute(rpc, observeRetry); }
  await openRoute(page, profileUrl);
  await entry.waitFor();
  console.log('PASS private student report, draft cleanup on reload, same-session navigation and exact retry');
}

async function checkRequestReport(poster, helper, helperAccount, posterAccount) {
  assert.equal(await poster.getByRole('button', { name: 'Report request', exact: true }).count(), 0,
    'An owner cannot report their own request');
  const requestUrl = helper.url();
  await helper.setViewportSize({ width: 320, height: 760 });
  await helper.getByRole('button', { name: 'Report request', exact: true }).click();
  await helper.getByRole('radio', { name: 'Spam', exact: true }).click();
  const before = countStudentFixtureReports(helperAccount, 'request');
  await helper.getByRole('button', { name: 'Submit report', exact: true }).click();
  await helper.getByText('Report received', { exact: true }).waitFor();
  assert.equal(countStudentFixtureReports(helperAccount, 'request'), before + 1);
  assert.equal(countStudentFixtureReports(posterAccount, 'request'), 0, 'Report remains attached to the reporting account');
  await openRoute(helper, requestUrl);
  await helper.getByText('Pending', { exact: true }).waitFor();
  await reloadSignedIn(poster, posterAccount);
  await poster.getByRole('button', { name: 'Accept helper', exact: true }).waitFor();
  console.log('PASS request report without changing the request, offer or owner permissions');
}

module.exports = { checkStudentReport, checkRequestReport };
