/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  const filename = path.join(__dirname, '../src', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  return new vm.Script(outputText, { filename });
}
const provider = compile('context/ProfileContext.tsx');
const tab = compile('app/(tabs)/profile.tsx');
const layout = compile('app/_layout.tsx');
const alice = { id: 'a', displayName: 'Alice Park', onboardingCompletedAt: '2026-11-01', isDiscoverable: false };
const bo = { id: 'b', displayName: 'Bo Hill', onboardingCompletedAt: '2026-11-01', isDiscoverable: true };
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}

// Render the real providers and screens with controllable storage and network timing.
function mount(script, mocks, draw) {
  const slots = [], effects = [];
  let cursor = 0;
  function memo(factory, deps) {
    const i = cursor++;
    if (!slots[i] || deps.some((dep, index) => !Object.is(dep, slots[i].deps[index]))) {
      slots[i] = { value: factory(), deps };
    }
    return slots[i].value;
  }
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useCallback: (fn, deps) => memo(() => fn, deps),
    useMemo: memo,
    useRef: value => memo(() => ({ current: value }), []),
    useState(initial) {
      const box = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []);
      return [box.value, next => { box.value = typeof next === 'function' ? next(box.value) : next; }];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const previous = slots[i];
      if (previous && deps.every((dep, index) => Object.is(dep, previous.deps[index]))) return;
      slots[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    },
  };
  const renderedComponents = new Set();
  const element = (type, props) => renderedComponents.has(type) ? type(props) : ({ type, props });
  const modules = { '@/context/AccountDeletionProvider': { DeleteAccountButton: 'DeleteAccountButton', AccountDeletionProvider: 'AccountDeletionProvider' }, ...mocks, react, 'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' } };
  function requireModule(name) {
    if (name.endsWith('/ProfileActionRow') && !(name in modules)) {
      const row = {};
      compile('components/ProfileActionRow.tsx').runInNewContext({ exports: row, require: requireModule });
      modules[name] = row;
      renderedComponents.add(row.default);
    }
    assert.ok(name in modules, 'Unexpected dependency ' + name);
    return modules[name];
  }
  const exports = {};
  script.runInNewContext({ exports, require: requireModule });
  function render() {
    cursor = 0;
    const tree = draw(exports);
    while (effects.length) effects.shift()();
    return tree;
  }
  return render;
}
function account(id = 'a', restoring = false) {
  const auth = { user: id ? { id } : null, isRestoringSession: restoring };
  const reads = [], saves = [];
  const render = mount(provider, {
    '@/context/AuthContext': { useAuth: () => auth },
    '@/lib/profiles': {
      getProfileById(id) {
        const job = { ...deferred(), id };
        reads.push(job);
        return job.promise;
      },
      updateProfile(id, input) {
        const job = { ...deferred(), id, input };
        saves.push(job);
        return job.promise;
      },
    },
  }, module => module.ProfileProvider({ children: null }).props.value);
  return { render, auth, reads, saves };
}

test('restoring and signed-out accounts make no reads and cannot save a profile', async () => {
  const app = account(null, true);
  app.render();
  app.auth.isRestoringSession = false;
  const state = app.render();
  assert.equal(state.profile, null);
  assert.equal(state.isLoadingProfile, false);
  assert.equal(state.isProfileComplete, false);
  await assert.rejects(state.saveProfile({ displayName: 'Edited' }));
  assert.equal(app.saves.length, 0);
  assert.equal(app.reads.length, 0);
});

test('an offline profile can be retried, a missing profile stays distinct, and completion requires a name', async () => {
  const app = account();
  assert.equal(app.render().isLoadingProfile, true);
  app.reads[0].reject(Error('unavailable'));
  await tick();
  const failed = app.render();
  assert.ok(failed.profileError);
  assert.equal(failed.isLoadingProfile, false);
  const firstRetry = failed.refreshProfile();
  assert.equal(app.render().profileError, null);
  app.reads[1].resolve(null);
  await firstRetry;
  const missing = app.render();
  assert.equal(missing.profile, null);
  assert.equal(missing.profileError, null);
  assert.equal(missing.isLoadingProfile, false);
  const retry = missing.refreshProfile();
  app.reads[2].resolve({ ...alice, displayName: null });
  await retry;
  assert.equal(app.render().isProfileComplete, false);
  const save = app.render().saveProfile({ displayName: alice.displayName });
  assert.deepEqual(app.saves[0].input, { displayName: alice.displayName });
  app.saves[0].resolve(alice);
  assert.equal(await save, alice);
  assert.equal(app.render().isProfileComplete, true);
});

test('switching accounts immediately hides the previous profile and ignores its pending refresh', async () => {
  const app = account();
  app.render();
  app.reads[0].resolve(alice);
  await tick();
  const old = app.render();
  const late = old.refreshProfile();
  app.auth.user = { id: bo.id };
  const switching = app.render();
  assert.equal(switching.profile, null);
  assert.equal(switching.isProfileComplete, false);
  assert.equal(switching.isLoadingProfile, true);
  assert.equal(app.reads[2].id, bo.id);
  app.reads[2].resolve(bo);
  await tick();
  app.reads[1].reject(Error('old account offline'));
  await late;
  const current = app.render();
  assert.equal(current.profile, bo);
  assert.equal(current.profileError, null);
  assert.equal(current.isLoadingProfile, false);
});

test('a delayed save after sign-out never replaces the next account profile', async () => {
  const app = account();
  app.render();
  app.reads[0].resolve(alice);
  await tick();
  const save = app.render().saveProfile({ displayName: 'Updated' });
  app.auth.user = null;
  app.render();
  app.auth.user = { id: bo.id };
  app.render();
  app.reads[1].resolve(bo);
  await tick();
  const updated = { ...alice, displayName: 'Updated' };
  app.saves[0].resolve(updated);
  assert.equal(await save, updated);
  assert.equal(app.render().profile, bo);
});

test('late reads cannot undo a newer refresh or a confirmed edit to the same account', async () => {
  const app = account();
  const first = app.render();
  const retry = first.refreshProfile();
  app.reads[1].resolve(alice);
  await retry;
  app.reads[0].reject(Error('old request'));
  await tick();
  assert.equal(app.render().profile, alice);
  const late = app.render().refreshProfile();
  const updated = { ...alice, displayName: 'Changed' };
  const save = app.render().saveProfile({ displayName: updated.displayName });
  app.saves[0].resolve(updated);
  await save;
  app.reads[2].resolve(alice);
  await late;
  assert.equal(app.render().profile, updated);
  assert.equal(app.render().isLoadingProfile, false);
});

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== 'object') return [];
  return [element, ...nodes(element.props.children)];
}
function textOf(element) {
  if (Array.isArray(element)) return element.map(textOf).join('');
  if (typeof element === 'string') return element;
  return element?.props ? textOf(element.props.children) : '';
}
function button(element, label) {
  const target = nodes(element).find(n => n.type === 'Pressable' && textOf(n) === label);
  assert.ok(target, 'Missing button ' + label);
  return target.props;
}
const native = { StyleSheet: { create: styles => styles }, ActivityIndicator: 'Spinner', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', View: 'View' };
function ownTab(profile, auth, signAvatar = async () => null) {
  const navigation = [];
  const render = mount(tab, {
    '@/context/AuthContext': { useAuth: () => auth },
    '@/context/ProfileContext': { useProfile: () => ({ profile }) },
    '@/lib/avatars': { getProfileAvatarSignedUrl: signAvatar },
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-image': { Image: 'Image' },
    'expo-router': { useRouter: () => ({ push: route => navigation.push(route) }) },
    'react-native': native,
    '../../components/ScreenHeader': 'Header', '../../components/ProfileInterests': 'Interests',
    '../../components/PointsBalance': 'Points', '../../components/RatingSummary': 'Rating',
    '../../components/ModerationEntry': 'ModerationEntry',
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
  }, module => module.default());
  return { render, navigation };
}

test('Profile shows the student name, visibility, own interests and rating, and opens Edit Profile', () => {
  for (const profile of [alice, bo]) {
    const app = ownTab(profile, { user: { id: profile.id } });
    const page = app.render();
    assert.ok(textOf(page).includes(profile.displayName));
    assert.ok(textOf(page).includes(profile.isDiscoverable ? 'Visible to other students' : 'Profile is private'));
    for (const type of ['Interests', 'Rating']) {
      assert.equal(nodes(page).find(n => n.type === type).props.profileId, profile.id);
    }
    const settings = nodes(page).find(n => n.type === 'Pressable' && nodes(n).some(c => c.props.name === 'settings-sharp'));
    settings.props.onPress();
    assert.deepEqual(app.navigation, ['/profile/settings']);
  }
});

test('a failed avatar request falls back from the spinner to the student’s initials', async () => {
  const photo = deferred();
  const app = ownTab({ ...alice, avatarPath: 'a/photo' }, { user: { id: alice.id } }, () => photo.promise);
  assert.ok(nodes(app.render()).some(n => n.type === 'Spinner'));
  photo.reject(Error('offline'));
  await tick();
  const page = app.render();
  assert.ok(textOf(page).includes('AP'));
  assert.ok(!nodes(page).some(n => n.type === 'Spinner' || n.type === 'Image'));
});

function rootProfile(profile, auth) {
  const Stack = { Screen: 'Screen', Protected: 'Protected' };
  return mount(layout, {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
    '@/context/LegalDocumentsProvider': { LegalDocumentsProvider: 'LegalDocumentsProvider' },
    '@react-navigation/native': { ThemeProvider: 'Theme' }, 'expo-router': { Stack },
    'expo-status-bar': { StatusBar: 'StatusBar' }, 'react-native': native, 'react-native-reanimated': {},
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeArea' },
    '@/context/AuthContext': { useAuth: () => auth, AuthProvider: 'Auth' },
    '@/context/ProfileContext': { useProfile: () => profile, ProfileProvider: 'Profile' },
    '@/context/RequestsContext': { RequestsProvider: 'Requests' },
    '@/context/NotificationsContext': { NotificationsProvider: 'Notifications' },
    '@/context/UnreadMessagesContext': { UnreadMessagesProvider: 'Unread' },
    '@/lib/useAndroidPush': { useAndroidPush() {} }, '@/lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: false },
    '@/components/AccountStandingGate': { default: 'AccountStandingGate', __esModule: true },
  }, module => {
    const boundary = nodes(module.default()).find(n => typeof n.type === 'function');
    assert.ok(boundary);
    return boundary.type();
  });
}
test('the profile loading, offline and missing screens hide private routes and offer the correct retry', () => {
  let attempts = 0;
  const profile = { isLoadingProfile: true, profile: null, refreshProfile: () => { attempts++; } };
  const render = rootProfile(profile, { session: { user: { id: alice.id } } });
  assert.equal(nodes(render()).find(n => n.type === 'LoadingState')?.props.title, 'Loading your profile');
  profile.isLoadingProfile = false;
  profile.profileError = 'internal network error';
  const offline = render();
  assert.match(textOf(offline), /Unable to load your profile/);
  assert.ok(!nodes(offline).some(n => n.type === 'LoadingState'), 'Error recovery replaces the waiting panel');
  assert.doesNotMatch(textOf(offline), /internal network error/);
  button(offline, 'Retry').onPress();
  profile.profileError = null;
  const missing = render();
  assert.match(textOf(missing), /Profile unavailable/);
  button(missing, 'Retry').onPress();
  assert.ok(button(missing, 'Sign Out'));
  assert.equal(attempts, 2);
  for (const page of [offline, missing]) assert.ok(!nodes(page).some(n => n.type === 'Screen'));
});

for (const location of ['Profile', 'missing profile']) {
  test(location + ' lets the user retry sign-out after returned or rejected failures', async () => {
    for (const rejects of [false, true]) {
      const result = deferred();
      let attempts = 0;
      const auth = { user: { id: alice.id }, session: { user: { id: alice.id } },
        signOut: () => { attempts++; return attempts === 1 ? result.promise : Promise.resolve(null); } };
      const render = location === 'Profile' ? ownTab(alice, auth).render : rootProfile({ profile: null }, auth);
      const label = location === 'Profile' ? 'Log Out' : 'Sign Out';
      button(render(), label).onPress();
      assert.ok(nodes(render()).some(n => n.type === 'Pressable' && n.props.disabled));
      if (rejects) result.reject(Error('transport failed'));
      else result.resolve({ message: 'transport failed' });
      await tick();
      const failed = render();
      assert.match(textOf(failed), /Unable to sign out/);
      assert.ok(!button(failed, label).disabled);
      button(failed, label).onPress();
      await tick();
      assert.equal(attempts, 2);
    }
  });
}


test('rapid Profile Log Out taps share one pending operation and allow retry after failure', async () => {
  const result = deferred();
  let attempts = 0;
  const app = ownTab(alice, { user: { id: alice.id }, signOut: () => {
    attempts++;
    return attempts === 1 ? result.promise : Promise.resolve(null);
  } });
  const action = button(app.render(), 'Log Out');
  action.onPress(); action.onPress();
  assert.equal(attempts, 1);
  assert.ok(nodes(app.render()).some(n => n.props.accessibilityState?.busy));
  result.resolve({ message: 'offline' });
  await tick();
  button(app.render(), 'Log Out').onPress();
  await tick();
  assert.equal(attempts, 2);
});
