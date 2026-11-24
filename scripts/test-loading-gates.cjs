/* global __dirname */
// Pending screens must never expose protected content or hide a retryable error.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n.props?.children);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(kind = 'standing') {
  const slots = [], effects = [], requests = [];
  let cursor = 0, tree, privateReads = 0, retries = 0;
  const access = { status: 'checking', role: null, retry: () => retries++, invalidate() {} };
  const equal = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length ? children : props?.children } }),
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useCallback: fn => fn,
    useEffect(fn, deps) { const i = cursor++; slots[i] ??= {}; const slot = slots[i];
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = fn(); }); },
  };
  const mocks = {
    react: React,
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/motion': require('./motion-test-mock.cjs'),
    '@/context/AccountDeletionProvider': { DeleteAccountButton: 'DeleteAccountButton' },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      View: 'View', Text: 'Text', ScrollView: 'ScrollView', StyleSheet: { create: x => x } },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'student' }, signOut: async () => null }) },
    '../lib/accountStanding': { getAccountStanding: () => { const request = deferred(); requests.push(request); return request.promise; }, acknowledgeAccountNotice: async () => {} },
    './ModerationShell': { ModerationButton: 'Button', moderationStyles: {} },
    './AccountAppeals': { default: 'Appeals', __esModule: true },
    'expo-router': { useRouter: () => ({}) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({}) },
    './ScreenHeader': { default: 'Header', __esModule: true },
    '../constants/actionStyles': {},
    '../lib/useModerationAccess': { useModerationAccess: () => access },
  };
  const file = path.resolve(__dirname, '../src/components/' + (kind === 'standing' ? 'AccountStandingGate' : 'ModerationShell') + '.tsx');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, setInterval: () => 1, clearInterval() {}, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  function render() {
    cursor = 0;
    if (kind === 'standing') { tree = exports.default({ children: 'Private student content' }); if (typeof tree?.type === 'function') tree = tree.type(tree.props); }
    else tree = exports.ModerationGate({ userId: 'student', adminOnly: true, children: () => { privateReads++; return 'Private staff evidence'; } });
    while (effects.length) effects.shift()();
    return tree;
  }
  async function settle() { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); render(); } }
  const button = title => nodes(tree).find(n => n.props?.title === title);
  render(); return { access, requests, render, settle, button, tree: () => tree, privateReads: () => privateReads, retries: () => retries,
    close: () => slots.forEach(slot => slot?.cleanup?.()) };
}
test('account checking uses a waiting state, then error recovery, without exposing private content', async () => {
  const h = harness();
  const loading = nodes(h.tree()).find(n => n.type === 'LoadingState');
  assert.equal(loading?.props.title, 'Checking your account');
  assert.equal(loading?.props.fullScreen, true);
  assert.ok(!nodes(h.tree()).some(n => n.type === 'Button' || n.type === 'DeleteAccountButton'));
  assert.doesNotMatch(text(h.tree()), /Private student content/);
  h.requests[0].reject(Error('offline')); await h.settle();
  assert.match(text(h.tree()), /Unable to check your account/);
  assert.ok(!nodes(h.tree()).some(n => n.type === 'LoadingState'));
  assert.doesNotMatch(text(h.tree()), /Private student content/);
  for (const title of ['Check again', 'Account decisions & appeals', 'Sign out']) assert.ok(h.button(title), title);
  assert.ok(nodes(h.tree()).some(n => n.type === 'DeleteAccountButton'));
  h.button('Check again').props.onPress(); h.render();
  h.requests[1].resolve({ suspended: false, warning_count: 0, notices: [] }); await h.settle();
  assert.match(text(h.tree()), /Private student content/);
  h.close();
});
test('a suspension replaces loading with its real notice and still blocks private content', async () => {
  const h = harness();
  h.requests[0].resolve({ suspended: true, suspended_until: '2026-11-24T12:00:00Z', warning_count: 3,
    notices: [{ id: 'warning', kind: 'warn', created_at: '2026-11-17T12:00:00Z', reason: 'Review the account decision.', automatic_suspension: true }] });
  await h.settle();
  assert.match(text(h.tree()), /Account temporarily suspended/);
  assert.match(text(h.tree()), /Review the account decision/);
  assert.doesNotMatch(text(h.tree()), /Private student content/);
  assert.ok(!nodes(h.tree()).some(n => n.type === 'LoadingState'));
  for (const title of ['Check again', 'Account decisions & appeals', 'Sign out']) assert.ok(h.button(title), title);
  assert.ok(nodes(h.tree()).some(n => n.type === 'DeleteAccountButton'));
  h.close();
});
test('moderation pending, failed and insufficient-role states never mount private evidence', () => {
  const h = harness('moderation');
  assert.equal(nodes(h.tree()).find(n => n.type === 'LoadingState')?.props.title, 'Checking moderation access');
  assert.equal(h.privateReads(), 0);
  h.access.status = 'error'; h.render();
  assert.match(text(h.tree()), /Unable to verify access/);
  assert.ok(!nodes(h.tree()).some(n => n.type === 'LoadingState'));
  h.button('Retry access').props.onPress(); assert.equal(h.retries(), 1);
  Object.assign(h.access, { status: 'allowed', role: 'moderator' }); h.render();
  assert.match(text(h.tree()), /Moderation access required/); assert.equal(h.privateReads(), 0);
  h.access.role = 'admin'; h.render();
  assert.match(text(h.tree()), /Private staff evidence/); assert.equal(h.privateReads(), 1); h.close();
});
