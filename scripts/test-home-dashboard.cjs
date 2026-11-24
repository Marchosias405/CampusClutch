/* global __dirname */
// Exercise the Home screen's loading lifecycle and destinations without network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/(tabs)/index.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props.children) : String(node);
const course = (id, current = true) => ({ id, code: 'CMPT ' + id, title: 'Course ' + id, current });

function home() {
  const reads = [], routes = [], slots = [], snapshots = [];
  let user = { id: 'student-a' }, profile = { id: 'student-a', displayName: '  Alex Rivera  ' };
  let tree, cursor, dirty = true, nextEffect, effect, cleanup, focused = true;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
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
      ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
      StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ width: 320, fontScale: 2 }),
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons', FontAwesome5: 'FontAwesome5' },
    'expo-router': { useRouter: () => ({ push: route => routes.push(route) }) },
    '@react-navigation/native': { useFocusEffect: callback => { nextEffect = callback; } },
    '@/context/AuthContext': { useAuth: () => ({ user }) },
    '@/context/ProfileContext': { useProfile: () => ({ profile }) },
    '../../components/ScreenHeader': 'ScreenHeader', '../../components/NotificationBell': 'NotificationBell',
    '@/lib/courses': {
      getMyCourses: accountId => new Promise((resolve, reject) => reads.push({ accountId, resolve, reject })),
      isCurrentCourse: item => item.current,
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, console: { error() {} }, require(name) {
    assert.ok(name in modules, 'Unexpected import ' + name); return modules[name];
  } });
  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(++count < 30, 'Home render must settle');
      dirty = false; cursor = 0; tree = exports.default(); snapshots.push(text(tree));
      if (focused && effect !== nextEffect) { cleanup?.(); effect = nextEffect; cleanup = effect(); }
    }
  }
  const button = label => nodes(tree).find(node => node.type === 'Pressable' &&
    (node.props.accessibilityLabel === label || text(node) === label));
  function press(label) {
    const control = button(label);
    assert.ok(control && !control.props.disabled, 'Expected enabled ' + label);
    control.props.onPress(); render();
  }
  async function settle() { await new Promise(setImmediate); render(); }
  function blur() { cleanup?.(); cleanup = undefined; focused = false; effect = undefined; }
  function focus() { focused = true; dirty = true; render(); }
  function switchUser(id, displayName) {
    user = id ? { id } : null;
    if (displayName !== undefined) profile = { id, displayName };
    dirty = true; render();
  }
  render();
  return { reads, routes, snapshots, button, press, settle, blur, focus, switchUser, loaders: type => nodes(tree).filter(node => node.type === type), text: () => text(tree) };
}

test('Home uses the signed-in name and only current courses, with working navigation', async () => {
  const app = home();
  assert.match(app.text(), /Hi, Alex Rivera/);
  assert.equal(app.loaders('LoadingSkeleton')[0]?.props.label, 'Loading courses…');
  assert.equal(app.button('Add a course'), undefined, 'Loading is not an empty result');
  app.reads[0].resolve([course('120'), course('363', false)]);
  await app.settle();
  assert.match(app.text(), /CMPT 120/); assert.doesNotMatch(app.text(), /CMPT 363/);
  app.press('CMPT 120, Course 120. View classmates');
  assert.equal(app.routes[0].pathname, '/courses/classmates'); assert.equal(app.routes[0].params.courseId, '120');
  app.press('View points'); app.press('View all courses'); app.press('Find a campus request');
  assert.deepEqual(app.routes.slice(1), ['/(tabs)/profile', '/courses', '/requests']);
});

test('an empty successful response offers Add a course and routes to the picker', async () => {
  const app = home(); app.reads[0].resolve([]); await app.settle();
  app.press('Add a course'); assert.deepEqual(app.routes, ['/courses/add']);
  assert.doesNotMatch(app.text(), /Loading courses|Unable to refresh/);
});

test('initial failure shows retry rather than empty state, and rapid retries issue one read', async () => {
  const app = home(); app.reads[0].reject(new Error('offline')); await app.settle();
  assert.match(app.text(), /Check your connection/); assert.equal(app.button('Add a course'), undefined);
  assert.equal(app.loaders('LoadingSkeleton').length, 0, 'Errors remain actionable instead of loading forever');
  const retry = app.button('Retry home courses').props.onPress;
  app.press('Retry home courses'); retry();
  assert.equal(app.reads.length, 2);
  app.reads[1].resolve([course('120')]); await app.settle();
  assert.match(app.text(), /CMPT 120/); assert.doesNotMatch(app.text(), /Check your connection/);
});

test('returning to Home preserves courses during a pending or offline refresh and retry recovers', async () => {
  const app = home(); app.reads[0].resolve([course('120')]); await app.settle();
  app.blur(); app.focus(); assert.match(app.text(), /CMPT 120/);
  assert.equal(app.loaders('LoadingSkeleton').length, 0);
  assert.equal(app.loaders('LoadingNotice').length, 0, 'Focus refresh must not shift existing cards');
  app.reads[1].reject(new Error('offline')); await app.settle();
  assert.match(app.text(), /CMPT 120/); assert.match(app.text(), /Check your connection/);
  assert.equal(app.button('Add a course'), undefined);
  app.press('Retry home courses'); assert.match(app.text(), /CMPT 120/);
  app.reads[2].resolve([course('125')]); await app.settle();
  assert.match(app.text(), /CMPT 125/); assert.doesNotMatch(app.text(), /CMPT 120|Check your connection/);
});

test('an account change immediately hides previous courses/name and ignores the old response', async () => {
  const app = home(); app.reads[0].resolve([course('120')]); await app.settle();
  app.blur(); app.focus();
  const after = app.snapshots.length;
  app.switchUser('student-b');
  assert.equal(app.reads[2].accountId, 'student-b');
  assert.match(app.text(), /Hi, Student/); assert.doesNotMatch(app.text(), /Alex Rivera|CMPT 120/);
  app.reads[1].resolve([course('125')]); await app.settle();
  assert.equal(app.loaders('LoadingSkeleton')[0]?.props.label, 'Loading courses…'); assert.doesNotMatch(app.text(), /CMPT 125/);
  app.reads[2].resolve([course('363')]); await app.settle();
  assert.match(app.text(), /CMPT 363/);
  for (const snapshot of app.snapshots.slice(after)) assert.doesNotMatch(snapshot, /Alex Rivera|CMPT 120|CMPT 125/);
  app.switchUser(null); assert.doesNotMatch(app.text(), /CMPT 363/); assert.equal(app.reads.length, 3);
});

test('responses after blur cannot overwrite a newer focused read or release its in-flight guard', async () => {
  const app = home(); app.blur(); app.focus();
  app.reads[0].reject(new Error('old failure')); await app.settle();
  assert.doesNotMatch(app.text(), /Check your connection/);
  app.reads[1].resolve([course('120')]); await app.settle();
  assert.match(app.text(), /CMPT 120/);
  app.blur(); app.focus(); app.blur();
  app.reads[2].resolve([course('125')]); await app.settle();
  assert.doesNotMatch(app.text(), /CMPT 125/);
  app.focus(); assert.equal(app.reads.length, 4);
  app.reads[3].resolve([]); await app.settle();
  assert.ok(app.button('Add a course'));
});
