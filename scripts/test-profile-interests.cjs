/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const catalog = require('../src/constants/interest-catalog.json');
const all = catalog.flatMap(group => group.interests.map(item => ({ ...item, id: item.slug, isActive: true })));
const old = ['anime', 'coding', 'coffee', 'gym', 'hiking', 'reading', 'soccer', 'study-groups', 'ui-design'];
const textOf = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let checks = 0;
const pass = label => { ++checks; console.log('PASS ' + label); };

function harness(file, options = {}) {
  let slots = [], cursor = 0, dirty = true, effects = [], tree, props = options.props ?? {};
  const state = { id: 'account-a', saved: [all.find(item => item.slug === 'coding')], failSave: false, ...options.state };
  let profile = { id: state.id, displayName: 'Alex', major: 'Computing', yearOfStudy: 2, isDiscoverable: true, avatarPath: null };
  const calls = [], interestQueue = [], savedQueue = [];
  const equal = (a, b) => a?.length === b?.length && a.every((item, i) => Object.is(item, b[i]));
  const react = {
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(value) { const i = cursor++; if (!slots[i]) slots[i] = { value: typeof value === 'function' ? value() : value };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(value) { const i = cursor++; if (!slots[i]) slots[i] = { current: value }; return slots[i]; },
    useCallback(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { callback, deps }; return slots[i].callback; },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i]) slots[i] = {};
      const slot = slots[i]; if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); }); },
  };
  const api = {
    getInterests: async () => interestQueue.length ? interestQueue.shift().promise : all,
    getProfileInterests: async id => { calls.push(['load', id]); return savedQueue.length ? savedQueue.shift().promise : state.saved; },
    getProfileSocialLinks: async () => ({}),
    replaceProfileInterests: async (id, ids) => { calls.push(['save', id, [...ids]]); if (state.failSave) throw Error('Offline. Try again.'); state.saved = all.filter(item => ids.includes(item.id)); },
    replaceProfileSocialLinks: async () => {},
  };
  const mocks = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/motion': require('./motion-test-mock.cjs'),
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
    '@/context/LegalDocumentsProvider': { LegalDocumentsProvider: 'LegalDocumentsProvider' },
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', TextInput: 'TextInput',
      ScrollView: 'ScrollView', Switch: 'Switch', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, StyleSheet: { create: value => value } },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-image': { Image: 'Image' }, 'expo-image-picker': {},
    'expo-router': { useRouter: () => ({ push() {}, back() {} }), useFocusEffect: callback => react.useEffect(callback, [callback]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/context/AccountDeletionProvider': { DeleteAccountButton: 'DeleteAccountButton' },
    '@/context/AuthContext': { useAuth: () => ({ user: { id: state.id } }) },
    '@/context/ProfileContext': { useProfile: () => ({ profile, saveProfile: async value => {
      calls.push(['profile', value]); profile = { ...profile, ...value }; dirty = true;
    } }) },
    '@/lib/profiles': api, '@/lib/avatars': { getProfileAvatarSignedUrl: async () => null },
    '@/components/ScreenHeader': { __esModule: true, default: 'ScreenHeader' },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const exports = {}; cache.set(filename, exports);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { exports, require(name) {
      if (name in mocks) return mocks[name];
      let target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      if (!fs.existsSync(target)) target += fs.existsSync(target + '.tsx') ? '.tsx' : '.ts';
      return load(target);
    } }); return exports;
  }
  const mod = load(path.join(root, file));
  function render() {
    let rounds = 0;
    while (dirty) {
      assert.ok(++rounds < 50, 'render settles'); dirty = false; cursor = 0;
      if (options.hook) tree = mod.useInterestSelection(state.id);
      else if (options.form) { const outer = mod.default(); tree = outer.type(outer.props); }
      else tree = mod.default({ ...props, onToggle: id => { props.selectedIds = props.selectedIds.includes(id) ? props.selectedIds.filter(item => item !== id) : [...props.selectedIds, id]; dirty = true; } });
      while (effects.length) effects.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 7; ++i) { render(); await new Promise(setImmediate); } render(); }
  const find = predicate => { const item = nodes(tree).find(predicate); assert.ok(item, 'Expected control'); return item; };
  function press(label) { const item = find(n => n.type === 'Pressable' && (n.props.accessibilityLabel === label || textOf(n) === label));
    if (!item.props.disabled) item.props.onPress(); render(); }
  function changeInput(label, value) { find(n => n.type === 'TextInput' && (n.props.accessibilityLabel === label || n.props.placeholder === label)).props.onChangeText(value); render(); }
  render();
  return { state, calls, savedQueue, interestQueue, settle, press, changeInput, find, content: () => textOf(tree), value: () => tree,
    change: values => { props = { ...props, ...values }; dirty = true; render(); },
    render: () => { dirty = true; render(); },
    cleanup: () => slots.forEach(slot => slot?.cleanup?.()),
    switchId: id => { state.id = id; dirty = true; render(); },
  };
}

(async () => {
  assert.equal(catalog.length, 8); assert.equal(all.length, 96); assert.equal(new Set(all.map(i => i.slug)).size, 96);
  old.forEach(slug => assert.ok(all.some(i => i.slug === slug)));
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261026091824_expand_student_interests.sql'), 'utf8');
  all.forEach(item => assert.ok(sql.includes(`('${item.slug}', '${item.displayName}')`)));
  assert.ok(sql.includes('ON CONFLICT (slug) DO NOTHING'));
  pass('96 unique student interests preserve all nine original slugs and match the additive migration');

  const picker = harness('src/components/InterestPicker.tsx', { props: { interests: all, selectedIds: ['coding'] } });
  picker.changeInput('Search interests', 'badminton'); picker.press('Badminton');
  assert.ok(picker.content().includes('2 selected')); picker.press('Remove Coding');
  assert.ok(picker.content().includes('1 selected'));
  picker.changeInput('Search interests', 'not-an-interest');
  assert.ok(picker.content().includes('No interests found')); assert.ok(picker.content().includes('Badminton'));
  picker.press('Remove Badminton'); assert.ok(picker.content().includes('0 selected'));
  pass('search and no-results preserve selected choices; selected chips remove choices across filters');
  picker.press('Music'); assert.ok(picker.content().includes('Classical Music'));
  picker.changeInput('Search interests', 'UI DESIGN'); picker.press('UI Design');
  assert.ok(picker.content().includes('1 selected'));
  picker.press('Clear interest search'); picker.press('Show more Sports & outdoors interests');
  assert.ok(picker.content().includes('Volleyball'));
  picker.changeInput('Search interests', 'UI Design');
  picker.change({ disabled: true });
  const before = picker.content(); picker.press('Remove UI Design'); assert.equal(picker.content(), before);
  assert.equal(picker.find(n => n.props?.accessibilityLabel === 'UI Design' && n.props.accessibilityRole === 'checkbox').props.accessibilityState.checked, true);
  assert.equal(picker.find(n => n.props?.accessibilityLabel === 'UI Design' && n.props.accessibilityRole === 'checkbox').props['aria-checked'], true,
    'React Native Web must receive its supported checked prop as well');
  pass('categories, case-insensitive search, expansion and accessible disabled/selected controls work');

  const unknown = harness('src/components/InterestPicker.tsx', { props: { interests: [...all, { id: 'future', slug: 'future-interest', displayName: 'Future interest', isActive: true }], selectedIds: [] } });
  unknown.changeInput('Search interests', 'future'); unknown.press('Future interest');
  assert.ok(unknown.content().includes('More interests')); assert.ok(unknown.content().includes('1 selected'));
  pass('future catalog additions remain selectable in a fallback category');

  const card = harness('src/components/ProfileInterests.tsx', { props: { profileId: 'account-a' } });
  assert.equal(card.find(n => n.type === 'LoadingSkeleton').props.variant, 'interests');
  assert.doesNotMatch(card.content(), /Add a few favorites/);
  await card.settle(); assert.match(card.content(), /Coding/);
  const nextInterests = deferred(); card.savedQueue.push(nextInterests);
  card.change({ profileId: 'account-b' });
  assert.doesNotMatch(card.content(), /Coding/);
  assert.equal(card.find(n => n.type === 'LoadingSkeleton').props.label, 'Loading your interests');
  nextInterests.resolve([]); await card.settle();
  assert.match(card.content(), /Add a few favorites/);
  card.cleanup();
  pass('profile interests reserve their layout during first load and never expose the previous account while switching');

  const hook = harness('src/hooks/useInterestSelection.ts', { hook: true }); await hook.settle();
  const stale = deferred(); hook.savedQueue.push(stale); hook.value().loadInterests();
  hook.state.saved = [all.find(i => i.slug === 'hiking')]; hook.switchId('account-b'); await hook.settle();
  stale.resolve([all.find(i => i.slug === 'coffee')]); await hook.settle();
  assert.deepEqual([...hook.value().selectedInterestIds], ['hiking']);
  pass('late interest reads from a previous account cannot replace current-account selections');
  const failure = deferred(); hook.interestQueue.push(failure); const loading = hook.value().loadInterests(); failure.reject(Error('offline'));
  await loading; await hook.settle(); assert.ok(hook.value().interestError); assert.deepEqual([...hook.value().selectedInterestIds], ['hiking']);
  await hook.value().loadInterests(); await hook.settle(); assert.equal(hook.value().interestError, null);
  pass('failed catalog loads preserve selections and retry successfully');

  for (const file of ['onboarding', 'settings']) {
    const form = harness(`src/app/profile/${file}.tsx`, { form: true }); await form.settle();
    assert.ok(!form.content().includes('Campus'));
    form.changeInput('Alex Rivera', 'Alex');
    const select = () => form.find(n => typeof n.type === 'function' && n.type.name === 'InterestPicker');
    select().props.onToggle('badminton'); form.render();
    const submit = file === 'settings' ? 'Save changes' : 'Continue';
    // Button labels are a product contract; use the real form's submit control.
    const buttons = nodes(form.value()).filter(n => n.type === 'Pressable');
    const save = buttons.find(n => /save|continue|finish/i.test(textOf(n)) && n.props.onPress);
    assert.ok(save, `Missing ${submit}`);
    form.state.failSave = true;
    save.props.onPress(); save.props.onPress();
    await form.settle();
    assert.equal(form.calls.filter(call => call[0] === 'save').length, 1, 'rapid taps must not start duplicate profile writes');
    assert.ok(form.content().includes('Offline')); assert.ok(select().props.selectedIds.includes('badminton'));
    form.state.failSave = false; save.props.onPress(); await form.settle();
    assert.equal(form.calls.filter(call => call[0] === 'save').length, 2, 'a failed save can be retried');
    const saved = form.calls.find(call => call[0] === 'profile'); assert.ok(saved);
    assert.equal('campusId' in saved[1], false); assert.ok(select().props.selectedIds.includes('badminton'));
    assert.equal(form.calls.filter(call => call[0] === 'load').length, 1, 'saving core profile must not reload and erase unsaved interest edits');
    pass(`${file}: repeated taps share one save; offline failure preserves choices and successful retry persists interests`);
    form.cleanup();
  }
  console.log(`Profile interests: ${checks} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
