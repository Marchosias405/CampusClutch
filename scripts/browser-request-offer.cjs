const assert = require('node:assert/strict');
const { openRoute } = require('./browser-auth-navigation.cjs');

async function checkVisibleBounds(locator, screenWidth, minimumHeight = 0) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= screenWidth + 1,
    'Content should fit horizontally inside the screen');
  assert.ok(box.height >= minimumHeight, 'Actions should have enough height to tap');
  assert.ok(await locator.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    'Text should wrap without being cut off');
}

async function checkRequestOffer(poster, helper, title) {
  const origin = new URL(poster.url()).origin;
  await poster.getByText('Requests', { exact: true }).click();
  await poster.getByRole('button', { name: 'Post a request', exact: true }).click();
  for (const [type, details] of [['Delivery', 'Delivery Details'], ['Pickup', 'Pickup Details'],
    ['Event Help', 'Event Details'], ['Study Help', 'Study Details']]) {
    const option = poster.getByRole('radio', { name: type, exact: true });
    await option.click();
    await poster.getByRole('radio', { name: type, exact: true, checked: true }).waitFor();
    await poster.getByText(details, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await poster.getByText(/^(item\s*\/\s*task size|small|medium|large)$/i).count(), 0, type);
  }
  const titleInput = poster.getByLabel('Request title', { exact: true });
  const roomInput = poster.getByLabel('Room or specific location', { exact: true });
  const campus = poster.getByRole('button', { name: 'Campus, Burnaby', exact: true });
  const originalViewport = poster.viewportSize();
  await poster.getByRole('button', { name: 'Post Request', exact: true }).click();
  await poster.getByRole('alert').filter({ hasText: /title/i }).waitFor();
  await titleInput.fill(title);
  const room = 'Library third floor study room beside the elevators';
  await roomInput.fill(room);
  await campus.click();
  await poster.getByRole('button', { name: 'Campus, Burnaby', expanded: true }).waitFor();
  await poster.getByRole('radio', { name: 'Burnaby', checked: true }).click();
  await poster.getByRole('button', { name: 'Campus, Burnaby', expanded: false }).waitFor();
  const wideCampus = await campus.boundingBox();
  const wideRoom = await roomInput.boundingBox();
  assert.ok(wideRoom.x >= wideCampus.x + wideCampus.width, 'Campus and room should fit side by side at 480px');
  await poster.setViewportSize({ width: 320, height: originalViewport.height });
  const narrowCampus = await campus.boundingBox();
  const narrowRoom = await roomInput.boundingBox();
  assert.ok(narrowRoom.y >= narrowCampus.y + narrowCampus.height, 'Room should wrap below campus at 320px');
  assert.ok(narrowRoom.x >= 0 && narrowRoom.x + narrowRoom.width <= 320, 'Room should fit inside the screen');
  assert.equal(await roomInput.inputValue(), room);
  assert.equal(await titleInput.inputValue(), title);
  await poster.getByRole('textbox', { name: 'Course or subject', exact: true }).fill('MATH 151');
  await poster.getByRole('textbox', { name: 'Topic', exact: true }).fill('Differentiation');
  await poster.getByRole('textbox', { name: 'Description', exact: true }).fill('Help me practice differentiating polynomials.');
  await poster.getByRole('button', { name: 'Deadline (end of day), Pick date', exact: true }).click();
  await poster.getByRole('button', { name: 'Next month' }).click();
  await poster.getByRole('button').filter({ has: poster.getByText('1', { exact: true }) }).click();
  await poster.getByLabel('Points offered', { exact: true }).fill('5');
  await poster.getByRole('button', { name: /^Post Request\b/ }).click();
  await poster.waitForURL(/\/requests\/[a-f0-9-]{36}\/?$/i);
  const requestPath = new URL(poster.url()).pathname;
  await poster.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  await checkVisibleBounds(poster.getByText('Burnaby Campus, ' + room, { exact: true }), 320);
  await checkVisibleBounds(poster.getByText(room, { exact: true }), 320);
  await checkVisibleBounds(poster.getByRole('button', { name: 'Edit Request', exact: true }), 320, 48);
  await checkVisibleBounds(poster.getByRole('button', { name: 'Cancel Request', exact: true }), 320, 48);
  await poster.setViewportSize(originalViewport);

  await helper.setViewportSize({ width: 320, height: originalViewport.height });
  await helper.getByText('Requests', { exact: true }).click();
  const viewRequest = helper.getByRole('button', { name: 'View ' + title, exact: true });
  await checkVisibleBounds(viewRequest, 320, 48);
  await checkVisibleBounds(helper.getByRole('button', { name: 'My offers', exact: true }), 320, 48);
  const requestQuery = '**/rest/v1/requests?*';
  await helper.route(requestQuery, route => {
    const id = new URL(route.request().url()).searchParams.get('id');
    return id === 'eq.' + requestPath.split('/').pop() ? route.abort() : route.fallback();
  });
  await viewRequest.click();
  await helper.waitForURL(url => url.pathname === requestPath);
  await helper.getByText('Unable to load request', { exact: true }).waitFor();
  const retry = helper.getByRole('button', { name: 'Retry', exact: true });
  const back = helper.getByRole('button', { name: 'Back to Requests', exact: true });
  await checkVisibleBounds(retry, 320, 48);
  await checkVisibleBounds(back, 320, 48);
  const retryBox = await retry.boundingBox();
  const backBox = await back.boundingBox();
  assert.ok(backBox.y >= retryBox.y + retryBox.height + 8, 'Retry and Back should be separate targets');
  await helper.unroute(requestQuery);
  await retry.click();
  await helper.getByText(title, { exact: true }).filter({ visible: true }).waitFor();
  await helper.setViewportSize(originalViewport);
  const note = 'I can help with these derivatives.';
  await helper.getByLabel('Optional offer message').fill(note);
  const offer = helper.getByRole('button', { name: 'Offer Help', exact: true });
  for (const accept of [false, true]) {
    await Promise.all([
      helper.waitForEvent('dialog', { timeout: 10000 }).then(async dialog => {
        const message = dialog.message();
        if (accept) await dialog.accept(); else await dialog.dismiss();
        assert.equal(dialog.type(), 'confirm');
        assert.match(message, /offer to help for 5 points/i);
      }),
      offer.click(),
    ]);
    if (!accept) {
      await offer.waitFor({ state: 'visible' });
      assert.equal(await helper.getByLabel('Optional offer message').inputValue(), note);
    }
  }
  await helper.getByText('Pending', { exact: true }).waitFor({ state: 'visible' });
  await openRoute(poster, origin + '/');
  await poster.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
  await poster.getByRole('button', { name: /^New offer to help\./ }).first().click();
  await poster.waitForURL(url => url.pathname === requestPath);
  await poster.getByText(title, { exact: true }).waitFor({ state: 'visible' });
  await poster.getByText(note, { exact: true }).waitFor({ state: 'visible' });
  await poster.getByRole('button', { name: 'Accept helper', exact: true }).waitFor({ state: 'visible' });
}

module.exports = { checkRequestOffer };
