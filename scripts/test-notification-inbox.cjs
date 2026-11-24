/* global __dirname */
// Exercise the production inbox through deferred reads/writes, not implementation-shaped assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/notificationInbox.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const NOW = '2026-10-22T13:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
class MillisecondDate extends Date {
  static parse(value) {
    assert.ok(!/\.\d{4,}/.test(value), 'Android Date parsing must not require sub-millisecond precision');
    return Date.parse(value);
  }
}
const production = {};
vm.runInNewContext(compiled, { exports: production, Date: MillisecondDate, require: name => {
  assert.equal(name, './notifications');
  return { notificationError: () => 'Unable to update notifications. Check your connection and retry.' };
} });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function row(number, overrides = {}) {
  return { id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`, recipient_id: A,
    actor_id: B, event_type: 'offer_created', title: 'New offer', body: 'Someone offered to help.',
    request_id: '20000000-0000-4000-8000-000000000001', offer_id: null, conversation_id: null, message_id: null,
    navigation_key: 'request_details', read_at: null,
    created_at: `2026-10-22T12:${String(59 - number).padStart(2, '0')}:00.123456+00:00`, ...overrides };
}
function page(items, hasMore = false) {
  const last = items.at(-1);
  return { items, hasMore, nextCursor: hasMore ? { id: last.id, createdAt: last.created_at } : null };
}
function harness(userId = A) {
  const pages = [], counts = [], marks = [], all = [], changed = [];
  const model = production.createNotificationInbox(userId, {
    loadPage: (id, options) => { const task = deferred(); pages.push({ id, before: plain(options.before), ...task }); return task.promise; },
    loadUnreadCount: id => { const task = deferred(); counts.push({ id, ...task }); return task.promise; },
    markRead: (id, notificationId) => { const task = deferred(); marks.push({ id, notificationId, ...task }); return task.promise; },
    markAllRead: id => { const task = deferred(); all.push({ id, ...task }); return task.promise; },
    now: () => NOW, onChanged: () => changed.push(userId),
  });
  return { model, pages, counts, marks, all, changed, state: () => plain(model.getSnapshot()),
    settle(index, items, hasMore = false, count = items.filter(item => !item.read_at).length) {
      pages[index].resolve(page(items, hasMore));
      // Catch-up gap pages share a single count query; caller handles those explicitly.
      counts[index]?.resolve(count);
    } };
}
async function loaded(items = [row(1), row(2)], hasMore = true, count = items.length) {
  const h = harness(); h.model.setActive(true); h.settle(0, items, hasMore, count); await tick(); return h;
}
let checks = 0;
async function test(name, action) { await action(); checks++; console.log('PASS ' + name); }

(async () => {
  await test('inactive models do not read or mutate; activation loads one exact page and global count', async () => {
    const h = harness();
    await h.model.refresh(); await h.model.invalidate(); await h.model.loadMore();
    assert.equal(await h.model.markRead(row(1).id), false); assert.equal(await h.model.markAllRead(), false);
    assert.equal(h.pages.length, 0); assert.equal(h.marks.length, 0); assert.equal(h.all.length, 0);
    h.model.setActive(true); h.model.setActive(true);
    assert.equal(h.pages.length, 1); assert.equal(h.state().loading, true);
    h.settle(0, [row(1), row(2)], true, 20); await tick();
    assert.deepEqual(h.state().items, [row(1), row(2)]);
    assert.equal(h.state().unreadCount, 20); assert.equal(h.state().loaded, true);
    assert.equal(h.state().loading, false); assert.equal(h.state().hasMore, true);
  });
  await test('failed initial load stays retryable and does not pretend an empty inbox was loaded', async () => {
    const h = harness(); h.model.setActive(true);
    h.pages[0].reject(Error('offline')); h.counts[0].reject(Error('offline')); await tick();
    assert.equal(h.state().loaded, false); assert.equal(h.state().loading, false);
    assert.match(h.state().error, /connection/);
    const retry = h.model.refresh(); h.settle(1, [], false, 0); await retry;
    assert.equal(h.state().loaded, true); assert.deepEqual(h.state().items, []); assert.equal(h.state().error, null);
  });
  await test('failed refresh preserves visible rows, count and cursor until a confirmed replacement arrives', async () => {
    const h = await loaded(undefined, true, 30); const before = h.state();
    const refresh = h.model.refresh(); h.pages[1].reject(Error('offline')); h.counts[1].resolve(99); await refresh;
    assert.deepEqual(h.state().items, before.items); assert.equal(h.state().unreadCount, 30);
    assert.deepEqual(h.state().cursor, before.cursor); assert.match(h.state().error, /connection/);
    const retry = h.model.refresh(); h.settle(2, [row(3)], false, 4); await retry;
    assert.deepEqual(h.state().items, [row(3)]); assert.equal(h.state().unreadCount, 4); assert.equal(h.state().error, null);
  });
  await test('a failed unread count does not publish a partially confirmed page', async () => {
    const h = await loaded(); const before = h.state();
    const attempt = h.model.refresh(); h.pages[1].resolve(page([row(3)])); h.counts[1].reject(Error('count failed')); await attempt;
    assert.deepEqual(h.state().items, before.items); assert.equal(h.state().unreadCount, before.unreadCount);
  });
  await test('pagination appends exact unique rows, retains boundary on failure and stops at exhaustion', async () => {
    const h = await loaded(); const cursor = h.state().cursor;
    const failed = h.model.loadMore(); assert.deepEqual(h.pages[1].before, cursor);
    h.pages[1].reject(Error('offline')); h.counts[1].resolve(2); await failed;
    assert.deepEqual(h.state().cursor, cursor);
    const retry = h.model.loadMore(); assert.deepEqual(h.pages[2].before, cursor);
    h.settle(2, [row(2, { read_at: NOW }), row(3)], false, 2); await retry;
    assert.deepEqual(h.state().items, [row(1), row(2, { read_at: NOW }), row(3)]);
    assert.equal(h.state().hasMore, false); assert.equal(h.state().cursor, null);
    await h.model.loadMore(); assert.equal(h.pages.length, 3);
  });
  await test('repeated invalidations coalesce while stale read responses and stale read errors stay hidden', async () => {
    for (const failed of [false, true]) {
      const h = harness(); h.model.setActive(true);
      await h.model.invalidate(); await h.model.invalidate(); await h.model.invalidate();
      assert.equal(h.pages.length, 1);
      if (failed) h.pages[0].reject(Error('stale error'));
      else h.pages[0].resolve(page([row(1)]));
      h.counts[0].resolve(1); await tick();
      assert.equal(h.pages.length, 2); assert.deepEqual(h.state().items, []); assert.equal(h.state().error, null);
      h.settle(1, [row(2)], false, 3); await tick();
      assert.deepEqual(h.state().items, [row(2)]); assert.equal(h.state().unreadCount, 3);
      assert.equal(h.pages.length, 2);
    }
  });
  await test('deactivation and account disposal suppress old success, failure and count leakage', async () => {
    const a = await loaded(); const old = a.model.refresh(); a.model.dispose();
    const b = harness(B); b.model.setActive(true); b.settle(0, [row(5, { recipient_id: B })], false, 1); await tick();
    const expected = b.state();
    a.pages[1].reject(Error('account A private error')); a.counts[1].resolve(100); await old;
    assert.deepEqual(a.state().items, []); assert.deepEqual(b.state(), expected);
    a.model.setActive(true); await a.model.refresh(); assert.equal(a.pages.length, 2);
  });
  await test('refocus starts fresh work; prior visit cannot replace current rows or stop its spinner', async () => {
    const h = harness(); h.model.setActive(true); h.model.setActive(false); h.model.setActive(true);
    h.settle(0, [row(1)], true, 10); await tick();
    assert.equal(h.state().loading, true); assert.deepEqual(h.state().items, []);
    h.settle(1, [row(2)], false, 1); await tick(); assert.deepEqual(h.state().items, [row(2)]);
  });
  await test('read action never marks rows/count before success, then rechecks server count and signals global badge', async () => {
    const h = await loaded();
    const read = h.model.markRead(row(1).id);
    assert.equal(h.state().items[0].read_at, null); assert.equal(h.state().unreadCount, 2);
    assert.deepEqual(h.state().mutatingIds, [row(1).id]);
    assert.equal(await h.model.markRead(row(1).id), false); assert.equal(h.marks.length, 1);
    h.marks[0].resolve(row(1).id); assert.equal(await read, true);
    assert.equal(h.state().items[0].read_at, NOW); assert.equal(h.state().unreadCount, 1);
    assert.deepEqual(h.changed, [A]); assert.equal(h.pages.length, 2);
    h.settle(1, [row(1, { read_at: NOW }), row(2)], false, 1); await tick();
    assert.deepEqual(h.state().mutatingIds, []); assert.equal(h.state().error, null);
    assert.equal(await h.model.markRead(row(1).id), true); assert.equal(h.marks.length, 1);
  });
  await test('failed read retains unread state and actionable error even when subsequent inbox read succeeds', async () => {
    const h = await loaded(); const read = h.model.markRead(row(1).id);
    h.marks[0].reject(Error('write forbidden')); assert.equal(await read, false);
    assert.equal(h.state().items[0].read_at, null); assert.equal(h.state().unreadCount, 2);
    assert.match(h.state().error, /connection/);
    h.settle(1, [row(1), row(2)], false, 2); await tick();
    assert.match(h.state().error, /connection/); assert.equal(h.state().items[0].read_at, null);
    assert.deepEqual(h.changed, []);
    const retry = h.model.markRead(row(1).id); h.marks[1].resolve(row(1).id); assert.equal(await retry, true);
    h.settle(2, [row(1, { read_at: NOW }), row(2)], false, 1); await tick();
    assert.equal(h.state().error, null);
  });
  await test('lost read response reconciles only when the authorized fetch confirms that exact notice is read', async () => {
    const h = await loaded(); const read = h.model.markRead(row(1).id);
    h.marks[0].reject(Error('lost reply after commit')); assert.equal(await read, false);
    h.settle(1, [row(1, { read_at: NOW }), row(2)], false, 1); await tick();
    assert.equal(h.state().error, null); assert.equal(h.state().items[0].read_at, NOW);
    assert.equal(h.state().unreadCount, 1);
  });
  await test('a refresh started before a read cannot restore stale unread rows or count after that read succeeds', async () => {
    const h = await loaded(); const refresh = h.model.refresh(); const read = h.model.markRead(row(1).id);
    h.marks[0].resolve(row(1).id); assert.equal(await read, true);
    h.settle(1, [row(1), row(2)], false, 2); await refresh;
    assert.equal(h.state().items[0].read_at, NOW); assert.equal(h.state().unreadCount, 1);
    assert.equal(h.pages.length, 3);
    h.settle(2, [row(1, { read_at: NOW }), row(2)], false, 1); await tick();
    assert.equal(h.state().items[0].read_at, NOW); assert.equal(h.state().unreadCount, 1);
  });
  await test('a refresh resolving during a pending mutation is withheld and a failed mutation remains truthful', async () => {
    const h = await loaded(); const refresh = h.model.refresh(); const read = h.model.markRead(row(1).id);
    h.settle(1, [row(3)], false, 99); await refresh;
    assert.deepEqual(h.state().items, [row(1), row(2)]); assert.equal(h.state().unreadCount, 2);
    assert.equal(h.pages.length, 2, 'Do not reload until the pending write settles');
    h.marks[0].reject(Error('offline')); assert.equal(await read, false);
    assert.equal(h.pages.length, 3); assert.equal(h.state().items[0].read_at, null);
    h.settle(2, [row(1), row(2)], false, 2); await tick(); assert.match(h.state().error, /connection/);
  });
  await test('refresh requested during a mutation queues once and retains the manual reset intent', async () => {
    const h = await loaded(); const read = h.model.markRead(row(1).id);
    await h.model.refresh(); await h.model.invalidate(); await h.model.refresh();
    assert.equal(h.pages.length, 1);
    h.marks[0].resolve(row(1).id); await read;
    assert.equal(h.pages.length, 2);
    h.settle(1, [row(1, { read_at: NOW })], true, 1); await tick();
    assert.deepEqual(h.state().items, [row(1, { read_at: NOW })]);
    assert.equal(h.pages.length, 2);
  });
  await test('mark all waits for confirmed write, refreshes whole-inbox count and does not erase later arrivals', async () => {
    const h = await loaded(undefined, true, 12); const all = h.model.markAllRead();
    assert.equal(h.state().markingAllRead, true); assert.equal(h.state().unreadCount, 12);
    assert.equal(await h.model.markRead(row(1).id), false); assert.equal(await h.model.markAllRead(), false);
    h.all[0].resolve(12); assert.equal(await all, true);
    assert.equal(h.state().unreadCount, 0); assert.ok(h.state().items.every(item => item.read_at === NOW));
    const arrival = row(5, { created_at: '2026-10-22T13:01:00Z' });
    h.settle(1, [arrival, row(1, { read_at: NOW }), row(2, { read_at: NOW })], false, 1); await tick();
    assert.equal(h.state().unreadCount, 1); assert.equal(h.state().items[0].read_at, null);
    assert.deepEqual(h.changed, [A]);
  });
  await test('failed mark-all remains actionable after a readable refresh and can reconcile a committed lost response', async () => {
    const h = await loaded(); const failed = h.model.markAllRead();
    h.all[0].reject(Error('write refused')); assert.equal(await failed, false);
    h.settle(1, [row(1), row(2)], false, 2); await tick();
    assert.match(h.state().error, /connection/); assert.ok(h.state().items.every(item => item.read_at === null));
    const retry = h.model.markAllRead(); h.all[1].reject(Error('lost reply after commit')); assert.equal(await retry, false);
    h.settle(2, [row(1, { read_at: NOW }), row(2, { read_at: NOW })], false, 0); await tick();
    assert.equal(h.state().error, null); assert.equal(h.state().unreadCount, 0);
  });
  await test('cross-account stale writes cannot publish read marks, badge signals, errors or clear new busy state', async () => {
    for (const failed of [false, true]) {
      const h = await loaded(); const read = h.model.markRead(row(1).id);
      h.model.setActive(false); h.model.setActive(true); h.settle(1, [row(1), row(2)], false, 2); await tick();
      const second = h.model.markRead(row(2).id);
      if (failed) h.marks[0].reject(Error('old private account error')); else h.marks[0].resolve(row(1).id);
      assert.equal(await read, false); assert.deepEqual(h.state().mutatingIds, [row(2).id]);
      assert.equal(h.state().items[0].read_at, null); assert.equal(h.state().error, null); assert.deepEqual(h.changed, []);
      h.marks[1].resolve(row(2).id); assert.equal(await second, true);
      h.model.dispose();
    }
  });
  await test('automatic refresh preserves older loaded history, refreshes read status and manual refresh resets it', async () => {
    const h = await loaded([row(1), row(2)], true);
    const older = h.model.loadMore(); h.settle(1, [row(3), row(4)], true, 4); await older;
    const priorCursor = h.state().cursor;
    const fresh = h.model.invalidate();
    h.settle(2, [row(1, { read_at: NOW }), row(2)], true, 3); await tick();
    assert.equal(h.pages.length, 4);
    h.pages[3].resolve(page([row(3), row(4)], true)); await fresh;
    assert.deepEqual(h.state().items, [row(1, { read_at: NOW }), row(2), row(3), row(4)]);
    assert.deepEqual(h.state().cursor, priorCursor);
    const reset = h.model.refresh(); h.pages[4].resolve(page([row(1, { read_at: NOW }), row(2)], true)); h.counts[3].resolve(3); await reset;
    assert.deepEqual(h.state().items, [row(1, { read_at: NOW }), row(2)]);
  });
  await test('a failed catch-up page retains the entire old contiguous history and pagination cursor', async () => {
    const h = await loaded([row(3), row(4)], true); const before = h.state();
    const refresh = h.model.invalidate(); h.settle(1, [row(1), row(2)], true, 4); await tick();
    h.pages[2].reject(Error('offline mid catchup')); await refresh;
    assert.deepEqual(h.state().items, before.items); assert.deepEqual(h.state().cursor, before.cursor);
    assert.equal(h.state().unreadCount, before.unreadCount); assert.match(h.state().error, /connection/);
  });
  await test('large bursts cap catch-up at five pages and keep a contiguous cursor rather than skip a gap', async () => {
    const h = await loaded([row(20), row(21)], true); const refresh = h.model.invalidate();
    h.settle(1, [row(1)], true, 21); await tick();
    for (let n = 2; n <= 5; n++) { h.pages[n].resolve(page([row(n)], true)); await tick(); }
    await refresh;
    assert.equal(h.pages.length, 6); assert.deepEqual(h.state().items, [1, 2, 3, 4, 5].map(n => row(n)));
    assert.deepEqual(h.state().cursor, page([row(5)], true).nextCursor);
    const more = h.model.loadMore();
    assert.deepEqual(h.pages[6].before, h.state().cursor);
    h.pages[6].resolve(page([row(6)], true)); h.counts[2].resolve(21); await more;
    assert.equal(h.state().items.at(-1).id, row(6).id);
  });
  await test('refresh removes missing rows only in the confirmed range and exhausted pages remove stale history', async () => {
    const h = await loaded([row(1), row(2), row(3)], true);
    const refresh = h.model.invalidate(); h.settle(1, [row(2), row(3)], true, 2); await refresh;
    assert.deepEqual(h.state().items, [row(2), row(3)]);
    const empty = h.model.invalidate(); h.settle(2, [], false, 0); await empty;
    assert.deepEqual(h.state().items, []); assert.equal(h.state().hasMore, false);
  });
  await test('sorting preserves timestamp microseconds, timezone instants and descending UUID ties', async () => {
    const high = row(3, { created_at: '2026-10-22T05:00:00.123456-07:00' });
    const low = row(2, { created_at: '2026-10-22T12:00:00.123456Z' });
    const older = row(1, { created_at: '2026-10-22T12:00:00.123455+00:00' });
    const h = await loaded([low, older], true);
    const refresh = h.model.invalidate(); h.settle(1, [high, low, older], false, 3); await refresh;
    assert.deepEqual(h.state().items, [high, low, older]);
  });
  await test('subscribers receive asynchronous results and cleanup stops notifications', async () => {
    const h = harness(); const snapshots = [];
    const unsubscribe = h.model.subscribe(() => snapshots.push(h.state()));
    h.model.setActive(true); h.settle(0, [row(1)], false, 1); await tick();
    assert.ok(snapshots.some(snapshot => snapshot.loading)); assert.equal(snapshots.at(-1).loading, false);
    assert.deepEqual(snapshots.at(-1).items, [row(1)]); unsubscribe(); const amount = snapshots.length;
    h.model.dispose(); assert.equal(snapshots.length, amount);
  });
  console.log(`Notification inbox lifecycle: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
