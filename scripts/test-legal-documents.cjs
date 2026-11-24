/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const nodes = n => n == null || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = n => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : typeof n === 'object' ? text(n.props?.children) : String(n);

function harness(screen = 'sign-up', params = {}, { privacyEmail, mailAppAvailable = true } = {}) {
  const modules = new Map(), instances = new Map(), calls = [], scrolls = [];
  let current, tree, dismissals = 0, allowed = false;
  const element = (type, props, key) => ({ type, key, props: props ?? {} });
  const slot = initial => { const index = current.cursor++; return current.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }; };
  const react = {
    createElement: (type, props, ...children) => element(type, { ...props, children }),
    createContext: initial => { const context = { current: initial }; context.Provider = { context }; return context; },
    useContext: context => context.current,
    useState: initial => { const box = slot(initial); return [box.value, next => { box.value = typeof next === 'function' ? next(box.value) : next; }]; },
    useRef: initial => slot(() => ({ current: initial })).value,
    useCallback: fn => slot(() => fn).value,
    useMemo: fn => slot(fn).value,
  };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name]));
  Object.assign(native, { Platform: { OS: 'android' }, Keyboard: { dismiss() { dismissals++; } }, StyleSheet: { create: value => value } });
  native.Linking = { async openURL(url) {
    calls.push(['openURL', url]);
    if (!mailAppAvailable) throw new Error('No mail app');
  } };
  const stubs = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'Fragment' }, 'react-native': native,
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    '@/lib/motionPreference': { useMotionAllowed: () => allowed },
    '@/components/motion': { MotionPressable: 'Pressable' },
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: value => calls.push(['push', value]), replace: value => calls.push(['replace', value]) }) },
    '@/lib/env': { env: { appEnvironment: 'preview' } },
    '@/context/AuthContext': { useAuth: () => ({
      signIn: async (...args) => { calls.push(['signIn', ...args]); return null; },
      signUp: async (...args) => { calls.push(['signUp', ...args]); return { verificationRequired: true }; },
      resendVerification: async (...args) => { calls.push(['resend', ...args]); return null; },
    }) },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const output = {}; modules.set(file, output);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports: output, process: { env: { EXPO_PUBLIC_PRIVACY_EMAIL: privacyEmail } }, require(name) {
      if (name in stubs) return stubs[name];
      const resolved = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      const source = ['.tsx', '.ts'].map(ext => resolved + ext).find(value => fs.existsSync(value));
      assert.ok(source, 'Unexpected dependency (reader must not need network or storage): ' + name);
      return load(source);
    } }, { filename: file });
    return output;
  }
  const Provider = load(path.join(root, 'src/context/LegalDocumentsProvider.tsx')).LegalDocumentsProvider;
  const Screen = screen === 'links' ? load(path.join(root, 'src/components/LegalLinks.tsx')).default
    : load(path.join(root, 'src/app/(auth)/' + screen + '.tsx')).default;
  function expand(node, location = 'root') {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, index) => expand(child, location + '/' + (child?.key ?? index)));
    if (node.type?.context) { node.type.context.current = node.props.value; return expand(node.props.children, location + '/context'); }
    if (typeof node.type === 'function') {
      let instance = instances.get(location);
      if (!instance || instance.type !== node.type) { instance = { type: node.type, slots: [], cursor: 0 }; instances.set(location, instance); }
      const previous = current; current = instance; instance.cursor = 0;
      const rendered = node.type(node.props); current = previous;
      return expand(rendered, location + '/render');
    }
    if (node.type === 'ScrollView' && node.props.ref) node.props.ref.current = { scrollTo: value => scrolls.push(value) };
    return { ...node, props: { ...node.props, children: expand(node.props.children, location + '/children') } };
  }
  const child = element(Screen, screen === 'links' ? params : {});
  function render() { tree = expand(element(Provider, { children: child })); }
  const find = predicate => { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected control'); return found; };
  const input = placeholder => find(n => n.type === 'TextInput' && n.props.placeholder === placeholder).props;
  function fill(placeholder, value) { input(placeholder).onChangeText(value); render(); }
  function button(label) { return find(n => n.type === 'Pressable' && (n.props.accessibilityLabel === label || text(n) === label)).props; }
  function press(label) { const control = button(label); if (!control.disabled) control.onPress(); render(); }
  render();
  return { calls, scrolls, input, fill, button, press, render, tree: () => tree, text: () => text(tree),
    modal: () => nodes(tree).find(n => n.type === 'Modal'), dismissals: () => dismissals,
    back() { find(n => n.type === 'Modal').props.onRequestClose(); render(); },
    motion(value) { allowed = value; render(); },
  };
}

test('signup drafts survive both documents and Android Back without an auth request or acceptance', () => {
  const h = harness();
  h.fill('student@example.com', 'student@example.test');
  h.fill('At least 8 characters', 'only-a-local-fixture');
  h.fill('Enter your password again', 'only-a-local-fixture');
  h.press('Privacy Policy');
  assert.ok(h.modal()); assert.equal(h.dismissals(), 1);
  assert.match(text(h.modal()), /Deleting your account/); assert.match(text(h.modal()), /Preview draft/);
  assert.match(text(h.modal()), /verification link to your @sfu\.ca email address/);
  h.press('Read Terms'); assert.match(text(h.modal()), /Moderation and appeals/);
  assert.match(text(h.modal()), /at any age with a verified @sfu\.ca email address/);
  assert.doesNotMatch(text(h.modal()), /only-a-local-fixture|student@example.test/);
  assert.equal(h.modal().props.animationType, 'none');
  h.back(); assert.equal(h.modal(), undefined);
  assert.equal(h.input('student@example.com').value, 'student@example.test');
  assert.equal(h.input('At least 8 characters').value, 'only-a-local-fixture');
  assert.equal(h.input('Enter your password again').value, 'only-a-local-fixture');
  assert.deepEqual(h.calls, []);
});

test('sign-in and verification recovery expose offline reading without submitting credentials or resending email', () => {
  const signIn = harness('sign-in');
  signIn.fill('student@example.com', 'existing@example.test');
  signIn.fill('Enter your password', 'local-fixture');
  signIn.press('Terms'); signIn.press('Close Terms');
  assert.equal(signIn.input('Enter your password').value, 'local-fixture'); assert.deepEqual(signIn.calls, []);
  const verify = harness('sign-up', { verify: '1', email: 'unverified@example.test' });
  verify.press('Privacy Policy'); verify.back();
  assert.equal(verify.input('student@example.com').value, 'unverified@example.test');
  assert.deepEqual(verify.calls, []);
});

test('profile links, document switching and Back to top respect Reduce Motion', () => {
  const h = harness('links', { variant: 'profile' });
  h.press('Privacy Policy'); h.press('Back to top');
  assert.deepEqual(JSON.parse(JSON.stringify(h.scrolls.at(-1))), { y: 0, animated: false });
  h.motion(true); assert.equal(h.modal().props.animationType, 'fade');
  h.press('Back to top'); assert.equal(h.scrolls.at(-1).animated, true);
  h.press('Read Terms'); assert.ok(h.button('Close Terms'));
  h.press('Read Privacy Policy'); assert.ok(h.button('Close Privacy Policy'));
  h.press('Close Privacy Policy'); assert.equal(h.modal(), undefined);
});

test('disabled entry links cannot interrupt a pending form action', () => {
  for (const variant of ['footer', 'profile']) {
    const h = harness('links', { variant, disabled: true });
    h.press('Privacy Policy'); h.press('Terms');
    assert.equal(h.modal(), undefined); assert.equal(h.dismissals(), 0);
  }
});

test('privacy contact opens a draft from sign-in or Profile with only the configured recipient and subject', async () => {
  for (const screen of ['sign-in', 'links']) {
    const h = harness(screen, { variant: 'profile' }, { privacyEmail: ' privacy+preview@example.test ' });
    if (screen === 'sign-in') h.fill('student@example.com', 'former-student@example.test');
    h.press('Privacy Policy');
    assert.match(text(h.modal()), /even after deleting your account/);
    assert.ok(nodes(h.modal()).some(n => n.props?.selectable && text(n) === 'privacy+preview@example.test'));
    assert.deepEqual(h.calls, []);
    await h.button('Email the privacy team').onPress();
    assert.deepEqual(h.calls, [['openURL', 'mailto:privacy%2Bpreview@example.test?subject=CampusClutch%20privacy%20request']]);
    h.press('Read Terms');
    assert.doesNotMatch(text(h.modal()), /Email the privacy team/);
  }
});

test('missing or malformed public mailbox leaves the privacy notice readable without an email action', () => {
  for (const privacyEmail of [undefined, ' ', 'not-an-address', 'a@example.test,b@example.test', 'a@example.test?bcc=b@example.test']) {
    const h = harness('sign-in', {}, { privacyEmail });
    h.press('Privacy Policy');
    const notice = text(h.modal());
    assert.match(notice, /once confirmed/);
    assert.doesNotMatch(notice, /Email the privacy team|[\w.+-]+@[\w.-]+/);
    if (privacyEmail?.trim()) assert.ok(!notice.includes(privacyEmail.trim()));
    assert.deepEqual(h.calls, []);
  }
});

test('when the system cannot open email, the reader keeps a selectable address and explains how to use it', async () => {
  const h = harness('sign-in', {}, { privacyEmail: 'help@example.test', mailAppAvailable: false });
  h.press('Privacy Policy');
  await h.button('Email the privacy team').onPress();
  h.render();
  assert.match(text(h.modal()), /Copy the address above/);
  assert.ok(nodes(h.modal()).some(n => n.props?.selectable && text(n) === 'help@example.test'));
});
