/* global __dirname */
// Exercise the production notification screen's navigation and lifecycle boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const ID = '20000000-0000-4000-8000-000000000001';
const REQUEST = '30000000-0000-4000-8000-000000000001';
const item = { id: ID, title: 'New help offer', body: 'Someone offered to help.', navigation_key: 'request_details',
  request_id: REQUEST, conversation_id: null, read_at: null, created_at: '2026-10-22T12:00:00Z' };
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
const textOf = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
function nodes(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) { node.forEach(value => nodes(value, output)); return output; }
  output.push(node); nodes(node.props?.children, output); return output;
}
function production(file, modules) {
  modules = { '@/components/LoadingState': require('./loading-test-mock.cjs'), ...modules };
  modules = { '@/components/motion': require('./motion-test-mock.cjs'), ...modules };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name);
    return modules[name];
  } }, { filename: file });
  return exports;
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 10; ++i) await Promise.resolve(); };

function harness(options = {}) {
  let userId = options.userId === undefined ? A : options.userId;
  let changed, background, cleanupFocus;
  const focus = [], effects = [], calls = [], pushes = [];
  const state = { items: [item], unreadCount: 1, loaded: true, loading: false, refreshing: false,
    loadingMore: false, hasMore: false, error: null, mutatingIds: [], markingAllRead: false, ...options.state };
  const model = { getSnapshot: () => state, subscribe: () => () => {}, setActive: value => calls.push(['active', value]),
    refresh: async () => { calls.push(['refresh']); }, invalidate: async () => { calls.push(['invalidate']); },
    loadMore: async () => { calls.push(['more']); },
    markRead: async id => { calls.push(['read', id]); return options.read ? options.read.promise : options.confirmed !== false; },
    markAllRead: async () => { calls.push(['all']); return true; } };
  const react = { Fragment: 'Fragment', createElement, useMemo: callback => callback(), useCallback: callback => callback,
    useRef: current => ({ current }), useState: initial => [initial, value => calls.push(['state', value])],
    useEffect: callback => effects.push(callback), useSyncExternalStore: (_sub, snapshot) => snapshot() };
  const modules = { react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useRouter: () => ({ push: route => pushes.push(route), canGoBack: () => true, back() {}, replace() {} }),
      useFocusEffect: callback => focus.push(callback) },
    'react-native': { ActivityIndicator: 'ActivityIndicator', AppState: { currentState: 'active', addEventListener: (_name, cb) => { background = cb; return { remove() {} }; } },
      FlatList: 'FlatList', Pressable: 'Pressable', RefreshControl: 'RefreshControl', StyleSheet: { create: value => value }, Text: 'Text', View: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    '../components/ScreenHeader': { __esModule: true, default: 'ScreenHeader' },
    '../context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '../context/NotificationsContext': { useNotifications: () => ({ refreshUnread: async () => { calls.push(['badge']); },
      subscribeNotifications: listener => { changed = listener; return () => {}; } }) },
    '../lib/notificationInbox': { createNotificationInbox: id => { calls.push(['model', id]); return model; } },
    '../lib/notifications': { getNotificationTarget: row => row.navigation_key === 'account_notice' ? { pathname: '/profile/appeals' } : row.request_id ? { pathname: '/requests/[id]', params: { id: row.request_id } }
      : row.conversation_id ? { pathname: '/messages/[id]', params: { id: row.conversation_id } } : null },
  };
  const component = production('src/app/notifications.tsx', modules).default;
  const outer = component();
  const tree = outer ? outer.type(outer.props) : null;
  effects.forEach(callback => callback());
  focus.forEach(callback => { cleanupFocus = callback(); });
  const list = nodes(tree).find(node => node.type === 'FlatList');
  return { state, calls, pushes, tree, list, outer, account: id => { userId = id; return component(); },
    row: (value = item) => list.props.renderItem({ item: value }), blur: () => cleanupFocus?.(),
    background: () => background?.('background'), changed: () => changed?.(null) };
}

let checks = 0;
async function test(label, run) { await run(); ++checks; console.log('PASS ' + label); }
(async () => {
  await test('initial notification loading uses placeholders, refresh keeps rows, and errors replace placeholders', () => {
    const first = harness({ state: { items: [], loaded: false, loading: true } });
    const skeleton = nodes(first.list.props.ListHeaderComponent).find(node => node.type === 'LoadingSkeleton');
    assert.equal(skeleton?.props.label, 'Loading notifications');
    assert.equal(first.list.props.ListEmptyComponent, null);
    const refreshing = harness({ state: { refreshing: true } });
    assert.equal(refreshing.list.props.data.length, 1);
    assert.equal(nodes(refreshing.list.props.ListHeaderComponent).some(node => node.type === 'LoadingSkeleton'), false);
    const failed = harness({ state: { items: [], loaded: false, loading: true, error: 'Offline. Retry.' } });
    assert.match(textOf(failed.list.props.ListHeaderComponent), /Offline/);
    assert.equal(nodes(failed.list.props.ListHeaderComponent).some(node => node.type === 'LoadingSkeleton'), false);
  });
  await test('screen is keyed by authenticated account and hides when signed out', () => {
    const h = harness(); assert.equal(h.outer.props.key, A); assert.equal(h.account(B).props.key, B); assert.equal(h.account(null), null);
  });
  await test('focus activates loading and private events invalidate the loaded inbox', () => {
    const h = harness(); assert.ok(h.calls.some(call => call[0] === 'active' && call[1])); h.changed(); assert.ok(h.calls.some(call => call[0] === 'invalidate'));
    h.blur(); assert.deepEqual(h.calls.at(-1), ['active', false]);
  });
  await test('request notification opens the exact request only after confirmed read', async () => {
    const read = deferred(); const h = harness({ read }); h.row().props.onPress(); await flush(); assert.equal(h.pushes.length, 0);
    read.resolve(true); await flush(); assert.equal(h.pushes[0].params.id, REQUEST); assert.equal(h.pushes[0].pathname, '/requests/[id]');
  });
  await test('message notification opens the exact conversation', async () => {
    const h = harness(); h.row({ ...item, request_id: null, conversation_id: REQUEST, navigation_key: 'conversation' }).props.onPress();
    await flush(); assert.equal(h.pushes[0].pathname, '/messages/[id]'); assert.equal(h.pushes[0].params.id, REQUEST);
  });
  await test('failed read stays on notification screen for retry', async () => {
    const h = harness({ confirmed: false }); h.row().props.onPress(); await flush(); assert.equal(h.pushes.length, 0);
  });
  await test('rapid double tap cannot duplicate mutation or navigation', async () => {
    const read = deferred(); const h = harness({ read }); const row = h.row(); row.props.onPress(); row.props.onPress();
    await flush(); assert.equal(h.calls.filter(call => call[0] === 'read').length, 1); read.resolve(true); await flush(); assert.equal(h.pushes.length, 1);
  });
  for (const lifecycle of ['blur', 'background']) {
    await test(`late read after ${lifecycle} cannot navigate`, async () => {
      const read = deferred(); const h = harness({ read }); h.row().props.onPress(); h[lifecycle](); read.resolve(true); await flush(); assert.equal(h.pushes.length, 0);
    });
  }
  await test('missing destination can be acknowledged without fabricated navigation', async () => {
    const h = harness(); h.row({ ...item, request_id: null }).props.onPress(); await flush();
    assert.equal(h.calls.filter(call => call[0] === 'read').length, 1); assert.equal(h.pushes.length, 0);
    assert.match(textOf(h.row({ ...item, request_id: null })), /No longer available/);
  });
  await test('mark all read uses the scoped operation and refreshes the bell', async () => {
    const h = harness(); const button = nodes(h.list.props.ListHeaderComponent).find(node => node.props.accessibilityLabel === 'Mark all notifications read');
    button.props.onPress(); await flush(); assert.equal(h.calls.filter(call => call[0] === 'all').length, 1); assert.ok(h.calls.filter(call => call[0] === 'badge').length >= 2);
  });
  await test('warning shows its complete explanation and opens current account decisions after marking read', async () => {
    const h = harness(); const warning = { ...item, title: 'Formal warning', body: 'Long reason ' + 'x'.repeat(2000),
      event_type: 'account_warning', navigation_key: 'account_notice', request_id: null };
    const view = h.row(warning);
    assert.ok(textOf(view).includes(warning.body)); assert.match(textOf(view), /View decision & warning count/);
    assert.doesNotMatch(textOf(view), /No longer available/);
    view.props.onPress(); await flush();
    assert.equal(h.calls.filter(call => call[0] === 'read').length, 1); assert.equal(h.pushes[0].pathname, '/profile/appeals');
    assert.ok(!h.calls.some(call => call[0] === 'state' && typeof call[1] === 'string' && call[1].includes('no longer available')));
    assert.match(textOf(h.row({ ...warning, read_at: item.created_at })), /View decision & warning count/);
  });
  await test('offline failure retains rows, exposes Retry and never shows empty success', () => {
    const h = harness({ state: { error: 'Check your connection.' } }); assert.equal(h.list.props.data.length, 1);
    assert.match(textOf(h.list.props.ListHeaderComponent), /Check your connection/); assert.match(textOf(h.list.props.ListHeaderComponent), /Retry/);
    assert.equal(h.list.props.ListEmptyComponent, null);
  });
  await test('history footer loads older notifications with a bounded action', async () => {
    const h = harness({ state: { hasMore: true } }); h.list.props.ListFooterComponent.props.onPress(); await flush(); assert.ok(h.calls.some(call => call[0] === 'more'));
  });
  await test('empty inbox has no mock people or rewards', () => {
    const h = harness({ state: { items: [], unreadCount: 0 } }); assert.match(textOf(h.list.props.ListEmptyComponent), /caught up/);
    assert.equal(h.list.props.data.length, 0);
  });
  for (const count of [0, 4, 120]) {
    await test(`bell shows correct accessible count ${count} and routes to inbox`, () => {
      const routes = [];
      const bell = production('src/components/NotificationBell.tsx', {
        react: { createElement }, '@expo/vector-icons': { Ionicons: 'Ionicons' },
        'expo-router': { useRouter: () => ({ push: route => routes.push(route) }) },
        'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
        '../context/NotificationsContext': { useNotifications: () => ({ unreadCount: count }) },
      }).default();
      assert.equal(bell.props.accessibilityLabel, `Notifications, ${count} unread`);
      assert.equal(textOf(bell), count === 0 ? '' : count > 99 ? '99+' : String(count));
      bell.props.onPress(); assert.equal(routes[0], '/notifications');
    });
  }
  console.log(`Notifications UI: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
