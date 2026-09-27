/* global __dirname */
// Run production count state and UI wiring without a device or a network connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const CHAT = 'c0000000-0000-4000-8000-000000000003';
const tick = () => new Promise(setImmediate);
function production(file, modules = {}, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...globals, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name); return modules[name];
  } }, { filename: file });
  return exports;
}
const { createUnreadMessages } = production('src/lib/unreadMessages.ts');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const calls = [], updates = [];
  const model = createUnreadMessages(() => { const pending = deferred(); calls.push(pending); return pending.promise; });
  model.subscribe(() => updates.push(model.getSnapshot()));
  return { model, calls, updates };
}
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
const createElement = (type, properties, ...children) => ({ type, props: { ...properties, children } });
function nodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(item => nodes(item, result)); return result; }
  result.push(node); nodes(node.props.children, result); return result;
}

function providerHarness(initial = {}) {
  const state = { userId: A, completed: true, path: '/', ...initial };
  const slots = [], effects = [], listeners = new Set(), timers = new Map(), requests = [];
  let cursor = 0, dirty = true, tree, timerId = 0;
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    createElement,
    createContext: () => ({ Provider: 'UnreadProvider' }),
    useContext: () => tree?.props.value,
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {};
      const slot = slots[index];
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (slots[index]?.subscribe !== subscribe) {
        slots[index]?.cleanup?.(); slots[index] = { subscribe, cleanup: subscribe(() => { dirty = true; }) };
      }
      return getSnapshot();
    },
  };
  const AppState = { currentState: initial.appState ?? 'active', addEventListener: (_event, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } };
  const modules = {
    react, 'expo-router': { usePathname: () => state.path }, 'react-native': { AppState },
    '../lib/unreadMessages': { createUnreadMessages },
    '../lib/messages': { loadUnreadMessageCount: userId => { const pending = deferred(); requests.push({ userId, ...pending }); return pending.promise; } },
    './AuthContext': { useAuth: () => ({ user: state.userId ? { id: state.userId } : null }) },
    './ProfileContext': { useProfile: () => ({ isProfileComplete: state.completed,
      profile: state.userId ? { id: state.profileId ?? state.userId } : null }) },
  };
  const component = production('src/context/UnreadMessagesContext.tsx', modules, {
    setInterval: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration }); return id; },
    clearInterval: id => timers.delete(id),
  }).UnreadMessagesProvider;
  function render(runEffects = true) {
    let rounds = 0;
    while (dirty) {
      assert.ok(++rounds < 100); dirty = false; cursor = 0; tree = component({ children: 'app' });
      if (runEffects) while (effects.length) effects.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 4; i++) { render(); await tick(); } render(); }
  function mutate(patch, runEffects = true) { Object.assign(state, patch); dirty = true; render(runEffects); }
  function flushEffects() { while (effects.length) effects.shift()(); render(); }
  function appState(value) { AppState.currentState = value; for (const listener of listeners) listener(value); render(); }
  function unmount() { for (const slot of slots) slot?.cleanup?.(); }
  render();
  return { requests, timers, settle, mutate, flushEffects, appState, unmount, value: () => tree.props.value };
}

function wiringHarness(kind) {
  let callbacks, loader, readOperation = deferred(), pageOperation = deferred(), refreshes = 0;
  const readCalls = [], pageCalls = [];
  const state = { summary: null, messages: [], draft: '', items: [], loaded: false, loading: false };
  const model = { subscribe() {}, getSnapshot: () => state, setActive() {}, refresh() {}, observe() {} };
  const react = { createElement, useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
    useState: initial => [initial, () => {}], useRef: current => ({ current }), useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const modules = {
    react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@react-native-async-storage/async-storage': { default: {}, __esModule: true },
    'expo-router': { useRouter: () => ({}), useFocusEffect() {}, useLocalSearchParams: () => ({ id: CHAT }) },
    'react-native': { AppState: { currentState: 'active' }, StyleSheet: { create: value => value }, Platform: { OS: 'android' },
      FlatList: 'FlatList', Pressable: 'Pressable', View: 'View', Text: 'Text', TextInput: 'TextInput', KeyboardAvoidingView: 'KeyboardAvoidingView', RefreshControl: 'RefreshControl' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../context/AuthContext': { useAuth: () => ({ user: { id: A } }) },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ refreshUnread: async () => { refreshes++; } }) },
    '../../lib/env': { env: { supabaseUrl: 'http://localhost:54321' } },
    '../../lib/messageThread': { isConversationId: () => true, createMessageThread: (_actor, _chat, dependencies) => { callbacks = dependencies; return model; } },
    '../../lib/conversationInbox': { createConversationInbox: load => { loader = load; return model; } },
    '../../lib/messages': {
      markConversationRead: (...args) => { readCalls.push(args); return readOperation.promise; },
      loadConversationPage: (...args) => { pageCalls.push(args); return pageOperation.promise; },
    },
  };
  const outer = production(kind === 'thread' ? 'src/app/messages/[id].tsx' : 'src/app/(tabs)/messages.tsx', modules).default();
  outer.type(outer.props);
  return { callbacks, loader, readCalls, pageCalls, refreshes: () => refreshes,
    resolveRead: value => readOperation.resolve(value), rejectRead: error => readOperation.reject(error),
    resolvePage: value => pageOperation.resolve(value), rejectPage: error => pageOperation.reject(error),
  };
}

function inboxSyncHarness(initialTotal = 0) {
  const { createConversationInbox } = production('src/lib/conversationInbox.ts');
  const slots = [], effects = [], focusEffects = new Set(), events = new Set(), requests = [];
  let cursor = 0, dirty = true, focused = true, unreadCount = 0, total = initialTotal, model, creations = 0, refreshes = 0;
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    createElement,
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useState(initial) {
      const index = cursor++; if (!slots[index]) slots[index] = { value: initial };
      return [slots[index].value, value => { slots[index].value = value; dirty = true; }];
    },
    useEffect(callback, deps) {
      const index = cursor++; if (!slots[index]) slots[index] = {};
      const slot = slots[index];
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (slots[index]?.subscribe !== subscribe) {
        slots[index]?.cleanup?.(); slots[index] = { subscribe, cleanup: subscribe(() => { dirty = true; }) };
      }
      return getSnapshot();
    },
  };
  function useFocusEffect(callback) {
    const index = cursor++; if (!slots[index]) slots[index] = {};
    const slot = slots[index]; focusEffects.add(slot);
    if (slot.callback !== callback) effects.push(() => { slot.cleanup?.(); slot.callback = callback; slot.cleanup = focused ? callback() : null; });
  }
  function setTotal(next) { total = next; if (unreadCount !== next) { unreadCount = next; dirty = true; } }
  const refreshUnread = async () => { refreshes++; setTotal(total); };
  const AppState = { currentState: 'active', addEventListener: (_event, listener) => {
    events.add(listener); return { remove: () => events.delete(listener) };
  } };
  const screen = production('src/app/(tabs)/messages.tsx', {
    react, '@expo/vector-icons': { Ionicons: 'Ionicons' }, 'expo-router': { useRouter: () => ({}), useFocusEffect },
    'react-native': { AppState, FlatList: 'FlatList', View: 'View', Text: 'Text', Pressable: 'Pressable',
      TextInput: 'TextInput', RefreshControl: 'RefreshControl', StyleSheet: { create: value => value } },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../context/AuthContext': { useAuth: () => ({ user: { id: A } }) },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ unreadCount, refreshUnread }) },
    '../../lib/conversationInbox': { createConversationInbox: loader => { creations++; model = createConversationInbox(loader); return model; } },
    '../../lib/messages': { loadConversationPage: (...args) => {
      const pending = deferred(); requests.push({ args, ...pending }); return pending.promise;
    } },
  }).default;
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(++count < 100, 'Count changes must not cause a render loop'); dirty = false; cursor = 0;
      const outer = screen(); outer.type(outer.props);
      while (effects.length) effects.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 5; i++) { render(); await tick(); } render(); }
  function blur() { focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } render(); }
  function focus() { focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function appState(value) { AppState.currentState = value; for (const event of events) event(value); render(); }
  function resolve(index, count) { requests[index].resolve({ items: [{ id: CHAT, unread_count: count }], nextCursor: null }); }
  render();
  return { requests, settle, blur, focus, appState, resolve,
    setCount: value => { setTotal(value); render(); }, state: () => model.getSnapshot(), creations: () => creations, refreshes: () => refreshes };
}

(async () => {
  await test('count queries run only while active and accept the full server total', async () => {
    const h = harness(); await h.model.refresh(); assert.equal(h.calls.length, 0); assert.equal(h.model.getSnapshot(), 0);
    h.model.setActive(true); h.model.setActive(true); assert.equal(h.calls.length, 1);
    h.calls[0].resolve(347); await tick(); assert.equal(h.model.getSnapshot(), 347);
    assert.deepEqual(h.updates, [347]);
  });
  await test('a read-refresh race never republishes an older unread count', async () => {
    const h = harness(); h.model.setActive(true); h.calls[0].resolve(8); await tick();
    const running = h.model.refresh(); await h.model.refresh(); await h.model.refresh();
    assert.equal(h.calls.length, 2); h.calls[1].resolve(8); await tick();
    assert.equal(h.calls.length, 3); assert.deepEqual(h.updates, [8]);
    h.calls[2].resolve(0); await running; assert.equal(h.model.getSnapshot(), 0); assert.deepEqual(h.updates, [8, 0]);
  });
  await test('background suppresses late results and resume starts a fresh query', async () => {
    const h = harness(); h.model.setActive(true); h.calls[0].resolve(2); await tick();
    void h.model.refresh(); h.model.setActive(false); await h.model.refresh(); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(90); await tick(); assert.equal(h.model.getSnapshot(), 2);
    h.model.setActive(true); h.calls[2].resolve(3); await tick(); assert.equal(h.model.getSnapshot(), 3);
  });
  await test('a previous active epoch cannot clear or overwrite a resumed operation', async () => {
    const h = harness(); h.model.setActive(true); h.model.setActive(false); h.model.setActive(true);
    h.calls[0].resolve(90); await tick(); await h.model.refresh(); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(4); await tick(); assert.equal(h.calls.length, 3); assert.equal(h.model.getSnapshot(), 0);
    h.calls[2].resolve(3); await tick(); assert.equal(h.model.getSnapshot(), 3);
  });
  await test('offline failures and malformed totals preserve the last confirmed badge', async () => {
    const h = harness(); h.model.setActive(true); h.calls[0].resolve(5); await tick();
    const failed = h.model.refresh(); h.calls.at(-1).reject(Error('offline')); await failed; assert.equal(h.model.getSnapshot(), 5);
    for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5', null]) {
      const pending = h.model.refresh(); h.calls.at(-1).resolve(invalid); await pending; assert.equal(h.model.getSnapshot(), 5);
    }
    const retry = h.model.refresh(); h.calls.at(-1).resolve(1); await retry; assert.equal(h.model.getSnapshot(), 1);
  });
  await test('a refresh requested during failure still gets its own retry', async () => {
    const h = harness(); h.model.setActive(true); await h.model.refresh();
    h.calls[0].reject(Error('offline')); await tick(); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(6); await tick(); assert.equal(h.model.getSnapshot(), 6);
  });
  await test('different account stores never share counts or pending responses', async () => {
    const first = harness(), second = harness(); first.model.setActive(true); first.calls[0].resolve(45); await tick();
    first.model.setActive(false); second.model.setActive(true); assert.equal(second.model.getSnapshot(), 0);
    second.calls[0].resolve(2); await tick(); assert.equal(first.model.getSnapshot(), 45); assert.equal(second.model.getSnapshot(), 2);
  });
  await test('unchanged totals and unsubscribed listeners produce no spurious updates', async () => {
    const h = harness(); let extra = 0; const unsubscribe = h.model.subscribe(() => extra++);
    h.model.setActive(true); h.calls[0].resolve(1); await tick(); unsubscribe();
    let pending = h.model.refresh(); h.calls.at(-1).resolve(1); await pending;
    pending = h.model.refresh(); h.calls.at(-1).resolve(2); await pending;
    assert.deepEqual(h.updates, [1, 2]); assert.equal(extra, 1);
  });
  await test('provider refreshes on route changes, polling and foreground, retaining a stable refresh callback', async () => {
    const app = providerHarness(); assert.equal(app.requests[0].userId, A);
    app.requests[0].resolve(3); await app.settle(); // Mount route refresh supersedes the first query.
    app.requests.at(-1).resolve(3); await app.settle(); assert.equal(app.value().unreadCount, 3);
    const refresh = app.value().refreshUnread;
    app.mutate({ path: '/courses' }); assert.equal(app.requests.length, 3);
    app.requests.at(-1).resolve(2); await app.settle(); assert.equal(app.value().unreadCount, 2);
    assert.equal(app.value().refreshUnread, refresh);
    assert.equal(app.timers.size, 1); assert.equal([...app.timers.values()][0].duration, 30000);
    [...app.timers.values()][0].callback(); assert.equal(app.requests.length, 4);
    app.appState('background'); app.requests.at(-1).resolve(55); await app.settle(); assert.equal(app.value().unreadCount, 2);
    [...app.timers.values()][0].callback(); assert.equal(app.requests.length, 4);
    app.appState('active'); assert.equal(app.requests.length, 5); app.requests.at(-1).resolve(1); await app.settle();
    assert.equal(app.value().unreadCount, 1); app.unmount(); assert.equal(app.timers.size, 0);
  });
  await test('provider account switches show zero immediately and discard old account responses', async () => {
    const app = providerHarness(); app.requests[0].resolve(17); await app.settle(); app.requests.at(-1).resolve(17); await app.settle();
    assert.equal(app.value().unreadCount, 17); void app.value().refreshUnread(); const old = app.requests.at(-1);
    app.mutate({ userId: B }, false); assert.equal(app.value().unreadCount, 0);
    app.flushEffects(); assert.equal(app.requests.at(-1).userId, B);
    old.resolve(19); await app.settle(); assert.equal(app.value().unreadCount, 0);
    app.requests.at(-1).resolve(4); await app.settle(); app.requests.at(-1).resolve(4); await app.settle();
    assert.equal(app.value().unreadCount, 4); app.mutate({ userId: null }); assert.equal(app.value().unreadCount, 0);
    assert.equal(app.timers.size, 0); app.unmount();
  });
  await test('signed-out, incomplete or stale-profile and background providers issue no count requests', async () => {
    for (const config of [{ userId: null }, { completed: false }, { profileId: B }, { appState: 'background' }]) {
      const app = providerHarness(config); await app.settle(); assert.equal(app.requests.length, 0); assert.equal(app.value().unreadCount, 0);
      for (const timer of app.timers.values()) timer.callback(); assert.equal(app.requests.length, 0); app.unmount();
    }
  });
  await test('the real Messages tab displays zero, exact counts and 99+ from the shared provider', () => {
    let count = 0;
    const component = production('src/app/(tabs)/_layout.tsx', {
      react: { createElement }, '@expo/vector-icons': { Ionicons: 'Ionicons' }, 'expo-router': { Tabs: { Screen: 'TabScreen' } },
      '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ unreadCount: count }) },
    }).default;
    for (const [value, badge] of [[0, undefined], [1, 1], [99, 99], [100, '99+'], [347, '99+']]) {
      count = value; const tree = component(), tab = nodes(tree).find(node => node.props.name === 'messages');
      assert.equal(tab.props.options.tabBarBadge, badge);
      assert.equal(tab.props.options.tabBarAccessibilityLabel, value ? `Messages, ${value} unread messages` : 'Messages');
      assert.equal(nodes(tree).filter(node => node.props.options?.tabBarBadge !== undefined).length, value ? 1 : 0);
    }
  });
  await test('thread read receipts refresh the global badge only after the backend confirms success', async () => {
    const app = wiringHarness('thread'), pending = app.callbacks.markRead(A, CHAT, '29');
    assert.deepEqual(app.readCalls, [[A, CHAT, '29']]); assert.equal(app.refreshes(), 0);
    app.resolveRead('29'); assert.equal(await pending, '29'); assert.equal(app.refreshes(), 1);
    const failed = wiringHarness('thread'), attempt = failed.callbacks.markRead(A, CHAT, '30');
    failed.rejectRead(Error('offline')); await assert.rejects(attempt, /offline/); assert.equal(failed.refreshes(), 0);
  });
  await test('inbox page loads trigger an independent total refresh without summing or limiting page counts', async () => {
    const app = wiringHarness('inbox'), before = { id: CHAT, activityAt: '2026-09-27T00:00:00Z' };
    const pending = app.loader(before), page = { items: [{ id: CHAT, unread_count: 1 }], hasMore: true, nextCursor: before };
    assert.equal(app.pageCalls[0][0], A); assert.equal(app.pageCalls[0][1].before, before); assert.equal(app.refreshes(), 0);
    app.resolvePage(page); assert.equal(await pending, page); assert.equal(app.refreshes(), 1);
    const failed = wiringHarness('inbox'), attempt = failed.loader(null); failed.rejectPage(Error('offline'));
    await assert.rejects(attempt, /offline/); assert.equal(failed.refreshes(), 0);
  });
  await test('the active inbox follows a new global count without rebuilding or looping', async () => {
    const app = inboxSyncHarness(1);
    app.resolve(0, 1); await app.settle(); assert.equal(app.requests.length, 2);
    app.resolve(1, 1); await app.settle(); assert.equal(app.requests.length, 2);
    assert.equal(app.state().items[0].unread_count, 1); assert.equal(app.creations(), 1); assert.equal(app.refreshes(), 2);
    app.setCount(2); assert.equal(app.requests.length, 3);
    app.resolve(2, 2); await app.settle(); assert.equal(app.requests.length, 3); assert.equal(app.state().items[0].unread_count, 2);
    assert.equal(app.creations(), 1);
  });
  await test('a total change during a page load waits then refreshes the row counts', async () => {
    const app = inboxSyncHarness(); app.setCount(5); assert.equal(app.requests.length, 1);
    app.resolve(0, 0); await app.settle(); assert.equal(app.requests.length, 2);
    app.resolve(1, 5); await app.settle(); assert.equal(app.requests.length, 2);
    assert.equal(app.state().items[0].unread_count, 5); assert.equal(app.creations(), 1);
  });
  await test('badge changes do not load an inactive inbox; returning refreshes its rows', async () => {
    const app = inboxSyncHarness(); app.resolve(0, 0); await app.settle();
    app.blur(); app.setCount(2); await app.settle(); assert.equal(app.requests.length, 1);
    app.focus(); assert.equal(app.requests.length, 2); app.resolve(1, 2); await app.settle();
    assert.equal(app.state().items[0].unread_count, 2);
    app.appState('background'); app.setCount(3); await app.settle(); assert.equal(app.requests.length, 2);
    app.appState('active'); assert.equal(app.requests.length, 3); app.resolve(2, 3); await app.settle();
    assert.equal(app.state().items[0].unread_count, 3); assert.equal(app.requests.length, 3); assert.equal(app.creations(), 1);
  });
  console.log('Unread message checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
