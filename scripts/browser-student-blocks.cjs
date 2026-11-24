const assert = require('node:assert/strict');
const { openRoute, reloadSignedIn } = require('./browser-auth-navigation.cjs');

async function confirm(page, blocked) {
  await page.getByRole('button', { name: blocked ? 'Block student' : 'Unblock student', exact: true }).click();
  await page.getByRole('button', { name: blocked ? 'Confirm block' : 'Confirm unblock', exact: true }).click();
}

async function checkStudentBlocks({ poster, helper, origin, posterProfileUrl, conversationUrl, body }) {
  const a = poster.page, b = helper.page;
  await openRoute(a, conversationUrl);
  await a.getByRole('button', { name: "View " + helper.name + "'s profile", exact: true }).click();
  await a.waitForURL(/\/students\//);
  const helperProfileUrl = a.url();
  await openRoute(a, conversationUrl);
  await a.getByLabel('Message text', { exact: true }).fill('Draft survives peer blocking');
  await openRoute(b, posterProfileUrl);
  await b.setViewportSize({ width: 320, height: 760 });
  const rpc = '**/rest/v1/rpc/set_student_block';
  let original;
  const loseResponse = async route => {
    original = route.request().postDataJSON();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('connectionfailed');
  };
  await b.route(rpc, loseResponse);
  try {
    await confirm(b, true);
    await b.getByRole('button', { name: 'Retry saved block change', exact: true }).waitFor();
    await reloadSignedIn(b, helper.account);
    await b.getByRole('button', { name: 'Retry saved block change', exact: true }).waitFor();
  } finally { await b.unroute(rpc, loseResponse); }
  let retry;
  const observe = route => { retry = route.request().postDataJSON(); return route.continue(); };
  await b.route(rpc, observe);
  try {
    await b.getByRole('button', { name: 'Retry saved block change', exact: true }).click();
    await b.getByRole('button', { name: 'Unblock student', exact: true }).waitFor();
    assert.deepEqual(retry, original, 'A restarted block retries the same version and intent');
  } finally { await b.unroute(rpc, observe); }
  await a.getByText('Messaging is unavailable between these accounts.', { exact: false }).waitFor();
  assert.equal(await a.getByLabel('Message text', { exact: true }).isEditable(), false);
  assert.equal(await a.getByLabel('Message text', { exact: true }).inputValue(), 'Draft survives peer blocking');
  await a.getByText(body, { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Report student', exact: true }).click();
  await b.getByRole('radio', { name: 'Harassment', exact: true }).click();
  await b.getByRole('button', { name: 'Submit report', exact: true }).click();
  await b.getByText('Report received', { exact: true }).waitFor();
  console.log('PASS block survives lost response/reload, live peer composer closes, history/draft and reporting remain');

  await openRoute(b, origin + '/profile/blocked');
  await b.getByText(poster.name, { exact: true }).waitFor();
  await reloadSignedIn(b, helper.account);
  const unblock = b.getByRole('button', { name: 'Unblock student', exact: true });
  await unblock.waitFor(); await unblock.scrollIntoViewIfNeeded();
  const box = await unblock.boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48 && box.x >= -1 && box.x + box.width <= 321);
  await confirm(b, false);
  await b.getByText('No blocked students', { exact: true }).waitFor();
  await a.waitForFunction(() => document.querySelector('[aria-label="Message text"]')?.readOnly === false);
  assert.equal(await a.getByLabel('Message text', { exact: true }).inputValue(), 'Draft survives peer blocking');

  // Both users own independent blocks; removing only one must not restore contact.
  await openRoute(b, posterProfileUrl); await confirm(b, true);
  await b.getByRole('button', { name: 'Unblock student', exact: true }).waitFor();
  await openRoute(a, helperProfileUrl); await confirm(a, true);
  await a.getByRole('button', { name: 'Unblock student', exact: true }).waitFor();
  await openRoute(b, origin + '/profile/blocked'); await confirm(b, false);
  await b.getByText('No blocked students', { exact: true }).waitFor();
  await openRoute(b, conversationUrl);
  await b.getByText('Messaging is unavailable between these accounts.', { exact: false }).waitFor();
  assert.equal(await b.getByLabel('Message text', { exact: true }).isEditable(), false);
  await openRoute(a, origin + '/profile/blocked'); await confirm(a, false);
  await a.getByText('No blocked students', { exact: true }).waitFor();
  await b.waitForFunction(() => document.querySelector('[aria-label="Message text"]')?.readOnly === false);
  await b.getByLabel('Message text', { exact: true }).fill('Contact restored after both unblocked');
  await b.getByRole('button', { name: 'Send message', exact: true }).click();
  await b.getByText('Contact restored after both unblocked', { exact: true }).waitFor();
  console.log('PASS blocked list, narrow controls, mutual blocks, independent unblock and restored messaging');
}

module.exports = { checkStudentBlocks };
