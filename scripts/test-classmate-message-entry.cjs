/* global __dirname */
// Run the actual classmate component with controlled auth, focus and async responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const COURSE = 'd0000000-0000-4000-8000-000000000004';
const COURSE2 = 'd0000000-0000-4000-8000-000000000006';
const CHAT = 'e0000000-0000-4000-8000-000000000005';
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/app/courses/classmates.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const classmate = (id, overrides = {}) => ({ profileId: id, displayName: 'Student ' + id[0], yearOfStudy: 2,
  major: 'Computing', campusDisplayName: 'Burnaby', sameCampus: true, sharedInterestCount: 1,
  sharedInterests: ['Music'], avatarPath: null, ...overrides });
const textOf = node => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props.children);
function nodes(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) { node.forEach(item => nodes(item, output)); return output; }
  output.push(node); nodes(node.props.children, output); return output;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(initial = {}) {
  let slots = [], focusEffects = new Set(), normalEffects = new Set(), effectQueue = [];
  let cursor = 0, dirty = true, focused = true, tree, currentKey;
  let userId = initial.userId === undefined ? A : initial.userId, routeId = initial.routeId ?? COURSE;
  const events = new Set(), calls = [], opens = [], navigation = [], courseQueue = [], classmateQueue = [], avatarQueue = [];
  const state = { rows: [classmate(B)], completedProfile: true, currentCourse: true, ...initial };
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    Fragment: 'Fragment',
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      const slot = slots[index];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; if (!slots[index]) slots[index] = { current: value }; return slots[index]; },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
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
  const modules = {
    react,
    'react-native': { AppState, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Text: 'Text',
      Image: 'Image', ScrollView: 'ScrollView', StyleSheet: { create: value => value } },
    'expo-router': { useFocusEffect, useRouter: () => ({ push: value => { navigation.push(value); blur(); }, back: () => blur() }),
      useLocalSearchParams: () => ({ courseId: routeId }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons', FontAwesome5: 'FontAwesome5' },
    '@/context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '@/context/ProfileContext': { useProfile: () => ({ profile: userId ? { id: state.profileId ?? userId,
      onboardingCompletedAt: state.completedProfile ? '2026-01-01T00:00:00Z' : null } : null }) },
    '@/lib/messages': { startDirectConversation: (...args) => { const operation = deferred(); opens.push({ args, ...operation }); return operation.promise; } },
    '@/lib/avatars': { getProfileAvatarSignedUrl: async avatarPath => { calls.push(['avatar', avatarPath]); return avatarQueue.length ? avatarQueue.shift().promise : null; } },
    '@/lib/courses': {
      getMyCourses: async () => { calls.push(['courses', userId]); return courseQueue.length ? courseQueue.shift().promise
        : [COURSE, COURSE2].map(id => ({ id, code: id === COURSE ? 'CMPT 125' : 'CMPT 225', title: 'Computing' })); },
      isCurrentCourse: () => state.currentCourse,
      getCourseClassmates: async id => { calls.push(['classmates', id, userId]); return classmateQueue.length ? classmateQueue.shift().promise : state.rows; },
    },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
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
      const outer = exports.default();
      if (currentKey !== outer.props.key) { reset(); currentKey = outer.props.key; }
      cursor = 0; tree = outer.type(outer.props);
      while (effectQueue.length) effectQueue.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 6; i++) { render(); await new Promise(setImmediate); } render(); }
  function blur() { if (!focused) return; focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } }
  function focus() { if (focused) return; focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function appState(value) { AppState.currentState = value; for (const listener of events) listener(value); render(); }
  function button(label) {
    const found = nodes(tree).find(node => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(found, 'Missing button ' + label); return found;
  }
  function press(label) { const found = button(label); assert.ok(!found.props.disabled); found.props.onPress(); render(); }
  return { settle, render, press, button, blur, focus, appState, state, calls, opens, navigation, courseQueue, classmateQueue, avatarQueue,
    content: () => textOf(tree), allNodes: () => nodes(tree),
    switchAccount: id => { userId = id; dirty = true; render(); },
    switchCourse: id => { routeId = id; dirty = true; render(); },
  };
}
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };
(async () => {
  {
    const app = harness(); await app.settle();
    const handler = app.button('Message').props.onPress;
    handler(); handler(); await app.settle();
    assert.equal(app.opens.length, 1); assert.deepEqual(app.opens[0].args, [A, B]);
    assert.equal(app.navigation.length, 0);
    app.opens[0].resolve(CHAT); await app.settle();
    assert.equal(app.navigation.length, 1);
    assert.equal(app.navigation[0].pathname, '/messages/[id]'); assert.equal(app.navigation[0].params.id, CHAT);
    pass('Message starts one direct conversation and navigates directly to its server ID');
  }
  {
    const app = harness(); await app.settle();
    for (const node of app.allNodes().filter(item => item.type === 'Pressable')) {
      assert.ok(!nodes(node.props.children).some(item => item.type === 'Pressable'), 'No nested Pressable may trigger a second route');
    }
    app.press('View Profile'); await app.settle();
    assert.equal(app.navigation.length, 1); assert.equal(app.navigation[0].pathname, '/students/[id]');
    assert.equal(app.navigation[0].params.id, B); assert.equal(app.opens.length, 0);
    pass('View Profile has its own action and neither action is nested in another press target');
  }
  {
    const app = harness(); await app.settle(); app.press('Message');
    app.opens[0].reject(Error('private server detail')); await app.settle();
    assert.ok(!app.content().includes('private server detail')); assert.ok(app.content().includes('Unable to open this chat'));
    app.press('Retry Message'); assert.equal(app.opens.length, 2);
    app.opens[1].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 1);
    pass('A failed chat start exposes safe retry without losing the classmate card');
  }
  for (const transition of ['blur', 'background', 'account', 'course']) {
    const app = harness(); await app.settle(); app.press('Message');
    if (transition === 'blur') app.blur();
    if (transition === 'background') app.appState('background');
    if (transition === 'account') app.switchAccount(C);
    if (transition === 'course') app.switchCourse(COURSE2);
    app.opens[0].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 0);
    if (transition === 'blur') { app.focus(); await app.settle(); assert.equal(app.button('Message').props.disabled, false); }
    if (transition === 'background') { const count = app.calls.length; app.appState('active'); await app.settle();
      assert.ok(app.calls.length > count); assert.equal(app.button('Message').props.disabled, false); }
    pass('Pending chat navigation is discarded after ' + transition);
  }
  for (const transition of ['blur', 'background']) {
    const app = harness(); await app.settle(); app.press('Message');
    if (transition === 'blur') { app.blur(); app.focus(); }
    else { app.appState('background'); app.appState('active'); }
    await app.settle(); app.press('Message'); assert.equal(app.opens.length, 2);
    app.opens[0].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 0);
    const openingButton = app.button('Opening chat…'); assert.equal(openingButton.props.disabled, true);
    openingButton.props.onPress(); await app.settle(); assert.equal(app.opens.length, 2);
    app.opens[1].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 1);
    pass('A hung chat start is released after ' + transition + ' and cannot release the next operation lock');
  }
  {
    const app = harness(); await app.settle(); const handler = app.button('Message').props.onPress;
    app.blur(); handler(); app.focus(); await app.settle(); app.appState('background'); handler();
    assert.equal(app.opens.length, 0); pass('Handlers cannot start chats while the screen is blurred or backgrounded');
  }
  {
    const app = harness({ rows: [classmate(A)] }); await app.settle();
    assert.ok(!app.content().includes('Message')); app.press('View Profile');
    assert.equal(app.navigation[0].params.id, A); assert.equal(app.opens.length, 0);
    pass('Self cards retain View Profile but omit Message');
  }
  for (const initial of [{ completedProfile: false }, { profileId: C }]) {
    const app = harness(initial); await app.settle();
    assert.equal(app.button('Message').props.disabled, true); app.button('Message').props.onPress(); await app.settle();
    assert.equal(app.opens.length, 0);
  }
  pass('Incomplete or mismatched viewer profiles cannot start a chat');
  {
    const app = harness({ userId: null }); await app.settle();
    assert.equal(app.calls.length, 0); assert.ok(app.content().includes('Sign in'));
    const oldCourse = harness({ currentCourse: false }); await oldCourse.settle();
    assert.ok(oldCourse.content().includes('not available')); assert.ok(!oldCourse.calls.some(item => item[0] === 'classmates'));
    pass('Signed-out and unavailable-course screens cannot expose classmate actions');
  }
  for (const transition of ['account', 'course', 'blur', 'background']) {
    const app = harness(), pending = deferred(); app.classmateQueue.push(pending); await app.settle();
    app.state.rows = [classmate(C)];
    if (transition === 'account') app.switchAccount(C);
    if (transition === 'course') app.switchCourse(COURSE2);
    if (transition === 'blur') { app.blur(); app.focus(); }
    if (transition === 'background') { app.appState('background'); app.appState('active'); }
    await app.settle(); pending.resolve([classmate(B, { displayName: 'Stale private card' })]); await app.settle();
    assert.ok(!app.content().includes('Stale private card')); assert.ok(app.content().includes('Student c'));
    pass('Old classmate loads cannot replace current data after ' + transition);
  }
  {
    const app = harness(), pending = deferred(); app.courseQueue.push(pending); await app.settle();
    app.switchAccount(C); await app.settle();
    const reads = app.calls.filter(item => item[0] === 'classmates').length;
    pending.resolve([{ id: COURSE, code: 'OLD', title: 'Old account course' }]); await app.settle();
    assert.equal(app.calls.filter(item => item[0] === 'classmates').length, reads);
    assert.ok(!app.content().includes('Old account')); pass('Stale course loads stop before launching classmate requests');
  }
  {
    const app = harness({ rows: [classmate(B, { avatarPath: 'old-private-avatar' })] }), pending = deferred();
    app.avatarQueue.push(pending); await app.settle();
    app.state.rows = [classmate(C)]; app.switchAccount(C); await app.settle();
    pending.resolve('https://example.invalid/old-private-avatar'); await app.settle();
    assert.ok(!app.content().includes('Student b'));
    assert.ok(!app.allNodes().some(node => node.type === 'Image'));
    pass('Late signed-avatar loads cannot restore a previous account card');
  }
  {
    const app = harness(), pending = deferred(); app.classmateQueue.push(pending); await app.settle();
    app.switchCourse(COURSE2); await app.settle(); pending.reject(Error('private old load error')); await app.settle();
    assert.ok(app.content().includes('CMPT 225')); assert.ok(!app.content().includes('Unable to load classmates'));
    pass('Stale failures cannot replace a new course with an error screen');
  }
  console.log('Classmate messaging entry checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
