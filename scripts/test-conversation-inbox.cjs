/* global __dirname */
// Exercise the production inbox controller with deferred network responses; no database or emulator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/conversationInbox.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const production = {};
class MillisecondDate extends Date {
  static parse(value) {
    assert.ok(!/\.\d{4,}/.test(value), 'Date.parse must not depend on Android accepting sub-millisecond digits');
    return Date.parse(value);
  }
}
vm.runInNewContext(compiled, { exports: production, Date: MillisecondDate }, { filename: 'conversationInbox.ts' });
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
let checks = 0;
async function test(name, run) { await run(); checks += 1; console.log('PASS ' + name); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function row(number, overrides = {}) {
  return {
    id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    type: 'direct', status: 'active', other_profile_id: `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    other_display_name: 'Classmate ' + number, last_message_body: 'Message ' + number,
    last_message_at: `2026-09-26T12:${String(59 - number).padStart(2, '0')}:00.123456+00:00`,
    last_activity_at: `2026-09-26T12:${String(59 - number).padStart(2, '0')}:00.123456+00:00`,
    last_message_sequence: '9007199254740993', last_read_sequence: '0', unread_count: 1,
    created_at: '2026-09-26T00:00:00.000000+00:00', ...overrides,
  };
}
function page(items, hasMore = false) {
  const last = items.at(-1);
  assert.ok(!hasMore || last, 'A continuation needs a real cursor');
  return { items, hasMore, nextCursor: hasMore ? { id: last.id, activityAt: last.last_activity_at } : null };
}
function harness() {
  const calls = [];
  const model = production.createConversationInbox(before => {
    const pending = deferred();
    calls.push({ before: plain(before), ...pending });
    return pending.promise;
  });
  return { model, calls, state: () => plain(model.getSnapshot()) };
}
async function loaded(items = [row(1), row(2)], hasMore = true) {
  const h = harness();
  h.model.setActive(true);
  h.calls[0].resolve(page(items, hasMore));
  await tick();
  return h;
}

(async () => {
  await test('inactive screens make no requests; focus starts one initial load with exact server rows', async () => {
    const h = harness();
    await h.model.refresh();
    await h.model.refresh(true);
    assert.equal(h.calls.length, 0);
    assert.equal(h.state().loaded, false);
    h.model.setActive(true);
    h.model.setActive(true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].before, null);
    assert.equal(h.state().loading, true);
    h.calls[0].resolve(page([row(1), row(2)], true));
    await tick();
    assert.deepEqual(h.state().items, [row(1), row(2)]);
    assert.equal(h.state().loaded, true);
    assert.equal(h.state().loading, false);
    assert.equal(h.state().error, null);
    assert.deepEqual(h.state().cursor, page([row(1), row(2)], true).nextCursor);
  });

  await test('late success after blur cannot expose rows or mark the unfocused visit loaded', async () => {
    const h = harness();
    h.model.setActive(true);
    h.model.setActive(false);
    const before = h.state();
    h.calls[0].resolve(page([row(1)], true));
    await tick();
    assert.deepEqual(h.state(), before);
    assert.equal(h.state().items.length, 0);
    assert.equal(h.state().loaded, false);
    assert.equal(h.state().loading, false);
  });

  await test('refocus starts fresh work and an earlier success cannot replace it or stop its spinner', async () => {
    const h = harness();
    h.model.setActive(true);
    h.model.setActive(false);
    h.model.setActive(true);
    assert.equal(h.calls.length, 2);
    h.calls[0].resolve(page([row(1)], true));
    await tick();
    assert.equal(h.state().items.length, 0);
    assert.equal(h.state().loading, true);
    h.calls[1].resolve(page([row(3)], false));
    await tick();
    assert.deepEqual(h.state().items, [row(3)]);
    assert.equal(h.state().loading, false);
    assert.equal(h.state().cursor, null);
  });

  await test('an old visit failure cannot erase current success or surface an obsolete offline notice', async () => {
    const h = harness();
    h.model.setActive(true);
    h.model.setActive(false);
    h.model.setActive(true);
    h.calls[1].resolve(page([row(2)], true));
    await tick();
    const current = h.state();
    h.calls[0].reject(Error('Stale offline failure'));
    await tick();
    assert.deepEqual(h.state(), current);
    assert.equal(h.state().error, null);
  });

  await test('first-load offline failure is retryable without pretending an empty inbox was loaded', async () => {
    const h = harness();
    h.model.setActive(true);
    h.calls[0].reject(Error('Network request failed'));
    await tick();
    assert.equal(h.state().loaded, false);
    assert.equal(h.state().loading, false);
    assert.match(h.state().error, /connection/i);
    const retry = h.model.refresh();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].before, null);
    assert.equal(h.state().error, null);
    h.calls[1].resolve(page([]));
    await retry;
    assert.equal(h.state().loaded, true);
    assert.equal(h.state().error, null);
    assert.equal(h.state().items.length, 0);
  });

  await test('offline pagination retains loaded rows and exact cursor, then retries the same boundary', async () => {
    const h = await loaded();
    const previous = h.state();
    const attempt = h.model.refresh(true);
    assert.deepEqual(h.calls[1].before, previous.cursor);
    h.calls[1].reject(Error('Network request failed'));
    await attempt;
    assert.deepEqual(h.state().items, previous.items);
    assert.deepEqual(h.state().cursor, previous.cursor);
    assert.equal(h.state().loaded, true);
    assert.match(h.state().error, /connection/i);
    const retry = h.model.refresh(true);
    assert.deepEqual(h.calls[2].before, previous.cursor);
    h.calls[2].resolve(page([row(3)]));
    await retry;
    assert.deepEqual(h.state().items, [row(1), row(2), row(3)]);
    assert.equal(h.state().cursor, null);
    assert.equal(h.state().error, null);
  });

  await test('offline first-page refresh preserves prior results until a confirmed fresh page replaces them', async () => {
    const h = await loaded();
    const previous = h.state();
    const failed = h.model.refresh();
    h.calls[1].reject(Error('Network request failed'));
    await failed;
    assert.deepEqual(h.state().items, previous.items);
    assert.deepEqual(h.state().cursor, previous.cursor);
    const retry = h.model.refresh();
    assert.equal(h.calls[2].before, null);
    h.calls[2].resolve(page([row(4)], true));
    await retry;
    assert.deepEqual(h.state().items, [row(4)]);
    assert.deepEqual(h.state().cursor, page([row(4)], true).nextCursor);
    assert.equal(h.state().error, null);
  });

  await test('repeated refresh and load-more taps never start overlapping work or request past the final page', async () => {
    const h = await loaded();
    const refresh = h.model.refresh();
    await h.model.refresh();
    await h.model.refresh(true);
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve(page([row(2)], true));
    await refresh;
    const older = h.model.refresh(true);
    await h.model.refresh(true);
    await h.model.refresh();
    assert.equal(h.calls.length, 3);
    h.calls[2].resolve(page([]));
    await older;
    await h.model.refresh(true);
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.state().items, [row(2)]);
    assert.equal(h.state().cursor, null);
  });

  await test('moving inbox rows deduplicate by conversation, update their preview, and keep the page cursor', async () => {
    const h = await loaded();
    const changed = row(2, { last_message_body: 'A newly received message', unread_count: 2 });
    const older = h.model.refresh(true);
    h.calls[1].resolve(page([changed, row(3)], true));
    await older;
    assert.deepEqual(h.state().items, [row(1), changed, row(3)]);
    assert.equal(new Set(h.state().items.map(item => item.id)).size, 3);
    assert.deepEqual(h.state().cursor, page([row(3)], true).nextCursor);
    const fresh = h.model.refresh();
    h.calls[2].resolve(page([changed, row(1)], true));
    await fresh;
    assert.deepEqual(h.state().items, [changed, row(1)]);
    assert.deepEqual(h.state().cursor, page([row(1)], true).nextCursor);
  });

  await test('a pagination response from a previous focus cannot append into the refreshed first page', async () => {
    const h = await loaded();
    const oldPage = h.model.refresh(true);
    h.model.setActive(false);
    h.model.setActive(true);
    assert.equal(h.calls[2].before, null);
    h.calls[2].resolve(page([row(4)]));
    await tick();
    const fresh = h.state();
    h.calls[1].resolve(page([row(3)], true));
    await oldPage;
    assert.deepEqual(h.state(), fresh);
    assert.deepEqual(h.state().items, [row(4)]);
  });

  await test('switching accounts uses independent stores and neither old rows nor old errors leak', async () => {
    const accountA = await loaded([row(1)], true);
    const pendingA = accountA.model.refresh();
    accountA.model.setActive(false);
    const accountB = harness();
    assert.deepEqual(accountB.state().items, []);
    assert.equal(accountB.state().loaded, false);
    assert.equal(accountB.state().cursor, null);
    accountB.model.setActive(true);
    accountB.calls[0].resolve(page([row(5)]));
    await tick();
    const freshB = accountB.state();
    accountA.calls[1].reject(Error('Old account response'));
    await pendingA;
    assert.deepEqual(accountB.state(), freshB);
    assert.deepEqual(accountB.state().items, [row(5)]);
    assert.deepEqual(accountA.state().items, [row(1)]);
  });

  await test('subscribers receive completed asynchronous state and stop receiving updates after cleanup', async () => {
    const h = harness();
    const notifications = [];
    const unsubscribe = h.model.subscribe(() => notifications.push(h.state()));
    h.model.setActive(true);
    h.calls[0].resolve(page([row(1)]));
    await tick();
    assert.ok(notifications.some(snapshot => snapshot.loading));
    assert.deepEqual(notifications.at(-1).items, [row(1)]);
    assert.equal(notifications.at(-1).loading, false);
    unsubscribe();
    const count = notifications.length;
    h.model.setActive(false);
    h.model.setActive(true);
    h.calls[1].resolve(page([]));
    await tick();
    assert.equal(notifications.length, count);
    assert.equal(h.state().items.length, 0);
  });

  await test('realtime invalidation ignores inactive screens and coalesces events during initial loading', async () => {
    const h = harness();
    h.model.invalidate();
    assert.equal(h.calls.length, 0);
    h.model.setActive(true);
    h.model.invalidate(); h.model.invalidate(); h.model.invalidate();
    assert.equal(h.calls.length, 1);
    h.calls[0].resolve(page([row(1)]));
    await tick();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].before, null);
    assert.equal(h.state().loading, true);
    h.calls[1].resolve(page([row(2), row(1)]));
    await tick(); await tick();
    assert.deepEqual(h.state().items, [row(2), row(1)]);
    assert.equal(h.calls.length, 2, 'Finishing catch-up must not enqueue itself');
    assert.equal(h.state().loading, false);
  });

  await test('idle realtime invalidation starts a fresh page and manual taps do not queue extra work', async () => {
    const h = await loaded();
    h.model.invalidate();
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].before, null);
    await h.model.refresh(); await h.model.refresh(true);
    h.calls[1].resolve(page([row(3)]));
    await tick();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.state().items, [row(3)]);
  });

  await test('an event during pagination refreshes ordering from the first page after append settles', async () => {
    const h = await loaded();
    const older = h.model.refresh(true);
    h.model.invalidate(); h.model.invalidate();
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve(page([row(2), row(3)], true));
    await older;
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[2].before, null);
    assert.deepEqual(h.state().items, [row(1), row(2), row(3)]);
    const changed = row(3, { unread_count: 2, last_message_body: 'Newest arrival', last_activity_at: '2026-09-26T13:00:00.000001+00:00' });
    h.calls[2].resolve(page([changed, row(1)], true));
    await tick();
    assert.deepEqual(h.state().items, [changed, row(1), row(2)]);
    assert.equal(new Set(h.state().items.map(item => item.id)).size, 3);
    assert.deepEqual(h.state().cursor, page([row(3)], true).nextCursor);
  });

  await test('queued realtime catch-up runs after failure once and retains data if it also fails', async () => {
    const h = await loaded();
    const before = h.state();
    const older = h.model.refresh(true);
    h.model.invalidate(); h.model.invalidate();
    h.calls[1].reject(Error('Offline while paging'));
    await older;
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[2].before, null);
    h.calls[2].reject(Error('Still offline'));
    await tick(); await tick();
    assert.equal(h.calls.length, 3, 'A failed catch-up must await another event or manual retry');
    assert.deepEqual(h.state().items, before.items);
    assert.deepEqual(h.state().cursor, before.cursor);
    assert.match(h.state().error, /connection/i);
    assert.equal(h.state().loading, false);
  });

  await test('blur clears queued events and stale responses cannot drain the new focus queue', async () => {
    const h = harness();
    h.model.setActive(true); h.model.invalidate();
    h.model.setActive(false); h.model.invalidate();
    h.calls[0].resolve(page([row(1)]));
    await tick();
    assert.equal(h.calls.length, 1);
    h.model.setActive(true);
    h.model.invalidate();
    h.model.setActive(false);
    h.model.setActive(true); h.model.invalidate();
    h.calls[1].reject(Error('Previous visit'));
    await tick();
    assert.equal(h.calls.length, 3);
    assert.equal(h.state().loading, true);
    h.calls[2].resolve(page([row(2)]));
    await tick();
    assert.equal(h.calls.length, 4);
    h.calls[3].resolve(page([row(3)]));
    await tick();
    assert.deepEqual(h.state().items, [row(3)]);
    assert.equal(h.calls.length, 4);
    assert.equal(h.state().error, null);
  });

  await test('automatic catch-up retains older loaded rows and cursor while manual refresh resets both', async () => {
    const h = await loaded([row(1), row(2)], true);
    const older = h.model.refresh(true);
    h.calls[1].resolve(page([row(3), row(4)], true)); await older;
    const cursor = h.state().cursor;
    const newest = row(5, { last_activity_at: '2026-09-26T13:00:00Z' });
    h.model.invalidate();
    h.calls[2].resolve(page([newest, row(1)], true)); await tick();
    assert.deepEqual(h.state().items, [newest, row(1), row(2), row(3), row(4)]);
    assert.deepEqual(h.state().cursor, cursor);
    const manual = h.model.refresh();
    h.calls[3].resolve(page([newest, row(1)], true)); await manual;
    assert.deepEqual(h.state().items, [newest, row(1)]);
    assert.deepEqual(h.state().cursor, page([row(1)], true).nextCursor);
  });

  await test('fresh-page omissions delete only cached rows within its authoritative activity range', async () => {
    const h = await loaded([row(1), row(2), row(3), row(4)], true);
    const cursor = h.state().cursor;
    h.model.invalidate();
    h.calls[1].resolve(page([row(2), row(3)], true)); await tick();
    assert.deepEqual(h.state().items, [row(2), row(3), row(4)], 'Absent newer row is dropped; unqueried older row remains');
    assert.deepEqual(h.state().cursor, cursor);
    h.model.invalidate();
    h.calls[2].resolve(page([row(2)], false)); await tick();
    assert.deepEqual(h.state().items, [row(2)], 'An exhausted fresh page is authoritative for the whole inbox');
    assert.equal(h.state().cursor, null);
    h.model.invalidate(); h.calls[3].resolve(page([])); await tick();
    assert.deepEqual(h.state().items, []);
  });

  await test('catch-up fills new activity beyond page one before retaining the older pagination boundary', async () => {
    const h = await loaded([row(3), row(4), row(5)], true);
    const cursor = h.state().cursor;
    h.model.invalidate();
    h.calls[1].resolve(page([row(1), row(2)], true)); await tick();
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.calls[2].before, page([row(2)], true).nextCursor);
    assert.deepEqual(h.state().items, [row(3), row(4), row(5)], 'Keep the prior snapshot until the gap is complete');
    h.calls[2].resolve(page([row(3), row(4)], true)); await tick();
    assert.deepEqual(h.state().items, [row(1), row(2), row(3), row(4), row(5)]);
    assert.deepEqual(h.state().cursor, cursor);
    assert.equal(h.calls.length, 3);
    const older = h.model.refresh(true);
    assert.deepEqual(h.calls[3].before, cursor);
    h.calls[3].resolve(page([row(6)])); await older;
    assert.deepEqual(h.state().items, [row(1), row(2), row(3), row(4), row(5), row(6)]);
  });

  await test('a failed catch-up gap retains the entire previous snapshot and retries from the top', async () => {
    const h = await loaded([row(3), row(4)], true);
    const previous = h.state();
    h.model.invalidate();
    h.calls[1].resolve(page([row(1), row(2)], true)); await tick();
    h.calls[2].reject(Error('Disconnected during catch-up')); await tick();
    assert.deepEqual(h.state().items, previous.items);
    assert.deepEqual(h.state().cursor, previous.cursor);
    assert.match(h.state().error, /connection/i);
    assert.equal(h.state().loading, false);
    h.model.invalidate(); assert.equal(h.calls[3].before, null);
    h.calls[3].resolve(page([row(1), row(2), row(3)], true)); await tick();
    assert.deepEqual(h.state().items, [row(1), row(2), row(3), row(4)]);
    assert.deepEqual(h.state().cursor, previous.cursor);
  });

  await test('overlapping catch-up pages retain one updated row per conversation', async () => {
    const h = await loaded([row(4), row(5)], true);
    const cursor = h.state().cursor;
    h.model.invalidate();
    h.calls[1].resolve(page([row(1), row(2)], true)); await tick();
    const changed = row(2, { unread_count: 3, last_message_body: 'Updated overlapping preview' });
    h.calls[2].resolve(page([changed, row(3), row(4)], true)); await tick();
    assert.deepEqual(h.state().items, [row(1), changed, row(3), row(4), row(5)]);
    assert.equal(new Set(h.state().items.map(item => item.id)).size, h.state().items.length);
    assert.deepEqual(h.state().cursor, cursor);
  });

  await test('catch-up preserves an exhausted loaded inbox and advances a partial cursor if it reaches farther', async () => {
    const complete = await loaded([row(2), row(3)], false);
    complete.model.invalidate();
    complete.calls[1].resolve(page([row(1), row(2)], true)); await tick();
    assert.deepEqual(complete.state().items, [row(1), row(2), row(3)]);
    assert.equal(complete.state().cursor, null);
    const partial = await loaded([row(1), row(2)], true);
    partial.model.invalidate();
    partial.calls[1].resolve(page([row(1), row(2), row(3)], true)); await tick();
    assert.deepEqual(partial.state().items, [row(1), row(2), row(3)]);
    assert.deepEqual(partial.state().cursor, page([row(3)], true).nextCursor);
  });

  await test('automatic range comparisons preserve microseconds, timezone offsets, and UUID tie ordering', async () => {
    const exact = (number, time) => row(number, { last_activity_at: time });
    const newer = exact(1, '2026-09-26T12:00:00.123457+00:00');
    const sameTimeHigherId = exact(3, '2026-09-26T05:00:00.123456-07:00');
    const boundary = exact(2, '2026-09-26T12:00:00.123456Z');
    const sameTimeLowerId = exact(1, '2026-09-26T12:00:00.123456+00:00');
    const oldest = exact(4, '2026-09-26T12:00:00.123455+00:00');
    const h = await loaded([sameTimeHigherId, boundary, sameTimeLowerId, oldest], true);
    h.model.invalidate();
    h.calls[1].resolve(page([newer, boundary], true)); await tick();
    assert.equal(h.calls.length, 2, 'Equal instants with different offsets must not create an extra gap page');
    // The UUID shared with newer must appear only at its new activity time.
    assert.deepEqual(h.state().items, [newer, boundary, oldest]);
    assert.deepEqual(h.state().cursor, page([oldest], true).nextCursor);
  });

  console.log(`Conversation inbox lifecycle: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
