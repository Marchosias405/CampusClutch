/* global __dirname */
// Exercise the production message screen's inverted-list positioning without a device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const CHAT = 'c0000000-0000-4000-8000-000000000003';
const TIME = '2026-10-09T10:00:00Z';

const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/app/messages/[id].tsx'), 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;
const groupUiCompiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/groupMessagingUi.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const groupUi = {};
vm.runInNewContext(groupUiCompiled, { exports: groupUi }, { filename: 'src/lib/groupMessagingUi.ts' });

const message = (number, senderId = B) => ({
  id: `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  conversation_id: CHAT,
  sender_id: senderId,
  client_message_id: `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  sequence: String(number),
  body: `Message ${number}`,
  created_at: TIME,
});

function nodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach(item => nodes(item, result));
    return result;
  }
  result.push(node);
  nodes(node.props?.children, result);
  return result;
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

function harness(initialMessages = [message(1)]) {
  let slots = [];
  let cursor = 0;
  let dirty = true;
  let tree;
  let phase = 'idle';
  let offset = 0;
  const layoutEffects = [];
  const effects = [];
  const animationFrames = [];
  const appStateListeners = new Set();
  const scrolls = [];
  const subscribers = new Set();
  const equal = (left, right) => left?.length === right?.length
    && left.every((item, index) => Object.is(item, right[index]));
  const createElement = (type, properties, ...children) => ({ type, props: { ...properties, children } });

  let state = {
    summary: {
      id: CHAT,
      type: 'direct',
      status: 'active',
      other_profile_id: B,
      other_display_name: 'Student B',
    },
    messages: initialMessages,
    draft: '',
    pending: null,
    restored: true,
    sending: false,
    loading: false,
    loadingOlder: false,
    hasMore: true,
    error: '',
    readError: '',
    storageError: '',
    sendError: '',
  };

  const model = {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    getSnapshot: () => state,
    setActive() {},
    setDraft() {},
    observe() {},
    refresh() {},
    loadOlder() {},
    send() {},
    discardPending() {},
    retryStorage() {},
  };

  function memo(callback, deps) {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
    return slots[index].value;
  }

  function queueEffect(queue, callback, deps) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { deps: null, cleanup: null };
    const slot = slots[index];
    if (!equal(slot.deps, deps)) queue.push(() => {
      slot.cleanup?.();
      slot.deps = deps;
      slot.cleanup = callback();
    });
  }

  const react = {
    createElement,
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          dirty = true;
        }
      }];
    },
    useEffect(callback, deps) { queueEffect(effects, callback, deps); },
    useLayoutEffect(callback, deps) { queueEffect(layoutEffects, callback, deps); },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (!slots[index] || slots[index].subscribe !== subscribe) {
        slots[index]?.cleanup?.();
        slots[index] = { subscribe, cleanup: subscribe(() => { dirty = true; }) };
      }
      return getSnapshot();
    },
  };

  function useFocusEffect(callback) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { callback: null, cleanup: null };
    const slot = slots[index];
    if (slot.callback !== callback) effects.push(() => {
      slot.cleanup?.();
      slot.callback = callback;
      slot.cleanup = callback();
    });
  }

  const listApi = {
    scrollToOffset(options) {
      scrolls.push({ ...options, phase });
      offset = options.offset;
    },
  };
  const AppState = {
    currentState: 'active',
    addEventListener(_event, listener) {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  };
  const refreshUnread = () => {};
  const modules = {
    react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@react-native-async-storage/async-storage': { default: {}, __esModule: true },
    'expo-router': {
      useFocusEffect,
      useLocalSearchParams: () => ({ id: CHAT }),
      useRouter: () => ({ canGoBack: () => true, back() {}, replace() {} }),
    },
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      Alert: { alert() {} },
      AppState,
      FlatList: 'FlatList',
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' },
      Pressable: 'Pressable',
      StyleSheet: { create: value => value },
      Text: 'Text',
      TextInput: 'TextInput',
      View: 'View',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../context/AuthContext': { useAuth: () => ({ user: { id: A } }) },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ refreshUnread, subscribeMessages: () => () => {} }) },
    '../../lib/env': { env: { supabaseUrl: 'http://localhost:54321' } },
    '../../lib/groupMessagingUi': groupUi,
    '../../lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: false },
    '../../lib/messages': {
      loadConversationSummary() {},
      loadMessagePage() {},
      markConversationRead() {},
      messagingError: () => 'error',
      sendMessage() {},
    },
    '../../lib/messageThread': {
      compareSequences: (left, right) => Number(left) - Number(right),
      createMessageThread: () => model,
      isConversationId: () => true,
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    crypto: { randomUUID: () => '30000000-0000-4000-8000-000000000001' },
    requestAnimationFrame: callback => { animationFrames.push(callback); return animationFrames.length; },
    require: name => {
      if (!(name in modules)) throw Error('Unexpected import: ' + name);
      return modules[name];
    },
  }, { filename: 'src/app/messages/[id].tsx' });

  const outer = exports.default();
  const component = outer.type;
  const componentProps = outer.props;

  function flatList() {
    const list = nodes(tree).find(node => node.type === 'FlatList');
    assert.ok(list, 'The production thread must render a FlatList');
    return list;
  }

  function settle() {
    let rounds = 0;
    do {
      assert.ok(++rounds < 100, 'Message screen entered a render loop');
      dirty = false;
      cursor = 0;
      tree = component(componentProps);
      const ref = flatList().props.ref;
      if (ref) ref.current = listApi;
      while (layoutEffects.length) layoutEffects.shift()();
      while (effects.length) effects.shift()();
    } while (dirty);
  }

  function publish(messages) {
    state = { ...state, messages };
    subscribers.forEach(listener => listener());
    settle();
  }

  function userScroll(nextOffset) {
    offset = nextOffset;
    flatList().props.onScroll({ nativeEvent: { contentOffset: { y: nextOffset } } });
    settle();
  }

  // Model the native order that exposed the device bug. An imperative scroll issued
  // before layout is superseded when maintainVisibleContentPosition anchors the old row.
  function commitNewest(messages, insertedHeight = 72) {
    const previousOffset = offset;
    const before = scrolls.length;
    phase = 'before-layout';
    publish(messages);
    phase = 'native-maintain';
    const maintain = flatList().props.maintainVisibleContentPosition;
    const threshold = maintain?.autoscrollToTopThreshold;
    offset = Number.isFinite(threshold) && previousOffset <= threshold
      ? 0
      : previousOffset + insertedHeight;
    phase = 'content-size';
    flatList().props.onContentSizeChange?.(360, 1000 + insertedHeight);
    settle();
    phase = 'animation-frame';
    while (animationFrames.length) animationFrames.shift()();
    settle();
    phase = 'idle';
    return scrolls.slice(before);
  }

  function commitOlder(messages) {
    const previousOffset = offset;
    const before = scrolls.length;
    phase = 'before-layout';
    publish(messages);
    phase = 'content-size';
    flatList().props.onContentSizeChange?.(360, 1200);
    settle();
    phase = 'animation-frame';
    while (animationFrames.length) animationFrames.shift()();
    settle();
    phase = 'idle';
    return { previousOffset, calls: scrolls.slice(before) };
  }

  settle();
  return {
    commitNewest,
    commitOlder,
    flatList,
    scrolls,
    tree: () => tree,
    offset: () => offset,
    userScroll,
    initialLayout() {
      phase = 'content-size';
      flatList().props.onContentSizeChange?.(360, 1000);
      settle();
      phase = 'idle';
    },
  };
}

let checks = 0;
function test(name, run) {
  run();
  checks++;
  console.log('PASS ' + name);
}

test('initial history layout does not issue a spurious scroll', () => {
  const app = harness();
  app.initialLayout();
  assert.deepEqual(app.scrolls, []);
  assert.equal(app.offset(), 0);
});

test('a newly sent row at the bottom is revealed after native layout anchoring', () => {
  const app = harness([message(1)]);
  const calls = app.commitNewest([message(2, A), message(1)]);
  assert.equal(app.offset(), 0, 'the newly sent bubble must remain fully visible');
  assert.ok(calls.some(call => call.phase === 'content-size' || call.phase === 'animation-frame')
    || Number.isFinite(app.flatList().props.maintainVisibleContentPosition?.autoscrollToTopThreshold),
  'the correction must happen during or after layout, rather than being overwritten by native anchoring');
});

test('sending while reading older messages returns to the newly sent row after layout', () => {
  const app = harness([message(2), message(1)]);
  app.userScroll(180);
  const calls = app.commitNewest([message(3, A), message(2), message(1)]);
  assert.equal(app.offset(), 0);
  assert.ok(calls.some(call => call.phase === 'content-size' || call.phase === 'animation-frame'));
  assert.ok(!textOf(app.tree()).includes('Jump to latest messages'));
});

test('an incoming row remains visible when the reader was already at the bottom', () => {
  const app = harness([message(2), message(1)]);
  const calls = app.commitNewest([message(3, B), message(2), message(1)]);
  assert.equal(app.offset(), 0);
  assert.equal(calls.some(call => call.phase === 'before-layout'), false);
  assert.ok(calls.some(call => call.phase === 'content-size' || call.phase === 'animation-frame'));
  assert.ok(!textOf(app.tree()).includes('Jump to latest messages'));
});

test('an incoming row preserves older reading position and exposes the jump action', () => {
  const app = harness([message(2), message(1)]);
  app.userScroll(180);
  const calls = app.commitNewest([message(3, B), message(2), message(1)]);
  assert.ok(app.offset() > 0, 'an incoming row must not pull an older reader to the bottom');
  assert.equal(calls.filter(call => call.phase === 'content-size' || call.phase === 'animation-frame').length, 0);
  const jump = nodes(app.tree()).find(node => node.type === 'Pressable' && textOf(node) === 'Jump to latest messages');
  assert.ok(jump, 'an older reader needs a visible jump-to-latest action');
  jump.props.onPress();
  assert.equal(app.offset(), 0);
});

test('older pagination with the same newest row preserves position without a new-message action', () => {
  const app = harness([message(3), message(2)]);
  app.userScroll(140);
  const result = app.commitOlder([message(3), message(2), message(1)]);
  assert.equal(app.offset(), result.previousOffset);
  assert.equal(result.calls.length, 0);
  assert.ok(!textOf(app.tree()).includes('Jump to latest messages'));
});

console.log(`Message thread layout: ${checks} checks passed.`);
