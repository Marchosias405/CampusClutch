/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/_layout.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function navigator() {
  let retries = 0;
  const auth = {
    session: null, isRestoringSession: true, restorationError: null, isPasswordRecovery: false,
    retrySessionRestore: async () => { retries++; },
  };
  const profile = { profile: null, profileError: null, isLoadingProfile: false, isProfileComplete: false };
  const element = (type, props) => ({ type, props });
  const Stack = { Protected: 'Stack.Protected', Screen: 'Stack.Screen' };
  const mocks = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
    '@/context/LegalDocumentsProvider': { LegalDocumentsProvider: 'LegalDocumentsProvider' },
    react: { useState: initial => [initial, () => {}] },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' },
    'expo-router': { Stack },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', ActivityIndicator: 'ActivityIndicator',
      StyleSheet: { create: styles => styles } },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    'react-native-reanimated': {},
    '@react-navigation/native': { ThemeProvider: 'ThemeProvider' },
    '@/context/AuthContext': { AuthProvider: 'AuthProvider', useAuth: () => auth },
    '@/context/ProfileContext': { ProfileProvider: 'ProfileProvider', useProfile: () => profile },
    '@/context/RequestsContext': { RequestsProvider: 'RequestsProvider' },
    '@/context/NotificationsContext': { NotificationsProvider: 'NotificationsProvider' },
    '@/context/UnreadMessagesContext': { UnreadMessagesProvider: 'UnreadMessagesProvider' },
    '@/lib/useAndroidPush': { useAndroidPush() {} },
    '@/lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: false },
    '@/context/AccountDeletionProvider': { AccountDeletionProvider: 'AccountDeletionProvider' },
    '@/components/AccountStandingGate': { default: 'AccountStandingGate' },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { assert.ok(name in mocks, 'Unexpected import ' + name); return mocks[name]; } }, { filename });

  function render() {
    const routes = [], labels = [], buttons = [], loading = [];
    function visit(node) {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (typeof node === 'string') { labels.push(node); return; }
      if (!node || typeof node !== 'object') return;
      const { type, props } = node;
      if (typeof type === 'function') { visit(type(props)); return; }
      if (type === Stack.Protected && !props.guard) return;
      if (type === Stack.Screen) routes.push(props.name);
      if (type === 'LoadingState') loading.push(props);
      if (type === 'Pressable') buttons.push(props);
      visit(props.children);
    }
    visit(exports.default());
    return { routes, labels, buttons, loading };
  }
  return { auth, profile, render, retries: () => retries };
}

test('startup waits for restoration before offering sign-in or recovery links', () => {
  const app = navigator();
  const pending = app.render();
  assert.deepEqual(pending.routes, []);
  assert.equal(pending.loading.length, 1);
  assert.equal(pending.loading[0].title, 'Opening Clu');
  assert.equal(pending.loading[0].detail, 'Restoring your session');
  app.auth.isRestoringSession = false;
  const { routes } = app.render();
  for (const name of ['(auth)/sign-in', '(auth)/sign-up', '(auth)/forgot-password', 'auth/callback', 'auth/reset-password']) {
    assert.ok(routes.includes(name), name);
  }
  assert.ok(!routes.includes('(tabs)') && !routes.includes('profile/onboarding'));
  assert.ok(!routes.includes('moderation/index') && !routes.includes('moderation/[id]'));
});

test('a failed restoration can be retried without exposing private screens or raw errors', () => {
  const app = navigator();
  Object.assign(app.auth, { isRestoringSession: false, restorationError: 'simulated internal detail' });
  const failed = app.render();
  assert.deepEqual(failed.routes, []);
  assert.equal(failed.loading.length, 0, 'A failed restoration must stop the waiting screen');
  assert.match(failed.labels.join(' '), /Unable to restore your session/i);
  assert.doesNotMatch(failed.labels.join(' '), /simulated internal detail/);
  const retry = failed.buttons.find(button => button.children?.props?.children === 'Retry');
  assert.ok(retry && !retry.disabled);
  retry.onPress();
  assert.equal(app.retries(), 1);
});

test('a restored account waits for its profile and only receives eligible routes', () => {
  const app = navigator();
  Object.assign(app.auth, { isRestoringSession: false, session: { user: { id: 'student' } } });
  app.profile.isLoadingProfile = true;
  assert.deepEqual(app.render().routes, []);
  assert.equal(app.render().loading[0].title, 'Loading your profile');
  Object.assign(app.profile, { isLoadingProfile: false, profile: { id: 'student' } });
  const onboarding = app.render().routes;
  assert.ok(onboarding.includes('profile/onboarding'));
  assert.ok(!onboarding.includes('(tabs)') && !onboarding.includes('(auth)/sign-in'));
  assert.ok(!onboarding.includes('moderation/index') && !onboarding.includes('moderation/[id]'));
  app.profile.isProfileComplete = true;
  const complete = app.render().routes;
  assert.ok(complete.includes('(tabs)') && complete.includes('messages/[id]'));
  assert.ok(complete.includes('moderation/index') && complete.includes('moderation/[id]'));
  assert.ok(!complete.includes('profile/onboarding') && !complete.includes('(auth)/sign-in'));
});

test('a password-recovery session reaches reset even while the normal profile is loading', () => {
  const app = navigator();
  Object.assign(app.auth, { session: { user: { id: 'student' } }, isPasswordRecovery: true, isRestoringSession: false });
  Object.assign(app.profile, { profile: { id: 'student' }, isLoadingProfile: true, isProfileComplete: true });
  assert.deepEqual(app.render().routes, ['auth/reset-password']);
});
