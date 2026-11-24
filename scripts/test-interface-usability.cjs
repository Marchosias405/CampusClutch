/* global __dirname */
// Render the actual components with deterministic account/model boundaries.
// These checks exercise disclosure and draft interactions without live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node.props.children);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props.children)];

function harness(component = 'AccountAppeals', options = {}) {
  const instances = new Map(), modules = new Map(), operations = new Map(), sent = [];
  let current, effects = [], dirty = true, tree;
  const config = { offline: false, warningCount: 2, ...options };
  const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = initial => { const i = current.cursor++; return current.slots[i] ??= initial(); };
  const react = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length ? children : props?.children } }),
    useState(initial) {
      const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [s.value, value => { const next = typeof value === 'function' ? value(s.value) : value;
        if (!Object.is(next, s.value)) { s.value = next; dirty = true; } }];
    },
    useRef(initial) { return slot(() => ({ current: initial })); },
    useMemo(callback, deps) { const s = slot(() => ({})); if (!same(s.deps, deps)) { s.value = callback(); s.deps = deps; } return s.value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) { const s = slot(() => ({})); if (!same(s.deps, deps)) {
      s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = callback(); });
    } },
  };
  function operation(userId, targetId, kind) {
    let state = { ready: true, busy: false, pending: options.pending ? { reason: 'Saved offline explanation', outcome: 'upheld' } : null,
      receipt: null, conflict: false, accessLost: false, error: '' };
    const listeners = new Set();
    const model = { getState: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      restore: async () => {}, setActive() {}, dispose() {},
      submit: async value => { sent.push({ userId, targetId, kind, value: value ?? state.pending });
        state = { ...state, pending: null, receipt: 'receipt' }; listeners.forEach(fn => fn()); },
    };
    operations.set(targetId, model); return model;
  }
  const fixtureActions = [
    { id: 'action-1', kind: 'warn', created_at: '2026-11-13T08:00:00Z', reason: 'Please avoid repeated unwanted messages.', revoked_at: null, automatic_suspension: false, appeal: null },
    { id: 'action-2', kind: 'warn', created_at: '2026-11-12T08:00:00Z', reason: 'Please keep reviews relevant to the course.', revoked_at: null, automatic_suspension: false,
      appeal: { status: 'upheld', explanation: 'My earlier explanation is still available here.', decision_reason: 'The warning remains because the review contained personal insults.', effect: 'The warning remains on your account.' } },
  ];
  const stubs = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '@/components/motion': require('./motion-test-mock.cjs'),
    react,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      ...Object.fromEntries(['ActivityIndicator','ScrollView','Pressable','Text','TextInput','View'].map(name => [name, name])), StyleSheet: { create: value => value } },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-router': { useRouter: () => ({}), useFocusEffect: callback => react.useEffect(callback, [callback]) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    'ScreenHeader': { default: 'View', __esModule: true },
    'useModerationAccess': { useModerationAccess: () => ({ status: 'allowed' }) },
    'accountStanding': { getAccountStanding: async () => { if (config.offline) throw Error('offline'); return { warning_count: config.warningCount }; } },
    'moderation': { moderationAccessLost: () => false, decisionValidation: value => value.trim().length < 10 ? 'Too short' : null },
    'moderationAppeals': { listOwnActions: async () => fixtureActions, actionLabel: () => 'Formal warning', appealStatusLabel: () => 'Original decision upheld' },
    'appealOperation': { createAppealOperation: operation },
    'studentBlocks': { createStudentBlockModel: () => ({
      getState: () => ({ loading: false, busy: false, data: { blocked_by_me: false, interaction_blocked: false, revision: '0' }, pending: null, error: '' }),
      subscribe: () => () => {}, dispose() {}, setActive() {}, refresh: async () => {},
    }) },
    'AuthContext': { useAuth: () => ({ user: { id: 'student' } }) },
    'points': { pointsError: () => 'Couldn’t load points. Retry.', readWallet: async () => ({ available: 80, reserved: 20, balance: 100,
      history: [{ id: 'grant', kind: config.restored ? 'balance_restored' : 'starter_grant', created_at: '2026-11-01T12:00:00Z', amount: 100 }] }) },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const out = {}; modules.set(file, out);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports: out, setInterval: () => 1, clearInterval() {}, require(name) {
      if (name in stubs) return stubs[name];
      const base = path.basename(name); if (base in stubs) return stubs[base];
      const resolved = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
      const source = ['.tsx','.ts'].map(ext => resolved + ext).find(p => fs.existsSync(p));
      assert.ok(source, 'Unexpected dependency ' + name); return load(source);
    } }, { filename: file });
    return out;
  }
  const Component = load(path.join(root, 'src/components/' + component + '.tsx')).default;
  function expand(node, location = 'root') {
    if (node == null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, index) => expand(child, location + '/' + (child?.props?.key ?? index)));
    if (typeof node.type === 'function') {
      let instance = instances.get(location);
      if (!instance || instance.type !== node.type) { instance = { type: node.type, slots: [] }; instances.set(location, instance); }
      const previous = current; current = instance; instance.cursor = 0;
      const result = node.type(node.props); current = previous;
      return expand(result, location + '/child');
    }
    return { ...node, props: { ...node.props, children: expand(node.props.children, location + '/children') } };
  }
  function render() { let count = 0; while (dirty) { assert.ok(++count < 50, 'Render settles'); dirty = false;
    tree = expand(react.createElement(Component, { userId: 'student', onClose() {} }));
    const queued = effects; effects = []; queued.forEach(fn => fn());
  } return tree; }
  async function settle() { for (let i = 0; i < 8; i++) { render(); await new Promise(setImmediate); } return render(); }
  function button(label) { const found = nodes(render()).find(n => n.type === 'Pressable' && (n.props.accessibilityLabel || text(n)) === label);
    assert.ok(found, 'Missing button: ' + label); return found; }
  function press(label) { const n = button(label); assert.ok(!n.props.disabled, 'Button enabled: ' + label); n.props.onPress(); render(); }
  function input() { return nodes(render()).find(n => n.type === 'TextInput'); }
  render();
  return { config, sent, settle, render, button, press, input, content: () => text(render()) };
}

async function main() {
  const app = harness(); await app.settle();
  assert.match(app.content(), /Current formal warnings: 2/);
  assert.equal(app.input(), undefined, 'Explanation form is initially collapsed');
  assert.doesNotMatch(app.content(), /Response times vary/);
  app.press('How warnings and appeals work'); assert.match(app.content(), /Response times vary/);
  assert.equal(app.button('How warnings and appeals work').props.accessibilityState.expanded, true);
  app.press('How warnings and appeals work'); assert.doesNotMatch(app.content(), /Response times vary/);
  assert.match(app.content(), /The warning remains because/);
  assert.doesNotMatch(app.content(), /My earlier explanation/);
  app.press('Your appeal'); assert.match(app.content(), /My earlier explanation/);
  console.log('PASS essential count and admin response stay visible; optional guidance and original appeal expand independently');
  app.press('Appeal this decision');
  app.input().props.onChangeText('Please reconsider this warning with the additional context.'); app.render();
  app.press('Cancel'); assert.equal(app.input(), undefined); assert.equal(app.sent.length, 0);
  app.press('Appeal this decision'); assert.match(app.input().props.value, /additional context/);
  app.config.offline = true; app.press('Refresh decisions'); await app.settle();
  assert.doesNotMatch(app.content(), /Current formal warnings:/); assert.match(app.content(), /Couldn’t refresh/);
  assert.match(app.input().props.value, /additional context/);
  app.config.offline = false; app.press('Refresh decisions'); await app.settle();
  assert.match(app.content(), /Current formal warnings: 2/);
  app.press('Review appeal'); app.press('Keep editing'); assert.equal(app.sent.length, 0);
  app.press('Review appeal'); app.press('Confirm appeal'); await app.settle();
  assert.equal(app.sent.length, 1); assert.match(app.content(), /Your appeal was received/);
  console.log('PASS opening/cancelling preserves draft, failed refresh keeps it, and submission still requires confirmation');
  const pending = harness('AccountAppeals', { pending: true }); await pending.settle();
  assert.match(pending.content(), /Saved offline explanation/); pending.press('Retry saved attempt'); await pending.settle();
  assert.equal(pending.sent.length, 1); assert.equal(pending.sent[0].value.reason, 'Saved offline explanation');
  console.log('PASS a restored pending appeal is visible without opening a new form');
  const points = harness('PointsBalance');
  assert.equal(nodes(points.render()).find(node => node.type === 'LoadingSkeleton')?.props.variant, 'points');
  assert.doesNotMatch(points.content(), /available|Welcome points/);
  await points.settle();
  points.press('Refresh points');
  assert.match(points.content(), /80 available20Reserved100Total points/);
  assert.equal(nodes(points.render()).some(node => node.type === 'LoadingSkeleton'), false);
  assert.equal(nodes(points.render()).find(node => node.type === 'LoadingNotice')?.props.label, 'Refreshing points');
  await points.settle();
  assert.match(points.content(), /80 available20Reserved100Total points/);
  assert.doesNotMatch(points.content(), /Each verified email/);
  points.press('How points work'); assert.match(points.content(), /Each verified email gets 100 welcome points once/);
  assert.match(points.content(), /The helper is paid when the poster confirms completion/);
  assert.match(points.content(), /Reopening or cancelling releases reserved points/);
  points.press('How points work'); assert.doesNotMatch(points.content(), /Each verified email/);
  console.log('PASS wallet amounts and history remain visible; help retains transfer and once-per-email rules');
  const returning = harness('PointsBalance', { restored: true }); await returning.settle();
  assert.match(returning.content(), /Restored balance/);
  assert.doesNotMatch(returning.content(), /Welcome points/);
  returning.press('How points work'); assert.match(returning.content(), /verify the same email again to restore your remaining points/);
  console.log('PASS restored funds have their own activity label and recovery guidance');
  console.log('Interface usability: 5 interaction groups passed.');
}
module.exports = { harness, nodes, text };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
