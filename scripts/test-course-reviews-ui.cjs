/* global __dirname */
// Exercise the actual course review screen with controlled accounts, focus and RPC outcomes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'account-a';
const B = 'account-b';
const fall = { id: 'fall', displayName: 'Fall 2026' };
const summer = { id: 'summer', displayName: 'Summer 2026' };
const grades = ['F', 'D', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const tags = ['Useful', 'Interesting', 'Practical skills', 'Lots of reading', 'Group work', 'Exam heavy', 'Project based', 'Participation matters'];
const review = (extra = {}) => ({ id: 'review-1', termId: fall.id, termName: fall.displayName,
  difficulty: 2, workload: 4, recommend: true, grade: 'B+', comment: 'Practice each week and ask questions.',
  tips: 'Work on the practice exercises.', instructor: 'Test instructor', tags: ['Useful'],
  createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', isMine: true, ...extra });
const summary = (extra = {}) => ({ courseCode: 'CMPT 120', title: 'Introduction to Computing', reviewCount: 0,
  averageDifficulty: null, averageWorkload: null, recommendPercent: null,
  gradeCounts: grades.map(grade => ({ grade, count: 0 })), topTags: [], eligibleTerms: [fall], pastTerms: [], myReviews: [], ...extra });
const page = (reviews = [], nextCursor = null) => ({ reviews, nextCursor });
const copy = value => JSON.parse(JSON.stringify(value));
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
function harness(adminAllowed = false) {
  let slots = [], focusEffects = new Set(), normalEffects = new Set(), effectQueue = [];
  let cursor = 0, dirty = true, focused = true, tree, currentKey, userId = A, code = 'CMPT 120';
  let appState = 'active';
  const appStateListeners = new Set();
  const summaries = [], pages = [], saves = [], deletes = [], navigation = [];
  const equal = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    Fragment: 'Fragment',
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
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
  const record = target => (...args) => { const pending = deferred(); target.push({ args, ...pending }); return pending.promise; };
  const modules = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/motion': require('./motion-test-mock.cjs'),
    '../../lib/useDirectAdmin': { useDirectAdmin: () => ({ allowed: adminAllowed, open: (targetType, targetId) => navigation.push({ pathname: '/moderation/direct', params: { targetType, targetId } }) }) },
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Text: 'Text',
      TextInput: 'TextInput', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, StyleSheet: { create: value => value },
      AppState: { get currentState() { return appState; }, addEventListener: (name, listener) => {
        assert.equal(name, 'change'); appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) };
      } } },
    'expo-router': { useFocusEffect, useRouter: () => ({ back: () => blur(), push: value => navigation.push(value) }), useLocalSearchParams: () => ({ code }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@/context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '@/lib/courseReviews': { getCourseReviewSummary: record(summaries), getCourseReviews: record(pages),
      saveCourseReview: record(saves), deleteCourseReview: record(deletes) },
    '@/types/courseReview': { COURSE_GRADES: grades, COURSE_REVIEW_TAGS: tags },
    '@/components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/app/courses/reviews.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Error, console,
    require: name => { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; } });
  function reset() {
    for (const effect of [...focusEffects, ...normalEffects]) effect.cleanup?.();
    slots = []; focusEffects = new Set(); normalEffects = new Set(); effectQueue = [];
  }
  function expand(node) {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  function render() {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 100, 'Render settles'); dirty = false;
      const outer = exports.default();
      if (currentKey !== outer?.props.key) { reset(); currentKey = outer?.props.key; }
      cursor = 0; tree = outer ? expand(outer.type(outer.props)) : null;
      while (effectQueue.length) effectQueue.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 6; i++) { render(); await new Promise(setImmediate); } render(); }
  function blur() { if (!focused) return; focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } }
  function focus() { if (focused) return; focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function findButton(label) {
    return nodes(tree).find(node => node.type === 'Pressable' && (textOf(node) === label || node.props.accessibilityLabel === label));
  }
  function button(label) { const found = findButton(label); assert.ok(found, 'Missing button ' + label); return found; }
  function press(label) { const found = button(label); assert.ok(!found.props.disabled, label + ' is enabled'); found.props.onPress(); render(); }
  function input(label) { const found = nodes(tree).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label); assert.ok(found, 'Missing input ' + label); return found; }
  return {
    render, settle, blur, focus, button, press, input, summaries, pages, saves, deletes, navigation,
    exists: label => Boolean(findButton(label)), content: () => textOf(tree), allNodes: () => nodes(tree),
    type: (label, value) => { input(label).props.onChangeText(value); render(); },
    switchAccount: id => { userId = id; dirty = true; render(); },
    switchCourse: value => { code = value; dirty = true; render(); },
    appState: state => { appState = state; for (const listener of appStateListeners) listener(state); render(); },
  };
}
async function ready(overview = summary(), firstPage = page()) {
  const app = harness(); await app.settle();
  app.summaries[0].resolve(overview); app.pages[0].resolve(firstPage); await app.settle(); return app;
}
function fill(app) {
  app.press('Write a review'); app.press('Difficulty 2 out of 5'); app.press('Workload 4 out of 5');
  app.press('Yes'); app.press('B+'); app.press('Useful');
  app.type('Your course review', 'Practice each week and ask questions.');
  app.type('Study tips', 'Work on the practice exercises.'); app.type('Course instructor', 'Test instructor');
}
let checks = 0;
async function test(name, run) { await run(); checks += 1; console.log('PASS ' + name); }
(async () => {
  await test('admin can open review actions without revealing or reporting its author', async () => {
    const app = harness(true); await app.settle();
    app.summaries[0].resolve(summary()); app.pages[0].resolve(page([review({ isMine: false })])); await app.settle();
    app.press('Admin actions'); assert.equal(app.navigation.at(-1).pathname, '/moderation/direct');
    assert.deepEqual(app.navigation.at(-1).params, { targetType: 'course_review', targetId: 'review-1' });
    const stale = app.button('Admin actions').props.onPress; app.blur(); stale(); assert.equal(app.navigation.length, 1);
  });
  await test('empty shared course page has no fabricated statistics or grade chart', async () => {
    const app = harness(); await app.settle();
    assert.equal(app.allNodes().find(node => node.type === 'LoadingSkeleton')?.props.variant, 'reviews');
    assert.equal(app.exists('Write a review'), false);
    app.summaries[0].resolve(summary()); app.pages[0].resolve(page()); await app.settle();
    assert.equal(app.allNodes().filter(node => node.type === 'LoadingSkeleton').length, 0);
    assert.deepEqual(app.summaries[0].args, ['CMPT 120', A]);
    assert.match(app.content(), /0 reviews/); assert.match(app.content(), /No grades shared yet/);
    assert.match(app.content(), /Student-reported grades, not official SFU results/);
    assert.match(app.content(), /Reviews are anonymous to other students/);
    assert.equal(app.exists('Write a review'), true);
  });
  await test('a server without historical terms keeps upcoming-only memberships read-only', async () => {
    const other = review({ isMine: false, termId: summer.id, termName: summer.displayName });
    const app = await ready(summary({ eligibleTerms: [], reviewCount: 1 }), page([other]));
    assert.equal(app.exists('Write a review'), false); assert.match(app.content(), /You can read reviews without adding this course/);
    assert.match(app.content(), /Anonymous student/); assert.match(app.content(), /Summer 2026/);
    assert.doesNotMatch(app.content(), /account-a|account-b|Test account/);
  });
  const oldTerm = { id: 'summer-2018', displayName: 'Summer 2018', year: 2018, season: 'summer' };
  const recentPast = { id: 'spring-2025', displayName: 'Spring 2025', year: 2025, season: 'spring' };
  await test('a student without a membership can choose a past term, save once and see their anonymous review', async () => {
    const app = await ready(summary({ title: 'CMPT 120', eligibleTerms: [], pastTerms: [recentPast, oldTerm] }));
    assert.equal(app.content().match(/CMPT 120/g).length, 1);
    app.press('Write a review'); app.press('Save review');
    assert.equal(app.saves.length, 0); assert.match(app.content(), /Choose the year and semester/);
    app.press('Choose year'); assert.equal(app.button('More recent years').props.disabled, true);
    app.press('Earlier years'); assert.equal(app.button('Earlier years').props.disabled, true);
    app.press('2018'); assert.equal(app.exists('Fall 2026'), false);
    app.press('Summer 2018');
    app.press('Difficulty 3 out of 5'); app.press('Workload 2 out of 5'); app.press('Yes'); app.press('B+');
    app.type('Your course review', 'The weekly labs were helpful.');
    app.press('Save review'); app.saves[0].reject(Error('Please retry.')); await app.settle();
    assert.equal(app.button('Summer 2018').props.accessibilityState.selected, true);
    app.press('Save review'); assert.deepEqual(copy(app.saves[0].args), copy(app.saves[1].args));
    assert.equal(app.saves[1].args[2].termId, oldTerm.id);
    app.saves[1].resolve('saved'); await app.settle();
    const mine = review({ id: 'saved', termId: oldTerm.id, termName: oldTerm.displayName });
    app.summaries[1].resolve(summary({ eligibleTerms: [], pastTerms: [recentPast, oldTerm], reviewCount: 1, myReviews: [mine] }));
    app.pages[1].resolve(page([mine])); await app.settle();
    app.press('Edit your Summer 2018 review'); assert.equal(app.exists('Choose year'), false);
    assert.equal(app.input('Your course review').props.value, mine.comment);
    const returning = await ready(summary({ eligibleTerms: [], pastTerms: [recentPast, oldTerm], myReviews: [mine] }));
    returning.press('Write a review'); returning.press('Choose year'); returning.press('Earlier years'); returning.press('2018');
    assert.equal(returning.button('Summer 2018 (reviewed)').props.disabled, true);
  });
  await test('switching between enrolled and historical terms keeps answers and clears stale term selections', async () => {
    const app = await ready(summary({ pastTerms: [recentPast, oldTerm] }));
    app.press('Write a review'); app.type('Your course review', 'I took this class years ago.');
    app.press('Choose a past term'); app.press('Choose year'); app.press('2025'); app.press('Spring 2025');
    app.press('Change year from 2025'); app.press('Earlier years'); app.press('2018');
    app.press('Save review'); assert.match(app.content(), /Choose the year and semester/);
    app.press('Use a term from my courses'); assert.equal(app.button('Fall 2026').props.accessibilityState.selected, true);
    assert.equal(app.input('Your course review').props.value, 'I took this class years ago.');
  });
  await test('required choices and review length prevent premature submission', async () => {
    const app = await ready(); app.press('Write a review'); app.press('Save review');
    assert.equal(app.saves.length, 0); assert.match(app.content(), /Choose a difficulty/);
    app.press('Difficulty 2 out of 5'); app.press('Workload 4 out of 5'); app.press('Yes');
    app.type('Your course review', 'short'); app.press('Save review');
    assert.equal(app.saves.length, 0); assert.match(app.content(), /between 10 and 2,000/);
    app.type('Your course review', 'A useful course review.'); app.press('Save review');
    assert.equal(app.saves.length, 1); assert.equal(app.saves[0].args[2].grade, null);
  });
  await test('offline save keeps all answers; retry is serialized and refreshes chart after confirmed save', async () => {
    const app = await ready(); fill(app);
    const save = app.button('Save review').props.onPress; save(); save(); app.render(); assert.equal(app.saves.length, 1);
    assert.deepEqual(copy(app.saves[0].args), ['CMPT 120', A, {
      termId: 'fall', difficulty: 2, workload: 4, recommend: true, grade: 'B+',
      comment: 'Practice each week and ask questions.', tips: 'Work on the practice exercises.',
      instructor: 'Test instructor', tags: ['Useful'],
    }]);
    app.saves[0].reject(Error('Check your connection and retry.')); await app.settle();
    assert.equal(app.input('Your course review').props.value, 'Practice each week and ask questions.');
    assert.equal(app.input('Study tips').props.value, 'Work on the practice exercises.');
    assert.equal(app.button('Difficulty 2 out of 5').props.accessibilityState.selected, true);
    assert.equal(app.button('B+').props.accessibilityState.selected, true);
    assert.equal(app.button('Useful').props.accessibilityState.selected, true);
    app.press('Save review'); assert.deepEqual(copy(app.saves[1].args), copy(app.saves[0].args));
    app.saves[1].resolve('review-1'); await app.settle();
    assert.equal(app.summaries.length, 2); assert.equal(app.pages.length, 2);
    const saved = review(); app.summaries[1].resolve(summary({ reviewCount: 1, averageDifficulty: 2, averageWorkload: 4,
      recommendPercent: 100, gradeCounts: grades.map(grade => ({ grade, count: grade === 'B+' ? 1 : 0 })), myReviews: [saved] }));
    app.pages[1].resolve(page([saved])); await app.settle();
    assert.match(app.content(), /Your review was saved/); assert.match(app.content(), /1 reported grade/);
    assert.equal(app.exists('Save review'), false); assert.equal(app.exists('Write a review'), false);
    assert.ok(app.allNodes().some(node => node.props.accessibilityLabel === 'B+: 1 review'));
  });
  await test('owned review remains editable after course removal and changing a grade reloads aggregates', async () => {
    const mine = review(); const app = await ready(summary({ eligibleTerms: [], myReviews: [mine], reviewCount: 1 }), page([mine]));
    app.press('Edit your Fall 2026 review'); assert.equal(app.input('Your course review').props.value, mine.comment);
    assert.equal(app.exists('Fall 2026'), false, 'Existing review term is fixed text, not a selector');
    app.press('A'); app.press('Save review'); assert.equal(app.saves[0].args[2].termId, fall.id); assert.equal(app.saves[0].args[2].grade, 'A');
    app.saves[0].resolve(mine.id); await app.settle();
    assert.equal(app.summaries.length, 2); assert.equal(app.pages.length, 2);
  });
  await test('deletion asks for confirmation, retries after failure and removes the reviewed term from summary', async () => {
    const mine = review(); const app = await ready(summary({ myReviews: [mine], reviewCount: 1 }), page([mine]));
    app.press('Delete your Fall 2026 review'); assert.equal(app.deletes.length, 0); app.press('Keep review');
    assert.equal(app.deletes.length, 0); app.press('Delete your Fall 2026 review');
    const remove = app.button('Delete review').props.onPress; remove(); remove(); app.render();
    assert.equal(app.deletes.length, 1); assert.deepEqual(app.deletes[0].args, [mine.id, A]);
    app.deletes[0].reject(Error('Connection lost.')); await app.settle(); assert.match(app.content(), /Connection lost/);
    app.press('Delete review'); app.deletes[1].resolve(); await app.settle();
    app.summaries[1].resolve(summary()); app.pages[1].resolve(page()); await app.settle();
    assert.match(app.content(), /Your review was removed/); assert.equal(app.exists('Write a review'), true);
    assert.equal(app.exists('Delete your Fall 2026 review'), false);
  });
  await test('pagination retries the same cursor, guards double taps and appends each review once', async () => {
    const cursor = { createdAt: '2026-10-01T12:00:00Z', id: 'review-1' };
    const app = await ready(summary({ eligibleTerms: [] }), page([review({ isMine: false })], cursor));
    const older = app.button('Load older reviews').props.onPress; older(); older(); app.render();
    assert.equal(app.pages.length, 2); assert.deepEqual(app.pages[1].args[2], cursor);
    app.pages[1].reject(Error('Offline.')); await app.settle(); assert.match(app.content(), /Practice each week/);
    app.press('Retry older reviews'); assert.deepEqual(app.pages[2].args[2], cursor);
    app.pages[2].resolve(page([review({ isMine: false }), review({ id: 'review-2', isMine: false, comment: 'An older experience.', termName: summer.displayName })])); await app.settle();
    assert.equal(app.content().split('Practice each week and ask questions.').length - 1, 1);
    assert.match(app.content(), /An older experience/); assert.equal(app.exists('Load older reviews'), false);
  });
  await test('foreground refresh preserves unsaved draft and selected ratings', async () => {
    const app = await ready(); fill(app); app.appState('background'); app.appState('active');
    assert.equal(app.summaries.length, 2); app.summaries[1].resolve(summary()); app.pages[1].resolve(page()); await app.settle();
    assert.equal(app.input('Your course review').props.value, 'Practice each week and ask questions.');
    assert.equal(app.button('Workload 4 out of 5').props.accessibilityState.selected, true);
    assert.equal(app.button('B+').props.accessibilityState.selected, true);
  });
  for (const transition of ['account', 'route', 'blur']) {
    await test(`late overview response is ignored after ${transition} transition`, async () => {
      const app = harness(); await app.settle();
      if (transition === 'account') app.switchAccount(B);
      else if (transition === 'route') app.switchCourse('MATH 150');
      else { app.blur(); app.focus(); }
      app.summaries[1].resolve(summary({ title: 'Fresh overview', eligibleTerms: [] })); app.pages[1].resolve(page()); await app.settle();
      app.summaries[0].resolve(summary({ title: 'Stale account overview' })); app.pages[0].resolve(page([review({ comment: 'Private stale content.' })])); await app.settle();
      assert.match(app.content(), /Fresh overview/); assert.doesNotMatch(app.content(), /Stale account overview|Private stale content/);
    });
  }
  for (const transition of ['account', 'route', 'blur']) {
    await test(`late save cannot show confirmation or leak draft after ${transition} transition`, async () => {
      const app = await ready(); fill(app); const oldSave = app.button('Save review').props.onPress; app.press('Save review');
      if (transition === 'account') app.switchAccount(B);
      else if (transition === 'route') app.switchCourse('MATH 150');
      else app.blur();
      oldSave(); assert.equal(app.saves.length, 1);
      app.saves[0].resolve('review-1'); await app.settle(); assert.doesNotMatch(app.content(), /Your review was saved/);
      if (transition !== 'blur') {
        app.summaries[1].resolve(summary({ eligibleTerms: [] })); app.pages[1].resolve(page()); await app.settle();
        assert.equal(app.exists('Save review'), false); assert.doesNotMatch(app.content(), /Practice each week/);
      }
    });
  }
  await test('late pagination result cannot repopulate a freshly refreshed page', async () => {
    const cursor = { createdAt: '2026-10-01T12:00:00Z', id: 'review-1' };
    const app = await ready(summary(), page([review()], cursor)); app.press('Load older reviews'); app.press('Refresh course reviews');
    app.summaries[1].resolve(summary()); app.pages[2].resolve(page()); await app.settle();
    app.pages[1].resolve(page([review({ comment: 'Stale pagination row.' })])); await app.settle();
    assert.doesNotMatch(app.content(), /Stale pagination row/);
  });
  await test('a failed overview refresh retains existing reviews and provides a retry', async () => {
    const app = await ready(summary(), page([review()])); app.press('Refresh course reviews');
    assert.equal(app.allNodes().filter(node => node.type === 'LoadingSkeleton').length, 0);
    assert.match(app.content(), /Practice each week/);
    app.summaries[1].reject(Error('Unable to load reviews.')); app.pages[1].resolve(page()); await app.settle();
    assert.match(app.content(), /Practice each week/); assert.match(app.content(), /Unable to load reviews/);
    app.press('Retry loading reviews'); assert.equal(app.summaries.length, 3);
  });
  await test('only another student anonymous review has a report action and the route carries no author or review content', async () => {
    const other = review({ id: 'a4140000-0000-4000-8000-000000000031', isMine: false });
    const app = await ready(summary(), page([review(), other, review({ id: 'unknown', isMine: undefined })]));
    const buttons = app.allNodes().filter(node => node.props.accessibilityLabel === 'Report review');
    assert.equal(buttons.length, 1); const control = buttons[0];
    assert.equal(control.props.accessibilityRole, 'button');
    assert.ok(control.props.style.minHeight >= 48 && control.props.style.minWidth >= 48);
    fill(app); const text = app.input('Your course review').props.value;
    app.press('Report review');
    assert.deepEqual(copy(app.navigation), [{ pathname: '/safety/report', params: { targetType: 'course_review', targetId: other.id } }]);
    assert.equal(app.input('Your course review').props.value, text);
    assert.equal(app.saves.length, 0); assert.equal(app.deletes.length, 0);
    assert.doesNotMatch(app.content(), /account-a|account-b/);
  });
  for (const transition of ['account', 'route', 'blur', 'background']) {
    await test(`review report action rejects a stale tap after ${transition}`, async () => {
      const other = review({ isMine: false });
      const app = await ready(summary(), page([other]));
      const captured = app.button('Report review').props.onPress;
      if (transition === 'account') app.switchAccount(B);
      else if (transition === 'route') app.switchCourse('MATH 150');
      else if (transition === 'blur') { app.blur(); app.render(); }
      else app.appState('background');
      captured(); assert.equal(app.navigation.length, 0);
      if (transition === 'blur' || transition === 'background') {
        assert.equal(app.button('Report review').props.disabled, true);
        assert.equal(app.button('Report review').props.accessibilityState.disabled, true);
      }
    });
  }
  await test('a refreshed own or removed review rejects a previously captured report tap', async () => {
    for (const nextReviews of [[], [review({ isMine: true })]]) {
      const app = await ready(summary(), page([review({ isMine: false })]));
      const captured = app.button('Report review').props.onPress;
      app.press('Refresh course reviews'); app.summaries[1].resolve(summary()); app.pages[1].resolve(page(nextReviews));
      await app.settle(); captured();
      assert.equal(app.exists('Report review'), false); assert.equal(app.navigation.length, 0);
    }
  });
  await test('reporting cannot interrupt an in-flight review save', async () => {
    const app = await ready(summary(), page([review({ isMine: false })])); fill(app);
    const captured = app.button('Report review').props.onPress;
    app.press('Save review'); captured();
    assert.equal(app.button('Report review').props.disabled, true);
    assert.equal(app.navigation.length, 0); assert.equal(app.saves.length, 1);
  });
  await test('hidden review can be revised with its saved values and keeps the draft on failure', async () => {
    const mine = review({ isHidden: true });
    const app = await ready(summary({ myReviews: [mine] }), page());
    assert.match(app.content(), /Hidden by moderation/);
    assert.equal(app.exists('Write a review'), false);
    app.press('Edit your Fall 2026 review');
    assert.equal(app.input('Your course review').props.value, mine.comment);
    assert.match(app.content(), /Your revision will be public; the original stays hidden/);
    app.input('Your course review').props.onChangeText('A constructive revised course review.'); app.render();
    app.press('Save review'); app.saves[0].reject(Error('Connection lost.')); await app.settle();
    assert.equal(app.input('Your course review').props.value, 'A constructive revised course review.');
    assert.match(app.content(), /Connection lost/);
    app.press('Save review'); assert.deepEqual(app.saves[1].args, app.saves[0].args);
    app.saves[1].resolve('replacement'); await app.settle();
    app.summaries[1].resolve(summary({ myReviews: [review({ id: 'replacement' })], reviewCount: 1 }));
    app.pages[1].resolve(page([review({ id: 'replacement' })])); await app.settle();
    assert.doesNotMatch(app.content(), /Hidden by moderation/);
  });
  await test('discarding a hidden review confirms evidence retention and allows a fresh review', async () => {
    const mine = review({ isHidden: true });
    const app = await ready(summary({ myReviews: [mine] }), page());
    app.press('Delete your Fall 2026 review');
    assert.match(app.content(), /Moderators keep the original record/);
    assert.equal(app.deletes.length, 0);
    app.press('Delete review'); app.deletes[0].resolve(); await app.settle();
    app.summaries[1].resolve(summary()); app.pages[1].resolve(page()); await app.settle();
    assert.equal(app.exists('Write a review'), true);
    app.press('Write a review'); assert.equal(app.input('Your course review').props.value, '');
  });
  console.log(`Course reviews UI: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
