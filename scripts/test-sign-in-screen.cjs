/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/(auth)/sign-in.tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? textOf(node.props.children) : String(node);
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props.children)];
}

const emailPlaceholder = 'student@example.com';
const passwordPlaceholder = 'Enter your password';
const email = ' student@example.com ';
const password = '  test fixture password  ';

function screen(params = {}) {
  const state = [], calls = [], routes = [];
  let tree, cursor;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useRef(initial) { return state[cursor++] ??= { current: initial }; },
  };
  const mocks = {
    '@/assets/images/splash-icon.png': 1,
    '@/components/motion': require('./motion-test-mock.cjs'),
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
    '@/context/LegalDocumentsProvider': { LegalDocumentsProvider: 'LegalDocumentsProvider' },
    react,
    'react-native': { Image: 'Image',
      ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'TextInput', 'Text', 'View', 'ScrollView', 'KeyboardAvoidingView'].map(type => [type, type])),
      StyleSheet: { create: styles => styles }, Platform: { OS: 'android' },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: route => routes.push(route), replace: route => routes.push(route) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    '@/context/AuthContext': { useAuth: () => ({
      signIn: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
    }) },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { assert.ok(name in mocks, 'Unexpected import ' + name); return mocks[name]; } });
  function render() { cursor = 0; tree = exports.default(); }
  function find(predicate, description) {
    const control = nodes(tree).find(predicate);
    assert.ok(control, 'Expected ' + description);
    return control.props;
  }
  const input = placeholder => find(node => node.type === 'TextInput' && node.props.placeholder === placeholder, placeholder);
  const button = label => find(node => node.type === 'Pressable' && (textOf(node) === label || node.props.accessibilityLabel === label), label);
  function fill(placeholder, value) {
    const field = input(placeholder);
    assert.notEqual(field.editable, false);
    field.onChangeText(value);
    render();
  }
  function press(label) { const props = button(label); assert.ok(!props.disabled); props.onPress(); render(); }
  function enterCredentials() { fill(emailPlaceholder, email); fill(passwordPlaceholder, password); }
  async function settle() { await new Promise(setImmediate); render(); }
  render();
  return { input, button, enterCredentials, fill, press, render, calls, routes, settle,
    text: () => textOf(tree), busy: () => nodes(tree).some(node => node.type === 'ActivityIndicator') };
}

test('missing email or password stays on the form without an auth request', () => {
  const app = screen();
  app.fill(emailPlaceholder, ' ');
  app.fill(passwordPlaceholder, password);
  app.press('Sign In');
  assert.match(app.text(), /both your email address and password/i);
  app.fill(emailPlaceholder, email);
  app.fill(passwordPlaceholder, '');
  app.input(passwordPlaceholder).onSubmitEditing();
  app.render();
  assert.match(app.text(), /both your email address and password/i);
  assert.equal(app.calls.length, 0);
});

test('showing a password and opening recovery or registration do not submit credentials', () => {
  const app = screen();
  app.enterCredentials();
  assert.equal(app.input(passwordPlaceholder).secureTextEntry, true);
  app.press('Show password');
  assert.equal(app.input(passwordPlaceholder).secureTextEntry, false);
  assert.equal(app.input(passwordPlaceholder).value, password);
  app.press('Hide password');
  assert.equal(app.input(passwordPlaceholder).secureTextEntry, true);
  app.press('Forgot password?');
  app.press('New to Clu? Create Account');
  assert.deepEqual(app.routes, ['/forgot-password', '/sign-up']);
  assert.equal(app.calls.length, 0);
});

test('invalid credentials and throttling keep the form editable for a successful retry', async () => {
  const app = screen();
  app.enterCredentials();
  for (const [status, expected] of [[400, /check your email and password/i], [429, /too many sign-in attempts/i]]) {
    app.press('Sign In');
    app.calls.at(-1).resolve({ status, message: 'provider-only detail' });
    await app.settle();
    assert.match(app.text(), expected);
    assert.doesNotMatch(app.text(), /provider-only detail/);
    assert.equal(app.input(passwordPlaceholder).value, password);
    assert.equal(app.input(emailPlaceholder).editable, true);
  }
  app.fill(passwordPlaceholder, 'corrected fixture password');
  app.press('Sign In');
  assert.deepEqual(app.calls[2].args, [email.trim(), 'corrected fixture password']);
  app.calls[2].resolve(null);
  await app.settle();
  assert.ok(app.busy(), 'the auth navigator handles successful sign-in');
  assert.doesNotMatch(app.text(), /too many sign-in attempts/i);
  assert.deepEqual(app.routes, []);
});

test('keyboard submit and a button tap before redraw start only one attempt', async () => {
  const app = screen();
  app.enterCredentials();
  const tap = app.button('Sign In').onPress;
  app.input(passwordPlaceholder).onSubmitEditing();
  tap();
  app.render();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.calls[0].args, [email.trim(), password]);
  assert.equal(app.input(passwordPlaceholder).editable, false);
  assert.equal(app.button('Forgot password?').disabled, true);
  assert.equal(app.button('New to Clu? Create Account').disabled, true);
  app.calls[0].resolve(null);
  await app.settle();
  assert.ok(app.busy());
  assert.deepEqual(app.routes, []);
});

for (const mode of ['returned', 'thrown']) {
  test(mode + ' network failure shows retry guidance and releases the form', async () => {
    const app = screen();
    app.enterCredentials();
    app.press('Sign In');
    if (mode === 'thrown') app.calls[0].reject(new Error('internal transport detail'));
    else app.calls[0].resolve({ name: 'AuthRetryableFetchError', status: 0, message: 'internal transport detail' });
    await app.settle();
    assert.match(app.text(), /connection|network|offline/i);
    assert.doesNotMatch(app.text(), /internal transport detail/);
    assert.equal(app.input(emailPlaceholder).value, email);
    assert.equal(app.input(passwordPlaceholder).value, password);
    app.press('Sign In');
    assert.deepEqual(app.calls[1].args, app.calls[0].args);
    app.calls[1].resolve(null);
    await app.settle();
    assert.ok(app.busy());
  });
}

test('unconfirmed sign-in opens verification while the normal sign-in screen has no verify button', async () => {
  const app = screen();
  assert.doesNotMatch(app.text(), /verify email/i);
  app.enterCredentials();
  app.fill(emailPlaceholder, ' Student@Example.com ');
  assert.deepEqual(app.routes, [], 'entering an email does not open verification');
  app.press('Sign In');
  app.calls[0].resolve({ code: 'email_not_confirmed', status: 400 });
  await app.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(app.routes)), [{ pathname: '/sign-up', params: { verify: '1', email: 'student@example.com' } }]);
  assert.equal(app.calls.length, 1, 'only the requested sign-in is sent');
  assert.doesNotMatch(JSON.stringify(app.routes), /password/);
  assert.equal(app.input(emailPlaceholder).editable, true, 'back navigation can return to an editable form');
  assert.doesNotMatch(app.text(), /Tap Verify email/);
});

test('returning from email verification prefills only the email, never a password', () => {
  const app = screen({ email: 'student@example.com' });
  assert.equal(app.input(emailPlaceholder).value, 'student@example.com');
  assert.equal(app.input(passwordPlaceholder).value, '');
  assert.equal(app.calls.length, 0);
});
