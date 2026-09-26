/* global __dirname */
// Execute both real entry components with deterministic hooks, focus and AppState events.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const REQUEST = 'd0000000-0000-4000-8000-000000000004';
const CHAT = 'e0000000-0000-4000-8000-000000000005';
const files = { request: 'src/components/RequestConversation.tsx', student: 'src/app/students/[id].tsx' };
const compiled = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText]));
const assignment = (overrides = {}) => ({ request_id: REQUEST, offer_round: 2, poster_id: A, helper_id: B, status: 'reserved', ...overrides });
const profile = id => ({ id, displayName: 'Student ' + id[0], onboardingCompletedAt: '2026-01-01T00:00:00Z', yearOfStudy: 2 });
const textOf = node => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props.children);
function nodes(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) { node.forEach(item => nodes(item, output)); return output; }
  output.push(node); nodes(node.props.children, output); return output;
}
function harness(kind) {
  let slots = [], focusEffects = new Set(), normalEffects = new Set(), effectQueue = [];
  let cursor = 0, dirty = true, focused = true, tree, currentKey, userId = A, routeId = B;
  const events = new Set(), calls = [], opens = [], navigation = [];
  const props = { requestId: REQUEST, requestRevision: '2:accepted', disabled: false };
  const state = { rows: [assignment()], hasMore: false, nextRound: null, readError: false, profiles: true };
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { deps: null, cleanup: null };
      const slot = slots[index]; normalEffects.add(slot);
      if (!equal(slot.deps, deps)) effectQueue.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
  };
  function useFocusEffect(callback) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { callback: null, cleanup: null };
    const slot = slots[index]; focusEffects.add(slot);
    if (slot.callback !== callback) effectQueue.push(() => { slot.cleanup?.(); slot.callback = callback; slot.cleanup = focused ? callback() : null; });
  }
  const AppState = { currentState: 'active', addEventListener: (_event, listener) => { events.add(listener); return { remove: () => events.delete(listener) }; } };
  function open(...args) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    opens.push({ args, resolve, reject }); return promise;
  }
  const modules = {
    react,
    'react-native': { AppState, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Text: 'Text',
      Image: 'Image', ScrollView: 'ScrollView', Linking: { openURL() {} }, StyleSheet: { create: value => value } },
    'expo-router': { useFocusEffect, useRouter: () => ({ push: value => { navigation.push(value); blur(); }, back: () => blur() }),
      useLocalSearchParams: () => ({ id: routeId }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '@/context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '@/context/ProfileContext': { useProfile: () => ({ profile: userId ? profile(userId) : null }) },
    '../lib/messages': { openRequestConversation: open },
    '@/lib/messages': { startDirectConversation: open },
    '../lib/requestConversations': { loadRequestConversationAssignments: async (...args) => {
      calls.push(args); if (state.readError) throw Error('private server detail');
      return { items: state.rows, hasMore: state.hasMore, nextRound: state.nextRound };
    } },
    '@/lib/avatars': { getProfileAvatarSignedUrl: async () => null },
    '@/lib/profiles': { getProfileById: async id => { calls.push([id]); return state.profiles ? profile(id) : null; },
      getCampuses: async () => [], getProfileInterests: async () => [], getProfileSocialLinks: async () => ({}) },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../components/RatingSummary': { default: 'RatingSummary', __esModule: true },
    '../../constants/mockData': { mockStudents: [{ id: 'demo', name: 'Demo student', sharedInterests: [] }] },
  };
  const exports = {};
  vm.runInNewContext(compiled[kind], { exports, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name); return modules[name];
  } });
  function reset() {
    for (const effect of [...focusEffects, ...normalEffects]) effect.cleanup?.();
    slots = []; focusEffects = new Set(); normalEffects = new Set(); effectQueue = [];
  }
  function render() {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 100, 'Render should settle'); dirty = false;
      const outer = exports.default(props);
      if (!outer) { reset(); currentKey = undefined; tree = null; continue; }
      if (currentKey !== outer.props.key) { reset(); currentKey = outer.props.key; }
      cursor = 0; tree = outer.type(outer.props);
      while (effectQueue.length) effectQueue.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(setImmediate); } render(); }
  function blur() { if (!focused) return; focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } }
  function focus() { if (focused) return; focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function appState(value) { AppState.currentState = value; for (const listener of events) listener(value); render(); }
  function button(label) {
    const found = nodes(tree).find(node => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(found, 'Missing button ' + label); return found;
  }
  function press(label) { const found = button(label); assert.ok(!found.props.disabled); found.props.onPress(); render(); }
  render();
  return { settle, press, button, blur, focus, appState, state, calls, opens, navigation, content: () => textOf(tree),
    switchAccount: id => { userId = id; dirty = true; render(); },
    switchRoute: id => { if (kind === 'student') routeId = id; else props.requestId = id; dirty = true; render(); },
    setRevision: value => { props.requestRevision = value; dirty = true; render(); },
  };
}
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };
(async () => {
  for (const kind of ['request', 'student']) {
    const label = kind === 'request' ? 'Message helper' : 'Message';
    {
      const app = harness(kind); await app.settle();
      const handler = app.button(label).props.onPress;
      handler(); handler(); await app.settle();
      assert.equal(app.opens.length, 1);
      assert.deepEqual(app.opens[0].args, kind === 'request' ? [A, REQUEST, 2] : [A, B]);
      app.opens[0].resolve(CHAT); await app.settle();
      assert.equal(app.navigation.length, 1);
      assert.equal(app.navigation[0].params.id, CHAT);
      assert.equal(app.navigation[0].pathname, '/messages/[id]');
      pass(kind + ' entry suppresses double taps and navigates using the server conversation ID');
    }
    for (const transition of ['blur', 'background', 'account', 'route']) {
      const app = harness(kind); await app.settle(); app.press(label);
      if (transition === 'blur') app.blur();
      if (transition === 'background') app.appState('background');
      if (transition === 'account') app.switchAccount(C);
      if (transition === 'route') app.switchRoute(C);
      app.opens[0].resolve(CHAT); await app.settle();
      assert.equal(app.navigation.length, 0);
      if (transition === 'blur') { app.focus(); await app.settle(); assert.equal(Boolean(app.button(label).props.disabled), false); }
      if (transition === 'background') { const reads = app.calls.length; app.appState('active'); await app.settle(); assert.ok(app.calls.length > reads); assert.equal(Boolean(app.button(label).props.disabled), false); }
      pass(kind + ' entry discards pending navigation after ' + transition);
    }
    {
      const app = harness(kind); await app.settle(); app.press(label);
      app.opens[0].reject(Error('private server detail')); await app.settle();
      assert.ok(!app.content().includes('private server detail'));
      app.press(kind === 'request' ? label : 'Retry Message');
      assert.equal(app.opens.length, 2);
      app.opens[1].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 1);
      pass(kind + ' entry offers a safe retry after connection failure');
    }
  }
  {
    const app = harness('student'); await app.settle(); app.switchRoute(A); await app.settle();
    assert.ok(!app.content().includes('Message'));
    app.switchRoute('demo'); await app.settle();
    const demo = app.button('Demo profile · no messaging'); assert.equal(demo.props.disabled, true);
    demo.props.onPress(); await app.settle(); assert.equal(app.opens.length, 0);
    pass('self profiles omit messaging and demo profiles cannot create fake chats');
  }
  {
    const app = harness('request'); app.state.rows = []; await app.settle();
    app.blur(); app.focus(); await app.settle(); assert.equal(app.content(), '');
    app.state.rows = [assignment()]; app.state.hasMore = true; app.state.nextRound = 2;
    app.blur(); app.focus(); await app.settle();
    app.state.rows = [assignment({ offer_round: 1, status: 'released' })]; app.state.hasMore = false; app.state.nextRound = null;
    app.press('Load older assignments'); await app.settle();
    assert.equal(app.calls.at(-1)[2], 2);
    assert.ok(app.content().includes('Accepted assignment · Round 2'));
    assert.ok(app.content().includes('Ended assignment · Round 1'));
    pass('request entry hides unaccepted histories and appends older accepted rounds without replacing the current round');
  }
  {
    const app = harness('request'); await app.settle(); app.press('Message helper');
    app.setRevision('3:open'); await app.settle(); app.opens[0].resolve(CHAT); await app.settle();
    assert.equal(app.navigation.length, 0);
    pass('request status or round changes invalidate an older chat-opening operation');
  }
  console.log('Message entry lifecycle checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
