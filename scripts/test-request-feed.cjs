/* global __dirname */
// Exercise the request client and the installed Supabase query builder without network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const now = Date.parse('2026-11-01T08:30:00Z');
class Clock extends Date { static now() { return now; } }
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const requestsCode = compile('requests.ts'), offersCode = compile('offers.ts');
const row = (id, more = {}) => ({ id, category: 'delivery', status: 'open', item_size: 'medium',
  owner_id: 'poster', owner_archived_at: null, deadline_at: '2026-11-02T16:30:00Z', ...more });
const ids = page => Array.from(page.items, item => item.id);

function client(responses, userIds = []) {
  const calls = [];
  const rest = createClient('https://fixture.invalid', 'fixture-only', {
    accessToken: async () => null,
    global: { fetch: async (url, init) => {
      calls.push({ url: new URL(url), body: init.body && JSON.parse(init.body), headers: new Headers(init.headers) });
      const reply = responses.shift();
      if (reply === undefined) throw Error('Unexpected request to ' + url);
      if (reply instanceof Response) return reply;
      return Response.json(reply);
    } },
  });
  const supabase = {
    from: rest.from.bind(rest), rpc: rest.rpc.bind(rest),
    auth: { getSession: async () => { const id = userIds.shift();
      return { data: { session: id ? { user: { id }, access_token: 'test-token-' + id } : null }, error: null }; } },
  };
  function load(code, modules) {
    const exports = {};
    vm.runInNewContext(code, { Date: Clock, exports, require: name => {
      assert.ok(Object.hasOwn(modules, name), name); return modules[name];
    } });
    return exports;
  }
  const offers = load(offersCode, { './supabase': { supabase } });
  return { calls, ...load(requestsCode, { './supabase': { supabase }, './offers': offers, './profiles': {}, './points': {} }) };
}

const categories = { ALL: null, DELIVERY: 'delivery', PICKUP: 'pickup', 'EVENT HELP': 'event_help', 'STUDY HELP': 'study_help' };
test('campus filters use their backend category and an empty page stops before loading details', async () => {
  for (const [filter, backend] of Object.entries(categories)) {
    const api = client([[]]);
    const page = await api.loadRequests(filter, null, 40);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url.pathname, '/rest/v1/rpc/get_request_feed');
    assert.deepEqual(api.calls[0].body, { p_category: backend, p_limit: 20, p_offset: 40 });
    assert.deepEqual(ids(page), []);
    assert.equal(page.hasMore, false); assert.equal(page.nextOffset, 40);
  }
});

test('owner history independently filters by account, category and archive state with stable pagination', async () => {
  for (const [filter, backend] of Object.entries(categories)) {
    for (const archived of [true, false]) {
      const count = archived ? 20 : 1;
      const api = client([Array.from({ length: count }, (_, i) => row('r' + i, { status: 'completed' }))]);
      const page = await api.loadRequests(filter, 'poster', 20, archived);
      assert.equal(api.calls.length, 1);
      const { pathname, searchParams } = api.calls[0].url;
      assert.equal(pathname, '/rest/v1/requests');
      assert.equal(searchParams.get('owner_id'), 'eq.poster');
      assert.equal(searchParams.get('owner_archived_at'), archived ? 'not.is.null' : 'is.null');
      assert.equal(searchParams.get('category'), backend && 'eq.' + backend);
      assert.equal(searchParams.get('order'), 'created_at.desc,id.desc');
      assert.equal(searchParams.get('offset'), '20'); assert.equal(searchParams.get('limit'), '20');
      assert.equal(page.items[0].status, 'completed');
      assert.equal(page.hasMore, count === 20); assert.equal(page.nextOffset, 20 + count);
    }
  }
});

test('the campus feed keeps server order and advances by every selected ID even when a row disappears', async () => {
  const all = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i }));
  const api = client([all, [row('r18'), row('r3')], [{ id: 'r20' }], [row('r20')]]);
  const first = await api.loadRequests('ALL', null, 0);
  assert.deepEqual(ids(first), ['r3', 'r18']);
  assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 20);
  assert.equal(api.calls[1].url.searchParams.get('id'), 'in.(' + all.map(item => item.id).join(',') + ')');
  const next = await api.loadRequests('ALL', null, first.nextOffset);
  assert.equal(api.calls[2].body.p_offset, 20);
  assert.deepEqual(ids(next), ['r20']); assert.equal(next.hasMore, false); assert.equal(next.nextOffset, 21);
});

test('rows which stop matching the public feed between selection and detail loading stay out of the results', async () => {
  const data = [row('closed', { status: 'accepted' }), row('cancelled', { status: 'cancelled' }),
    row('expired', { deadline_at: new Date(now).toISOString() }), row('changed', { category: 'pickup' }), row('valid')];
  const api = client([data.map(({ id }) => ({ id })), data]);
  const page = await api.loadRequests('DELIVERY', null, 0);
  assert.deepEqual(ids(page), ['valid']);
  assert.equal(page.nextOffset, 5);
});

test('owner history expires an open request at its exact deadline and displays the device-local deadline', async () => {
  const data = [row('before', { deadline_at: new Date(now - 1).toISOString() }),
    row('equal', { deadline_at: new Date(now).toISOString() }), row('after', { deadline_at: new Date(now + 1).toISOString() }),
    row('accepted', { status: 'accepted', deadline_at: '2026-10-31T03:30:00-07:00' })];
  const page = await client([data]).loadRequests('ALL', 'poster', 0);
  assert.deepEqual(Array.from(page.items, item => item.status), ['expired', 'expired', 'open', 'accepted']);
  const localTime = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric' });
  for (const item of page.items) assert.equal(item.timeLabel, localTime.format(new Date(item.deadlineAt)));
});

test('a failed public feed, detail read, or owner history rejects instead of reporting an empty page', async () => {
  const denied = () => Response.json({ code: '42501', message: 'Test denial' }, { status: 403 });
  for (const [replies, owner] of [[[denied()], null], [[[{ id: 'r1' }], denied()], null], [[denied()], 'poster']]) {
    await assert.rejects(client(replies).loadRequests('ALL', owner, 0), { code: '42501' });
  }
});

test('owner actions refuse a missing or changed account and pin authorized operations to the initiating session', async () => {
  for (const [method, args, rpc] of [['cancelRequest', [3, 'accepted'], 'cancel_my_request_for_round'],
    ['setRequestArchived', [true], 'set_my_request_archived']]) {
    for (const userId of [null, 'other']) {
      const api = client([], [userId]);
      await assert.rejects(api[method]('poster', 'r1', ...args), /account changed/i);
      assert.equal(api.calls.length, 0);
    }
    const api = client([null], ['poster', 'other']);
    await assert.rejects(api[method]('poster', 'r1', ...args), /account changed/i);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].url.pathname, '/rest/v1/rpc/' + rpc);
    assert.equal(api.calls[0].headers.get('Authorization'), 'Bearer test-token-poster');
  }
});

const feedFilename = path.resolve(__dirname, '../src/app/(tabs)/requests.tsx');
const feedCode = ts.transpileModule(fs.readFileSync(feedFilename, 'utf8'), {
  fileName: feedFilename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function feedNodes(node) {
  if (Array.isArray(node)) return node.flatMap(feedNodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...feedNodes(node.props.children)];
}

function feedText(node) {
  if (Array.isArray(node)) return node.map(feedText).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? feedText(node.props.children) : String(node);
}

function feedScreen() {
  const reads = [], snapshots = [], timers = new Set(), slots = [];
  let user = { id: 'poster' }, tree, cursor, dirty = true, effect, cleanup, nextEffect;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !deps.every((dep, i) => Object.is(dep, slots[index].deps[i]))) slots[index] = { callback, deps };
      return slots[index].callback;
    },
  };
  const modules = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    react,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'RefreshControl', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
      StyleSheet: { create: styles => styles },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useRouter: () => ({ push() {} }), useFocusEffect: callback => { nextEffect = callback; } },
    '../../context/AuthContext': { useAuth: () => ({ user }) },
    '../../components/ScreenHeader': 'ScreenHeader',
    '../../components/NotificationBell': 'NotificationBell',
    '../../lib/requests': {
      loadRequests: (...args) => new Promise((resolve, reject) => reads.push({ args, resolve, reject })),
      requestError: error => error.message,
    },
  };
  const exports = {};
  vm.runInNewContext(feedCode, {
    exports, require(name) { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; },
    setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback),
  });
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(++count < 50, 'Feed render should settle');
      dirty = false;
      cursor = 0;
      tree = exports.default();
      snapshots.push(feedText(tree));
      if (nextEffect !== effect) {
        cleanup?.();
        effect = nextEffect;
        cleanup = effect?.();
      }
    }
  }
  const button = label => feedNodes(tree).find(node => node.type === 'Pressable' &&
    (node.props.accessibilityLabel === label || feedText(node) === label));
  const titles = () => feedNodes(tree).filter(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('View '))
    .map(node => node.props.accessibilityLabel.slice(5));
  function press(label) {
    const control = button(label);
    assert.ok(control && !control.props.disabled, 'Expected enabled control ' + label);
    control.props.onPress();
    render();
  }
  function refresh() {
    feedNodes(tree).find(node => node.type === 'ScrollView' && node.props.refreshControl).props.refreshControl.props.onRefresh();
    render();
  }
  function tick() { for (const callback of timers) callback(); render(); }
  async function settle() { await new Promise(setImmediate); render(); }
  function switchUser(id) { user = id ? { id } : null; dirty = true; render(); }
  render();
  return { reads, snapshots, button, titles, press, refresh, tick, settle, switchUser, loaders: type => feedNodes(tree).filter(node => node.type === type), text: () => feedText(tree) };
}

const feedRow = id => ({ id, title: 'Request ' + id, description: 'A campus request', category: 'DELIVERY', points: 10 });
const feedPage = (ids, nextOffset = ids.length, hasMore = false) => ({ items: ids.map(feedRow), nextOffset, hasMore });

test('background feed refresh keeps visible requests while pending or offline and replaces them after success', async () => {
  const app = feedScreen();
  assert.doesNotMatch(app.text(), /No requests found/);
  assert.equal(app.loaders('LoadingSkeleton')[0]?.props.variant, 'requests');
  app.reads[0].resolve(feedPage(['r1', 'r2']));
  await app.settle();
  app.tick();
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2']);
  assert.equal(app.loaders('LoadingSkeleton').length, 0, 'Refresh preserves cards without placeholders');
  assert.equal(app.loaders('LoadingNotice').length, 0, 'Native pull-to-refresh avoids a jumping banner');
  app.tick();
  assert.equal(app.reads.length, 2, 'A timer cannot interrupt an in-flight refresh');
  app.reads[1].reject(new Error('Connection unavailable'));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2']);
  assert.match(app.text(), /Connection unavailable/);
  assert.equal(app.loaders('LoadingSkeleton').length, 0, 'Failure stays actionable');
  assert.doesNotMatch(app.text(), /No requests found/);
  app.press('Retry requests');
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2']);
  app.reads[2].resolve(feedPage(['r3']));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r3']);
  assert.doesNotMatch(app.text(), /Connection unavailable/);
});

test('loaded feed pages retain their append offset after errors and timers never collapse expanded history', async () => {
  const app = feedScreen();
  app.reads[0].resolve(feedPage(['r1', 'r2'], 20, true));
  await app.settle();
  const append = app.button('Load more').props.onPress;
  app.press('Load more');
  append();
  app.tick();
  assert.equal(app.reads.length, 2, 'Repeated append and timer calls share the in-flight guard');
  assert.equal(app.reads[1].args[2], 20);
  app.reads[1].reject(new Error('Offline append'));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2']);
  app.press('Load more');
  assert.equal(app.reads[2].args[2], 20);
  app.reads[2].resolve(feedPage(['r2', 'r3'], 40, true));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2', 'Request r3'], 'Overlapping pages display each request once');
  app.tick();
  assert.equal(app.reads.length, 3, 'Older loaded pages wait for an explicit refresh');
  app.refresh();
  assert.equal(app.reads[3].args[2], 0);
  app.reads[3].reject(new Error('Offline refresh'));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r1', 'Request r2', 'Request r3']);
  app.press('Load more');
  assert.equal(app.reads[4].args[2], 40, 'A failed refresh must keep the expanded-page offset');
  app.reads[4].resolve(feedPage(['r4'], 41));
  await app.settle();
  app.refresh();
  app.reads[5].resolve(feedPage(['r5'], 20, true));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request r5']);
  app.press('Load more');
  assert.equal(app.reads[6].args[2], 20, 'A successful explicit refresh restarts pagination');
});

test('changing feed scope immediately hides previous rows and ignores older refreshes across filters and accounts', async () => {
  const app = feedScreen();
  app.reads[0].resolve(feedPage(['campus'], 20, true));
  await app.settle();
  app.tick();
  const beforeFilter = app.snapshots.length;
  app.press('PICKUP');
  assert.ok(app.snapshots.slice(beforeFilter).every(text => !text.includes('Request campus')));
  assert.deepEqual(app.reads[2].args, ['PICKUP', null, 0, false]);
  app.reads[1].resolve(feedPage(['stale-campus']));
  await app.settle();
  assert.deepEqual(app.titles(), []);
  app.reads[2].reject(new Error('Pickup offline'));
  await app.settle();
  assert.deepEqual(app.titles(), []);
  assert.match(app.text(), /Pickup offline/);
  assert.doesNotMatch(app.text(), /No requests found/);
  app.press('My requests');
  assert.deepEqual(app.reads[3].args, ['PICKUP', 'poster', 0, false]);
  app.reads[3].resolve(feedPage(['mine']));
  await app.settle();
  app.press('Archived');
  assert.deepEqual(app.titles(), []);
  assert.deepEqual(app.reads[4].args, ['PICKUP', 'poster', 0, true]);
  app.reads[4].resolve(feedPage(['archived']));
  await app.settle();
  app.tick();
  const beforeSwitch = app.snapshots.length;
  app.switchUser('helper');
  assert.ok(app.snapshots.slice(beforeSwitch).every(text => !text.includes('Request archived')));
  assert.deepEqual(app.reads[6].args, ['PICKUP', 'helper', 0, true]);
  app.reads[5].reject(new Error('Stale account error'));
  await app.settle();
  assert.doesNotMatch(app.text(), /Stale account error/);
  app.reads[6].resolve(feedPage(['helper']));
  await app.settle();
  assert.deepEqual(app.titles(), ['Request helper']);
  app.switchUser(null);
  assert.deepEqual(app.titles(), []);
});
