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
vm.runInNewContext(compiled, { exports: production }, { filename: 'conversationInbox.ts' });
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

  console.log(`Conversation inbox lifecycle: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
