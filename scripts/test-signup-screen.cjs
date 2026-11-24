/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const textOf = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props?.children);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const noSession = { error: null, verificationRequired: true };

function harness(params = {}, appEnvironment = 'preview') {
  const slots = [], calls = [], routes = [];
  let cursor = 0, tree;
  const state = { signup: async () => noSession, resend: async () => null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
  };
  const mocks = {
    '@/lib/env': { env: { appEnvironment } },
    '@/components/motion': require('./motion-test-mock.cjs'),
    '@/components/LegalLinks': { default: 'LegalLinks', __esModule: true },
    '@/context/LegalDocumentsProvider': { LegalDocumentsProvider: 'LegalDocumentsProvider' },
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView',
      Text: 'Text', TextInput: 'TextInput', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, StyleSheet: { create: value => value } },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ replace: route => routes.push(route) }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    '@/context/AuthContext': { useAuth: () => ({
      signUp: async (email, password) => { calls.push(['signup', email, password]); return state.signup(); },
      resendVerification: async email => { calls.push(['resend', email]); return state.resend(); },
    }) },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/app/(auth)/sign-up.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; } });
  function render() { cursor = 0; tree = exports.default(); }
  const find = predicate => { const node = nodes(tree).find(predicate); assert.ok(node, 'Expected control'); return node; };
  function press(label) {
    const button = find(n => n.type === 'Pressable' && textOf(n) === label);
    if (!button.props.disabled) button.props.onPress();
    render();
  }
  function fill(placeholder, value) { find(n => n.type === 'TextInput' && n.props.placeholder === placeholder).props.onChangeText(value); render(); }
  async function settle() { for (let i = 0; i < 4; ++i) { await new Promise(setImmediate); render(); } }
  function enterSignup(address = ' Student@Example.com ') {
    fill(appEnvironment === 'production' ? 'computingID@sfu.ca' : 'student@example.com', address);
    fill('At least 8 characters', 'test-fixture-password');
    fill('Enter your password again', 'test-fixture-password');
  }
  render();
  return { state, calls, routes, find, press, fill, settle, enterSignup, text: () => textOf(tree), tree: () => tree };
}

(async () => {
  let groups = 0;
  const pass = label => { groups++; console.log('PASS ' + label); };
  const production = harness({}, 'production');
  assert.ok(production.text().includes('SFU email address'));
  for (const address of ['student@example.com', 'a@notsfu.ca', 'a@alumni.sfu.ca', 'a@sfu.ca.example.com', 'a@@sfu.ca']) {
    production.enterSignup(address);
    production.press('Create Account');
    await production.settle();
    assert.match(production.text(), /Use your SFU email address/);
    assert.equal(production.calls.length, 0);
  }
  production.enterSignup(' First_Last@SFU.CA ');
  production.press('Create Account');
  await production.settle();
  assert.equal(production.calls[0][1], 'first_last@sfu.ca');
  assert.match(production.text(), /check your inbox/i);
  pass('Production signup checks the exact SFU domain and continues to email verification');
  const legacy = harness({ verify: '1', email: 'legacy@example.com' }, 'production');
  legacy.press('Resend Verification Email');
  await legacy.settle();
  assert.deepEqual(legacy.calls, [['resend', 'legacy@example.com']]);
  const development = harness({}, 'development');
  development.enterSignup();
  development.press('Create Account');
  await development.settle();
  assert.equal(development.calls[0][1], 'student@example.com');
  pass('Development signup and existing-account verification accept test addresses');
  const h = harness();
  h.enterSignup(); h.press('Create Account'); await h.settle();
  assert.equal(h.calls[0][1], 'student@example.com');
  assert.ok(h.text().includes('If this address needs verification'));
  assert.ok(h.text().includes('Already registered?'));
  assert.ok(!h.text().includes('We created an account'));
  assert.equal(h.tree().type, 'KeyboardAvoidingView');
  assert.equal(h.find(n => n.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
  h.press('Return to Sign In'); assert.deepEqual(JSON.parse(JSON.stringify(h.routes.pop())), { pathname: '/sign-in', params: { email: 'student@example.com' } });
  h.press('Forgot Password?'); assert.equal(h.routes.pop(), '/forgot-password');
  assert.equal(h.calls.length, 1, 'navigation must not send emails or probe account existence');
  pass('ambiguous no-session signup gives both verification and existing-account recovery paths');

  h.press('Resend Verification Email'); await h.settle();
  assert.deepEqual(h.calls[1], ['resend', 'student@example.com']);
  assert.ok(h.text().includes('If this address still needs verification'));
  assert.ok(h.text().includes('Verified accounts do not need another verification email'));
  h.state.resend = async () => ({ status: 429 });
  h.press('Resend Verification Email'); await h.settle();
  assert.ok(h.text().includes('Please wait before trying again'));
  assert.ok(h.text().includes('Forgot Password?'));
  h.state.resend = async () => { throw Error('offline'); };
  h.press('Resend Verification Email'); await h.settle();
  assert.ok(h.text().includes('Check your connection'));
  h.state.resend = async () => null;
  h.press('Resend Verification Email'); await h.settle();
  assert.ok(!h.text().includes('Check your connection'));
  pass('resend is conditional, rate-limit/offline errors retain recovery actions and retry works');

  h.press('Use a different email');
  assert.equal(h.find(n => n.props?.placeholder === 'At least 8 characters').props.value, '');
  assert.equal(h.find(n => n.props?.placeholder === 'Enter your password again').props.value, '');
  assert.ok(!h.text().includes('If this address still needs verification'));
  h.enterSignup(); h.fill('student@example.com', 'another@example.com');
  h.press('Create Account'); await h.settle();
  assert.equal(h.find(n => n.props?.accessibilityLabel === 'Verification email address').props.value, 'another@example.com');
  pass('changing email clears prior feedback and submitted passwords before another signup');

  for (const code of ['user_already_exists', 'email_exists']) {
    const duplicate = harness();
    duplicate.state.signup = async () => ({ error: { code, status: 422 }, verificationRequired: false });
    duplicate.enterSignup(); duplicate.press('Create Account'); await duplicate.settle();
    assert.ok(duplicate.text().includes('This email is already registered'));
    duplicate.press('Already have an account? Sign In'); assert.equal(duplicate.routes.pop(), '/sign-in');
    duplicate.press('Forgot Password?'); assert.equal(duplicate.routes.pop(), '/forgot-password');
    assert.equal(duplicate.calls.length, 1);
  }
  pass('explicit duplicate-email errors provide clear sign-in and password-reset actions');

  const offline = harness(); offline.enterSignup();
  offline.state.signup = async () => { throw Error('offline'); };
  offline.press('Create Account'); await offline.settle();
  assert.ok(offline.text().includes('Unable to complete signup'));
  assert.equal(offline.find(n => n.props?.placeholder === 'student@example.com').props.value, ' Student@Example.com ');
  offline.state.signup = async () => ({ error: { status: 429 }, verificationRequired: false });
  offline.press('Create Account'); await offline.settle();
  assert.ok(offline.text().includes('Too many attempts'));
  offline.state.signup = async () => noSession;
  offline.press('Create Account'); await offline.settle();
  assert.ok(offline.text().includes('Already registered?'));
  pass('failed signup preserves form values, clears loading and permits a successful retry');

  for (const error of [
    { code: 'over_email_send_rate_limit', status: 429 },
    { code: 'over_email_send_rate_limit' },
    { code: 'over_request_rate_limit', status: 429 },
    { status: 429 },
  ]) {
    const limited = harness(); limited.enterSignup();
    limited.state.signup = async () => ({ error, verificationRequired: false });
    limited.press('Create Account'); await limited.settle();
    const emailQuota = error.code === 'over_email_send_rate_limit';
    assert.equal(limited.text().includes('Verification emails are temporarily limited'), emailQuota);
    assert.equal(limited.text().includes('Too many attempts'), !emailQuota);
    assert.ok(limited.text().includes("Restarting the app won't reset this limit"));
    assert.ok(!limited.text().includes('Wait a moment'));
    assert.ok(!limited.text().includes('Check your email'), 'rate-limited signup must not imply that email was sent');
    assert.equal(limited.calls.length, 1, 'no automatic retry may consume the email quota');
    assert.equal(limited.find(n => n.props?.placeholder === 'At least 8 characters').props.value, 'test-fixture-password');
    limited.state.signup = async () => noSession;
    limited.press('Create Account'); await limited.settle();
    limited.state.resend = async () => error;
    limited.press('Resend Verification Email'); await limited.settle();
    assert.equal(limited.text().includes('Verification emails are temporarily limited'), emailQuota);
    assert.ok(limited.text().includes("Restarting the app won't reset this limit"));
    assert.ok(limited.text().includes('Forgot Password?'));
    assert.equal(limited.calls.length, 3);
  }
  pass('signup and resend distinguish email quota from request throttling without retrying or losing the form');

  const pending = harness(); pending.enterSignup();
  let finishSignup;
  pending.state.signup = () => new Promise(resolve => { finishSignup = resolve; });
  pending.press('Create Account');
  pending.find(n => n.props?.placeholder === 'Enter your password again').props.onSubmitEditing();
  assert.equal(pending.calls.length, 1, 'keyboard submit cannot repeat an in-flight signup');
  finishSignup(noSession); await pending.settle();
  let finishResend;
  pending.state.resend = () => new Promise(resolve => { finishResend = resolve; });
  pending.press('Resend Verification Email'); pending.press('Use a different email');
  pending.press('Forgot Password?'); assert.equal(pending.routes.length, 0);
  finishResend(null); await pending.settle(); pending.press('Use a different email');
  assert.ok(pending.text().includes('Create Account'));
  pass('pending requests cannot be duplicated or applied to another email screen');

  const signedIn = harness(); signedIn.enterSignup();
  signedIn.state.signup = async () => ({ error: null, verificationRequired: false });
  signedIn.press('Create Account'); await signedIn.settle();
  assert.ok(!signedIn.text().includes('If this address needs verification'));
  assert.ok(nodes(signedIn.tree()).some(n => n.type === 'ActivityIndicator'));
  assert.equal(signedIn.routes.length, 0, 'auth navigator owns routing when a session exists');
  pass('session-producing signup remains controlled by the auth navigator');
  const resumed = harness({ verify: '1', email: ' Student@Example.com ' });
  assert.equal(resumed.calls.length, 0, 'resuming must not send another email automatically');
  assert.equal(resumed.find(n => n.props?.accessibilityLabel === 'Verification email address').props.value, 'student@example.com');
  assert.ok(resumed.text().includes('Open the verification link on any device'));
  resumed.press('Return to Sign In');
  assert.deepEqual(JSON.parse(JSON.stringify(resumed.routes.pop())), { pathname: '/sign-in', params: { email: 'student@example.com' } });
  resumed.press('Resend Verification Email'); await resumed.settle();
  assert.deepEqual(resumed.calls, [['resend', 'student@example.com']]);
  pass('verification resumes after restart and returns to sign-in with the email preserved');

  const blank = harness({ verify: '1' });
  blank.press('Resend Verification Email'); await blank.settle();
  assert.equal(blank.calls.length, 0); assert.ok(blank.text().includes('email address you used to sign up'));
  blank.fill('student@example.com', ' Another@Example.com ');
  blank.press('Resend Verification Email'); await blank.settle();
  assert.deepEqual(blank.calls, [['resend', 'another@example.com']]);
  blank.press('Return to Sign In');
  assert.equal(blank.routes[0].params.email, 'another@example.com');
  pass('verification recovery validates the email without creating another account');
  console.log(`Signup screen: ${groups} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
