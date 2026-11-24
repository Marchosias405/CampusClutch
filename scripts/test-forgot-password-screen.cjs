/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/(auth)/forgot-password.tsx');
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
    '@/components/motion': require('./motion-test-mock.cjs'),
    react,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'TextInput', 'Text', 'View', 'ScrollView', 'KeyboardAvoidingView'].map(type => [type, type])),
      StyleSheet: { create: styles => styles }, Platform: { OS: 'android' },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: route => routes.push(route), replace: route => routes.push(route) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    '@/context/AuthContext': { useAuth: () => ({
      requestPasswordReset: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
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

test('reset requests validate email and ignore duplicate keyboard/button submissions', async () => {
  const app=screen(); app.press('Send Reset Link');
  assert.match(app.text(), /Enter your email address/); assert.equal(app.calls.length,0);
  app.fill(emailPlaceholder,email);const tap=app.button('Send Reset Link').onPress;
  app.input(emailPlaceholder).onSubmitEditing();tap();app.render();
  assert.equal(app.calls.length,1);assert.deepEqual(app.calls[0].args,[email.trim()]);
  assert.equal(app.input(emailPlaceholder).editable,false);
  app.calls[0].resolve(null);await app.settle();
  assert.match(app.text(), /Open it on any device/);assert.equal(app.busy(),false);
  app.press('Return to Sign In');assert.equal(app.routes[0].pathname,'/sign-in');
  assert.equal(app.routes[0].params.email,email.trim());
});
test('rate limits and network errors release the form and retain the email for retry', async () => {
  const app=screen();app.fill(emailPlaceholder,email);
  app.press('Send Reset Link');app.calls[0].resolve({status:429,message:'private provider details'});await app.settle();
  assert.match(app.text(),/Closing the app will not reset this limit/);assert.doesNotMatch(app.text(),/private provider/);
  app.press('Send Reset Link');app.calls[1].reject(Error('private network details'));await app.settle();
  assert.match(app.text(),/Check your connection/);assert.equal(app.busy(),false);
  assert.equal(app.input(emailPlaceholder).value,email);assert.doesNotMatch(app.text(),/private network/);
  app.press('Send Reset Link');app.calls[2].resolve(null);await app.settle();assert.match(app.text(),/If an account exists/);
});
