/* global __dirname */
// Exercise the production message screen's list positioning and header actions without a device.
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
const threadCompiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/messageThread.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const thread = {};
vm.runInNewContext(threadCompiled, { exports: thread }, { filename: 'src/lib/messageThread.ts' });

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

function harness(initialMessages = [message(1)], options = {}) {
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
  const focusSlots = new Set();
  let focused = true;
  const scrolls = [];
  const navigation = [];
  const mutations = [];
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
    readReceipts: {},
    storageError: '',
    sendError: '',
  };

  const model = {
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    getSnapshot: () => state,
    setActive() {},
    setDraft(value) { mutations.push('setDraft'); state = { ...state, draft: value }; subscribers.forEach(listener => listener()); },
    observe() {},
    refresh() {},
    loadOlder() {},
    send() { mutations.push('send'); },
    discardPending() { mutations.push('discardPending'); },
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
    focusSlots.add(slot);
    if (slot.callback !== callback) effects.push(() => {
      slot.cleanup?.();
      slot.callback = callback;
      slot.cleanup = focused ? callback() : null;
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
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '../../lib/privateDrafts': { privateDrafts: { forAccount: () => ({}) } },
    'expo-router': {
      useFocusEffect,
      useLocalSearchParams: () => ({ id: CHAT }),
      useRouter: () => ({ canGoBack: () => true, back() {}, replace() {}, push(destination) { navigation.push(destination); } }),
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
    '../../lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: options.groupsEnabled ?? false },
    '../../lib/messages': {
      loadConversationSummary() {},
      loadMessagePage() {},
      markConversationRead() {},
      messagingError: () => 'error',
      sendMessage() {},
    },
    '../../lib/messageThread': {
      compareSequences: thread.compareSequences,
      createMessageThread: () => model,
      isConversationId: thread.isConversationId,
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
      const ref = nodes(tree).find(node => node.type === 'FlatList')?.props.ref;
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
    navigation,
    mutations,
    tree: () => tree,
    snapshot: () => state,
    patchState(values, render = true) {
      state = { ...state, ...values };
      subscribers.forEach(listener => listener());
      if (render) settle();
    },
    appState(value) {
      AppState.currentState = value;
      appStateListeners.forEach(listener => listener(value));
      settle();
    },
    blur() {
      focused = false;
      focusSlots.forEach(slot => { slot.cleanup?.(); slot.cleanup = null; });
      settle();
    },
    focus() {
      focused = true;
      focusSlots.forEach(slot => { slot.cleanup = slot.callback(); });
      settle();
    },
    receipts(values) { state = { ...state, readReceipts: values }; subscribers.forEach(listener => listener()); settle(); },
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

test('outgoing bubbles distinguish sent time, dated reads and undated legacy reads', () => {
  const own = message(1, A), incoming = message(2, B), app = harness([incoming, own]);
  const render = item => textOf(app.flatList().props.renderItem({ item }));
  assert.ok(render(own).includes('Sent ')); assert.ok(!render(own).includes('Read'));
  app.receipts({ [own.id]: { message_id: own.id, is_read: true, read_at: TIME },
    [incoming.id]: { message_id: incoming.id, is_read: true, read_at: TIME } });
  assert.ok(render(own).includes('Read ')); assert.ok(!render(incoming).includes('Read'));
  assert.ok(app.flatList().props.extraData[own.id], 'FlatList rerenders unchanged message rows when receipts arrive');
  app.receipts({ [own.id]: { message_id: own.id, is_read: true, read_at: null } });
  assert.ok(render(own).includes('Read')); assert.ok(!render(own).includes('Read '));
  assert.equal(app.scrolls.length, 0, 'a receipt-only update must not jump the conversation');
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

function profileButton(app) {
  return nodes(app.tree()).find(node => node.type === 'Pressable'
    && node.props.accessibilityRole === 'button'
    && /^View .+'s profile$/.test(node.props.accessibilityLabel ?? ''));
}

test('the direct-message avatar and name open the other student profile without changing the draft', () => {
  const app = harness();
  const composer = nodes(app.tree()).find(node => node.type === 'TextInput');
  composer.props.onChangeText('Keep this unsent message while viewing the profile');
  app.patchState({});
  const button = profileButton(app);
  assert.ok(button, 'the conversation identity must be a discoverable profile button');
  assert.equal(button.props.accessibilityLabel, "View Student B's profile");
  assert.equal(button.props.disabled, false);
  assert.ok(textOf(button).includes('SB'), 'the avatar must belong to the profile tap target');
  assert.ok(textOf(button).includes('Student B'), 'the displayed name must belong to the same tap target');
  assert.ok(textOf(button).includes('View profile'), 'the profile action needs a visible hint');
  const before = app.snapshot();
  const mutationsBefore = [...app.mutations];
  button.props.onPress();
  assert.equal(app.navigation.length, 1);
  assert.equal(app.navigation[0].pathname, '/students/[id]');
  assert.equal(app.navigation[0].params.id, B, 'navigate with the peer profile UUID, not the conversation or current user ID');
  assert.equal(app.snapshot(), before, 'viewing a profile must not mutate thread state');
  assert.deepEqual(app.mutations, mutationsBefore, 'viewing a profile must not send, discard or clear the draft');
});

test('opening a peer profile preserves an unconfirmed saved send attempt', () => {
  const app = harness();
  const pending = { clientMessageId: 'd0000000-0000-4000-8000-000000000004', body: 'Retry this exact message' };
  app.patchState({ pending, draft: pending.body });
  profileButton(app).props.onPress();
  assert.equal(app.navigation.length, 1);
  assert.equal(app.snapshot().pending, pending);
  assert.equal(app.snapshot().draft, pending.body);
  assert.deepEqual(app.mutations, []);
});

test('missing, deleted, invalid, self and mismatched peers do not expose a profile action', () => {
  const variants = [
    ['unloaded summary', () => null],
    ['deleted peer', summary => ({ ...summary, other_profile_id: null })],
    ['missing peer', summary => ({ ...summary, other_profile_id: undefined })],
    ['invalid peer', summary => ({ ...summary, other_profile_id: '../../students/other' })],
    ['self peer', summary => ({ ...summary, other_profile_id: A.toUpperCase() })],
    ['mismatched conversation', summary => ({ ...summary, id: B })],
  ];
  for (const [name, makeSummary] of variants) {
    const app = harness();
    app.patchState({ summary: makeSummary(app.snapshot().summary) });
    assert.equal(profileButton(app), undefined, name);
    assert.equal(app.navigation.length, 0, name);
  }
});

test('a group header never becomes an individual student profile action', () => {
  for (const groupsEnabled of [false, true]) {
    const app = harness(undefined, { groupsEnabled });
    app.patchState({ summary: {
      id: CHAT, type: 'group', status: 'active', other_profile_id: null, other_display_name: null,
      group_title: 'Study group', group_course_id: B, group_course_code: 'CMPT 120',
      active_member_count: 3, my_role: 'member', my_membership_status: 'active',
      my_membership_period: 1, management_revision: '1', can_send: true,
    } });
    assert.equal(profileButton(app), undefined);
    assert.equal(app.navigation.length, 0);
  }
});

test('a deleted student keeps readable history without a profile link', () => {
  const app = harness();
  app.patchState({ summary: { ...app.snapshot().summary, status: 'closed', other_display_name: 'Deleted student', other_profile_deleted: true } });
  assert.equal(profileButton(app), undefined);
});

test('a valid unnamed peer remains accessible from read-only direct-message history', () => {
  const app = harness();
  app.patchState({ summary: { ...app.snapshot().summary, status: 'closed', other_display_name: null } });
  const button = profileButton(app);
  assert.ok(button);
  assert.equal(button.props.accessibilityLabel, "View CampusClutch member's profile");
  button.props.onPress();
  assert.equal(app.navigation[0].params.id, B);
});

test('backgrounding disables the profile button and rejects a previously captured tap', () => {
  const app = harness();
  const capturedTap = profileButton(app).props.onPress;
  app.appState('background');
  assert.equal(profileButton(app).props.disabled, true);
  assert.equal(profileButton(app).props.accessibilityState.disabled, true);
  capturedTap();
  assert.equal(app.navigation.length, 0);
  app.appState('active');
  assert.equal(profileButton(app).props.disabled, false);
  profileButton(app).props.onPress();
  assert.equal(app.navigation.length, 1);
});

test('leaving the conversation rejects a stale profile tap until focus returns', () => {
  const app = harness();
  const capturedTap = profileButton(app).props.onPress;
  app.blur();
  assert.equal(profileButton(app).props.disabled, true);
  capturedTap();
  assert.equal(app.navigation.length, 0);
  app.focus();
  assert.equal(profileButton(app).props.disabled, false);
  profileButton(app).props.onPress();
  assert.equal(app.navigation.length, 1);
});

test('a profile tap cannot navigate using a summary superseded before the next render', () => {
  const variants = [
    () => null,
    summary => ({ ...summary, other_profile_id: null }),
    summary => ({ ...summary, other_profile_id: A }),
    summary => ({ ...summary, other_profile_id: 'e0000000-0000-4000-8000-000000000005' }),
    summary => ({ ...summary, id: B }),
    summary => ({ ...summary, type: 'group' }),
  ];
  for (const makeSummary of variants) {
    const app = harness();
    const capturedTap = profileButton(app).props.onPress;
    app.patchState({ summary: makeSummary(app.snapshot().summary) }, false);
    capturedTap();
    assert.equal(app.navigation.length, 0);
  }
});

function reportButton(app, item = app.snapshot().messages[0]) {
  return nodes(app.flatList().props.renderItem({ item })).find(node => node.type === 'Pressable'
    && node.props.accessibilityLabel === 'Report message');
}

test('incoming direct messages expose an accessible report action without changing scroll, draft or receipts', () => {
  const incoming = message(2), own = message(1, A), app = harness([incoming, own]);
  const pending = { clientMessageId: 'd0000000-0000-4000-8000-000000000004', body: 'Keep the same saved send' };
  app.patchState({ draft: pending.body, pending, readReceipts: { [own.id]: { message_id: own.id, is_read: true, read_at: TIME } } });
  app.userScroll(180);
  const control = reportButton(app, incoming);
  assert.ok(control); assert.equal(textOf(control), 'Report message');
  assert.equal(control.props.accessibilityRole, 'button');
  assert.ok(control.props.style.minHeight >= 48 && control.props.style.minWidth >= 48);
  assert.equal(reportButton(app, own), undefined);
  const before = app.snapshot(), offset = app.offset(), scrolls = app.scrolls.length;
  control.props.onPress();
  assert.equal(app.navigation.length, 1);
  assert.equal(app.navigation[0].pathname, '/safety/report');
  assert.deepEqual(JSON.parse(JSON.stringify(app.navigation[0].params)), { targetType: 'message', targetId: incoming.id });
  assert.equal(app.snapshot(), before); assert.equal(app.offset(), offset); assert.equal(app.scrolls.length, scrolls);
  assert.deepEqual(app.mutations, []);
});

test('message report controls exclude own, malformed, mismatched, missing and group targets', () => {
  for (const item of [message(1, A), message(1, A.toUpperCase()), { ...message(1), id: 'unconfirmed' },
    { ...message(1), sender_id: 'invalid' }, { ...message(1), conversation_id: B }]) {
    const app = harness([item]); assert.equal(reportButton(app, item), undefined);
  }
  for (const groupsEnabled of [false, true]) {
    const app = harness(undefined, { groupsEnabled });
    app.patchState({ summary: { ...app.snapshot().summary, type: 'group' } });
    if (groupsEnabled) assert.equal(reportButton(app), undefined);
    else assert.ok(!textOf(app.tree()).includes('Report message'));
  }
  for (const summary of [null, { id: B, type: 'direct' }]) {
    const app = harness(); app.patchState({ summary }); assert.equal(reportButton(app), undefined);
  }
});

test('blocked and closed direct-message history still permits reporting the other student message', () => {
  const app = harness();
  app.patchState({ summary: { ...app.snapshot().summary, status: 'closed', interaction_blocked: true } });
  reportButton(app).props.onPress(); assert.equal(app.navigation.length, 1);
});

test('message report actions reject stale taps after blur, background or a changed current snapshot', () => {
  for (const transition of ['blur', 'background', 'removed', 'own', 'group', 'conversation']) {
    const app = harness(), captured = reportButton(app).props.onPress;
    if (transition === 'blur') app.blur();
    else if (transition === 'background') app.appState('background');
    else if (transition === 'removed') app.patchState({ messages: [] }, false);
    else if (transition === 'own') app.patchState({ messages: [message(1, A)] }, false);
    else app.patchState({ summary: { ...app.snapshot().summary,
      ...(transition === 'group' ? { type: 'group' } : { id: B }) } }, false);
    if (transition === 'blur' || transition === 'background') {
      assert.equal(reportButton(app).props.disabled, true);
      assert.equal(reportButton(app).props.accessibilityState.disabled, true);
    }
    captured(); assert.equal(app.navigation.length, 0, transition); assert.deepEqual(app.mutations, []);
  }
});

test('conversation skeleton gives way to messages or error without replacing cached rows', () => {
  const app = harness([]);
  app.patchState({ loading: true, summary: null });
  assert.equal(app.flatList().props.ListEmptyComponent.type, 'LoadingSkeleton');
  assert.equal(app.flatList().props.ListEmptyComponent.props.label, 'Loading messages');
  app.patchState({ messages: [message(1)], summary: { id: CHAT, type: 'direct', status: 'active', other_profile_id: B } });
  assert.equal(app.flatList().props.data[0].body, 'Message 1');
  app.patchState({ messages: [], error: 'Offline. Retry.' });
  assert.equal(app.flatList().props.ListEmptyComponent, null);
  assert.match(textOf(app.tree()), /Offline/);
});

console.log(`Message thread layout and actions: ${checks} checks passed.`);
