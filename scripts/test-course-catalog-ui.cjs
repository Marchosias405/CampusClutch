/* global __dirname */
// Run the actual course screens with controlled focus, accounts, timers and network responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'account-a';
const B = 'account-b';
const fall = { id: 'fall', displayName: 'Fall 2026', year: 2026, season: 'fall', status: 'current' };
const spring = { id: 'spring', displayName: 'Spring 2027', year: 2027, season: 'spring', status: 'upcoming' };
const course = (id = 'course-1', term = fall, extra = {}) => ({ id, code: 'CMPT 120', title: 'Introduction to Computing',
  term, status: 'active', campusDisplayName: 'Burnaby', units: 3, membershipStatus: 'enrolled', ...extra });
const page = (courses, nextCursor = null) => ({ courses, nextCursor });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const textOf = node => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props.children);
function nodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(item => nodes(item, result)); return result; }
  result.push(node); nodes(node.props.children, result); return result;
}
function harness(screen = 'add', initial = {}) {
  let slots = [], focusEffects = new Set(), normalEffects = new Set(), effectQueue = [];
  let cursor = 0, dirty = true, focused = true, tree, currentKey;
  let userId = A, timerId = 0;
  const timers = new Map(), calls = [], searches = [], joins = [], leaves = [], navigation = [];
  const memberships = new Map([[A, initial.memberships ?? []], [B, []]]), membershipQueue = [];
  const equal = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    Fragment: 'Fragment',
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initialValue) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
      const slot = slots[index];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; }
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
  const api = {
    getAcademicTerms: async () => { calls.push(['terms']); return [fall, spring]; },
    getMyCourses: async id => {
      calls.push(['memberships', id]);
      return membershipQueue.length ? membershipQueue.shift().promise : memberships.get(id) ?? [];
    },
    searchCourseCatalog: (...args) => {
      const result = deferred(); searches.push({ args, ...result }); return result.promise;
    },
    joinCourse: (...args) => { const result = deferred(); joins.push({ args, ...result }); return result.promise; },
    leaveCourse: (...args) => { const result = deferred(); leaves.push({ args, ...result }); return result.promise; },
    isCurrentCourse: item => item.term.status === 'current' && item.membershipStatus === 'enrolled' && item.status !== 'archived',
    isUpcomingCourse: item => item.term.status === 'upcoming' && item.membershipStatus === 'enrolled' && item.status !== 'archived',
    isPreviousCourse: item => item.membershipStatus !== 'left' && (item.term.status === 'past' || item.membershipStatus === 'completed'),
    courseDetailsLabel: item => [item.deliveryMode === 'online' ? 'Online' : item.campusDisplayName,
      item.units == null ? null : `${item.units} units`].filter(Boolean).join(' · '),
  };
  const modules = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Text: 'Text',
      TextInput: 'TextInput', ScrollView: 'ScrollView', StyleSheet: { create: value => value } },
    '@react-navigation/native': { useFocusEffect },
    'expo-router': { useRouter: () => ({ push: value => navigation.push(value), back: () => blur() }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons', FontAwesome5: 'FontAwesome5' },
    '@/context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '@/lib/courses': api,
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
  };
  const filename = screen === 'add' ? 'src/app/courses/add.tsx' : 'src/app/(tabs)/courses.tsx';
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, console,
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    require: name => { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; },
  });
  function reset() {
    for (const effect of [...focusEffects, ...normalEffects]) effect.cleanup?.();
    slots = []; focusEffects = new Set(); normalEffects = new Set(); effectQueue = [];
  }
  function render() {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 100, 'Render settles'); dirty = false;
      const outer = exports.default();
      if (currentKey !== outer?.props.key) { reset(); currentKey = outer?.props.key; }
      cursor = 0; tree = outer ? outer.type(outer.props) : null;
      while (effectQueue.length) effectQueue.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 6; i++) { render(); await new Promise(setImmediate); } render(); }
  function advance() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(run => run()); render(); }
  function blur() { if (!focused) return; focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } }
  function focus() { if (focused) return; focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function button(label) {
    const found = nodes(tree).find(node => node.type === 'Pressable'
      && (textOf(node) === label || node.props.accessibilityLabel === label));
    assert.ok(found, 'Missing button ' + label); return found;
  }
  function press(label) { const found = button(label); assert.ok(!found.props.disabled, label + ' is enabled'); found.props.onPress(); render(); }
  function select(id = 'CMPT 120') {
    const found = nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityRole === 'radio'
      && node.props.accessibilityLabel.startsWith(id + ','));
    assert.ok(found, 'Missing course ' + id); found.props.onPress(); render(); return found;
  }
  return {
    render, settle, advance, blur, focus, button, press, select, searches, joins, leaves, navigation, calls, memberships, membershipQueue,
    content: () => textOf(tree), allNodes: () => nodes(tree),
    query: value => { nodes(tree).find(node => node.type === 'TextInput').props.onChangeText(value); render(); },
    switchAccount: id => { userId = id; dirty = true; render(); },
  };
}
let checks = 0;
async function test(name, run) { await run(); checks += 1; console.log('PASS ' + name); }
async function ready(initial) { const app = harness('add', initial); await app.settle(); app.advance(); return app; }
(async () => {
  await test('focus loads terms and only this account memberships before starting bounded term search', async () => {
    const app = await ready();
    assert.deepEqual(app.calls, [['terms'], ['memberships', A]]);
    assert.equal(app.searches.length, 1); assert.equal(app.searches[0].args[0].id, fall.id);
    app.searches[0].resolve(page([course()])); await app.settle();
    assert.match(app.content(), /Burnaby · 3 units/);
  });
  await test('typing is debounced and earlier search responses cannot replace a new query', async () => {
    const app = await ready(); app.query('C'); app.query('CM'); app.query('CMPT');
    assert.equal(app.searches.length, 1); app.advance(); assert.equal(app.searches.length, 2);
    assert.equal(app.searches[1].args[1], 'CMPT');
    app.searches[1].resolve(page([course('new', fall, { title: 'Newest result' })])); await app.settle();
    app.searches[0].resolve(page([course('old', fall, { title: 'Stale result' })])); await app.settle();
    assert.match(app.content(), /Newest result/); assert.doesNotMatch(app.content(), /Stale result/);
  });
  await test('changing query immediately clears selection and blocks a captured old join handler', async () => {
    const app = await ready(); app.searches[0].resolve(page([course()])); await app.settle();
    const oldRow = app.select(); const oldAdd = app.button('Add CMPT 120').props.onPress;
    app.query('Math'); oldRow.props.onPress(); oldAdd(); await app.settle();
    assert.equal(app.joins.length, 0); assert.equal(app.button('Select a course').props.disabled, true);
  });
  await test('term switch clears previous pages and selection, labels Spring coverage and rejects stale responses', async () => {
    const app = await ready(); app.searches[0].resolve(page([course()])); await app.settle(); app.select();
    const oldAdd = app.button('Add CMPT 120').props.onPress;
    app.press('Spring 2027'); oldAdd(); app.advance();
    assert.equal(app.joins.length, 0); assert.equal(app.searches[1].args[0].id, spring.id);
    app.searches[1].resolve(page([course('spring-course', spring, { campusDisplayName: null, deliveryMode: 'online', units: 4 })]));
    await app.settle();
    assert.match(app.content(), /Spring 2027 undergraduate courses · 3\+ units/);
    assert.match(app.content(), /Online · 4 units/);
  });
  await test('load more serializes taps, appends once and retries the same cursor after a failure', async () => {
    const app = await ready(); const cursor = { code: 'CMPT 120', id: 'course-1' };
    app.searches[0].resolve(page([course()], cursor)); await app.settle();
    const loadMore = app.button('Load more courses').props.onPress; loadMore(); loadMore(); app.render();
    assert.equal(app.searches.length, 2); assert.deepEqual(app.searches[1].args[2], cursor);
    app.searches[1].reject(Error('offline')); await app.settle();
    assert.match(app.content(), /Introduction to Computing/);
    app.press('Retry course search'); assert.deepEqual(app.searches[2].args[2], cursor);
    app.searches[2].resolve(page([course(), course('course-2', fall, { code: 'MATH 150' })])); await app.settle();
    assert.equal(app.allNodes().filter(node => node.props.accessibilityRole === 'radio').length, 2);
    assert.doesNotMatch(app.content(), /Load more courses/);
  });
  await test('an unfinished previous-term search cannot overwrite Spring results or cursor', async () => {
    const app = await ready(); app.press('Spring 2027'); app.advance();
    app.searches[1].resolve(page([course('spring-new', spring, { title: 'Spring result' })])); await app.settle();
    app.searches[0].resolve(page([course('fall-old', fall, { title: 'Late fall result' })], { code: 'CMPT 120', id: 'fall-old' }));
    await app.settle();
    assert.match(app.content(), /Spring result/); assert.doesNotMatch(app.content(), /Late fall result|Load more courses/);
  });
  await test('initial search failure is retryable, does not pretend the catalog is empty', async () => {
    const app = await ready(); app.searches[0].reject(Error('private server detail')); await app.settle();
    assert.doesNotMatch(app.content(), /No active courses|private server detail/);
    app.press('Retry course search'); assert.equal(app.searches[1].args[2], null);
    app.searches[1].resolve(page([])); await app.settle();
    assert.match(app.content(), /No active courses are available for Fall 2026/);
  });
  await test('join is serialized, account-pinned and duplicate success disables another addition', async () => {
    const app = await ready(); app.searches[0].resolve(page([course()])); await app.settle(); app.select();
    const join = app.button('Add CMPT 120').props.onPress; join(); join(); app.render();
    assert.deepEqual(app.joins[0].args, ['course-1', A]); assert.equal(app.joins.length, 1);
    app.query('blocked'); assert.equal(app.searches.length, 1);
    app.joins[0].resolve('already_enrolled'); await app.settle();
    assert.equal(app.button('Already added').props.disabled, true);
    assert.match(app.content(), /Find classmates in this course/);
  });
  await test('failed join preserves the selection and retries that course without clearing the form', async () => {
    const app = await ready(); app.searches[0].resolve(page([course()])); await app.settle(); app.select(); app.press('Add CMPT 120');
    app.joins[0].reject(Error('offline')); await app.settle();
    assert.match(app.content(), /Your selection is kept/); app.press('Add CMPT 120');
    assert.deepEqual(app.joins[1].args, ['course-1', A]);
    app.joins[1].resolve('joined'); await app.settle(); assert.match(app.content(), /Course added to My Courses/);
  });
  await test('upcoming join points to Upcoming and does not offer classmates before the term starts', async () => {
    const app = await ready(); app.press('Spring 2027'); app.advance();
    app.searches[1].resolve(page([course('spring-course', spring)])); await app.settle(); app.select(); app.press('Add CMPT 120');
    app.joins[0].resolve('joined'); await app.settle();
    assert.match(app.content(), /under Upcoming/); assert.doesNotMatch(app.content(), /Find classmates in this course/);
  });
  for (const transition of ['blur', 'account']) {
    await test(`late catalog and join responses cannot update the screen after ${transition}`, async () => {
      const app = await ready(); app.searches[0].resolve(page([course()])); await app.settle(); app.select(); app.press('Add CMPT 120');
      if (transition === 'blur') app.blur(); else app.switchAccount(B);
      app.joins[0].resolve('joined'); await app.settle();
      assert.doesNotMatch(app.content(), /Course added to My Courses/);
      if (transition === 'blur') app.focus(); await app.settle(); app.advance();
      assert.equal(app.button('Select a course').props.disabled, true);
      assert.equal(app.calls.filter(call => call[0] === 'memberships').at(-1)[1], transition === 'account' ? B : A);
    });
  }
  await test('a late first-page response is ignored after account switch', async () => {
    const app = await ready(); app.switchAccount(B); await app.settle(); app.advance();
    app.searches[1].resolve(page([course('b', fall, { title: 'Account B result' })])); await app.settle();
    app.searches[0].resolve(page([course('a', fall, { title: 'Old account result' })])); await app.settle();
    assert.match(app.content(), /Account B result/); assert.doesNotMatch(app.content(), /Old account result/);
  });
  await test('My Courses shows persisted Upcoming memberships with metadata and no classmates action', async () => {
    const app = harness('mine', { memberships: [course('future', spring)] }); await app.settle(); app.press('Upcoming');
    assert.match(app.content(), /CMPT 120/); assert.match(app.content(), /Spring 2027/); assert.match(app.content(), /Burnaby · 3 units/);
    assert.equal(app.allNodes().filter(node => node.type === 'Pressable' && textOf(node) === 'Classmates').length, 0);
    app.blur(); app.focus(); await app.settle(); assert.match(app.content(), /CMPT 120/);
    app.switchAccount(B); await app.settle(); assert.doesNotMatch(app.content(), /CMPT 120/);
  });
  await test('upcoming membership removal has explicit confirmation and account-pinned serialized retry', async () => {
    const app = harness('mine', { memberships: [course('future', spring)] }); await app.settle(); app.press('Upcoming');
    const scrolls = [];
    app.allNodes().find(node => node.type === 'ScrollView' && node.props.ref).props.ref.current = { scrollTo: value => scrolls.push(value) };
    app.press('Remove CMPT 120');
    assert.equal(scrolls[0].y, 0); assert.equal(scrolls[0].animated, true);
    assert.equal(app.leaves.length, 0); app.press('Keep course'); assert.equal(app.leaves.length, 0);
    app.press('Remove CMPT 120'); const remove = app.button('Remove course').props.onPress; remove(); remove(); app.render();
    assert.equal(app.leaves.length, 1); assert.deepEqual(app.leaves[0].args, ['future', A]);
    app.leaves[0].reject(Error('offline')); await app.settle(); assert.match(app.content(), /Please try again/);
    app.press('Remove course'); app.memberships.set(A, []); app.leaves[1].resolve('left'); await app.settle();
    assert.match(app.content(), /haven't added any upcoming courses/); assert.doesNotMatch(app.content(), /CMPT 120/);
  });
  await test('My Courses late old-account loads cannot expose previous memberships', async () => {
    const app = harness('mine'); const old = deferred(); app.membershipQueue.push(old); app.render();
    app.switchAccount(B); await app.settle(); old.resolve([course('secret')]); await app.settle();
    assert.doesNotMatch(app.content(), /CMPT 120/);
  });
  console.log(`Course catalog UI: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
