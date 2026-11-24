/* global __dirname */
// Execute the real block control and durable model through screen lifecycle changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const id = n => `b10c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const component = compile('src/components/BlockStudentControl.tsx');
const library = compile('src/lib/studentBlocks.ts');
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node.props.children);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props.children)];
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
let serial = 0;
function harness() {
  let slots = [], cursor = 0, dirty = true, effects = [], focused = true, tree;
  const focus = new Set(), normal = new Set(), events = new Set(), changes = [], sends = [], storage = new Map(), server = new Map();
  const config = { offline: false, wait: null };
  const props = { userId: id(1), profileId: id(2), displayName: 'Test student', onChanged: value => changes.push(value) };
  const equal = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i];
      return [slot.value, next => { const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(callback, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: callback(), deps }; return slots[i].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const i = cursor++; slots[i] ??= { deps: null, cleanup: null }; const slot = slots[i]; normal.add(slot);
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
  };
  const AppState = { currentState: 'active', addEventListener: (_event, handler) => { events.add(handler); return { remove: () => events.delete(handler) }; } };
  const api = {};
  vm.runInNewContext(library, { exports: api, require: name => {
    if (name === '@react-native-async-storage/async-storage') return {
      getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => storage.set(key, value), removeItem: async key => storage.delete(key),
    };
    if (name === './env') return { env: { supabaseUrl: `https://control-${++serial}.test` } };
    if (name === './offers') return { assertOfferSession: async expected => {
      if (expected !== props.userId) throw Error('Account switched');
      return { access_token: expected };
    } };
    if (name === './supabase') return { supabase: { rpc: (name, args) => ({ setHeader: async (_header, userId) => {
      const key = `${userId}:${args.p_profile_id}`;
      let data = server.get(key) ?? { profile_id: args.p_profile_id, blocked_by_me: false, interaction_blocked: false, revision: '0' };
      if (name === 'set_student_block') {
        sends.push({ userId, args });
        await config.wait?.promise;
        if (config.offline) throw Error('Offline');
        data = { ...data, blocked_by_me: args.p_blocked, interaction_blocked: args.p_blocked, revision: String(BigInt(args.p_expected_revision) + 1n) };
        server.set(key, data);
      }
      return { data, error: null };
    } }) } };
    throw Error(name);
  } });
  const exports = {};
  const modules = {
    react, 'react-native': { AppState, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: styles => styles } },
    'expo-router': { useFocusEffect(callback) {
      const i = cursor++; slots[i] ??= { callback: null, cleanup: null }; const slot = slots[i]; focus.add(slot);
      if (slot.callback !== callback) effects.push(() => { slot.cleanup?.(); slot.callback = callback; slot.cleanup = focused ? callback() : null; });
    } }, '../lib/studentBlocks': api,
    '../constants/actionStyles': (() => { const out = {}; vm.runInNewContext(compile('src/constants/actionStyles.ts'), { exports: out }); return out; })(),
  };
  vm.runInNewContext(component, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  function render() { let count = 0; while (dirty) { assert.ok(++count < 100); dirty = false; cursor = 0;
    tree = exports.default(props); while (effects.length) effects.shift()(); } }
  async function settle() { for (let i = 0; i < 10; i++) { render(); await new Promise(setImmediate); } render(); }
  const button = label => { const found = nodes(tree).find(node => node.type === 'Pressable' && text(node) === label); assert.ok(found, 'Missing button ' + label); return found; };
  const press = label => { const found = button(label); assert.ok(!found.props.disabled); found.props.onPress(); render(); };
  function blur() { focused = false; for (const effect of focus) { effect.cleanup?.(); effect.cleanup = null; } render(); }
  function resume() { focused = true; for (const effect of focus) effect.cleanup = effect.callback(); render(); }
  function switchAccount(userId) {
    for (const effect of [...focus, ...normal]) effect.cleanup?.();
    slots = []; effects = []; focus.clear(); normal.clear(); props.userId = userId; dirty = true; render();
  }
  render();
  return { settle, press, button, blur, resume, switchAccount, sends, changes, config, storage, content: () => text(tree),
    appState(value) { AppState.currentState = value; for (const handler of events) handler(value); render(); } };
}
(async () => {
  {
    const app = harness(); await app.settle();
    app.press('Block student'); assert.equal(app.sends.length, 0);
    assert.match(app.content(), /Existing jobs and reserved points stay unchanged/);
    app.press('Keep current setting'); assert.equal(app.sends.length, 0);
    app.press('Block student'); app.press('Confirm block'); await app.settle();
    assert.equal(app.sends.length, 1); assert.match(app.content(), /You blocked this student/);
    assert.equal(app.changes.length, 1);
    app.press('Unblock student'); app.press('Confirm unblock'); await app.settle();
    assert.equal(app.sends.length, 2); assert.equal(app.sends[1].args.p_expected_revision, '1');
    assert.equal(app.changes[1].blocked_by_me, false);
    console.log('PASS block and unblock require confirmation, retain job policy, and publish confirmed changes');
  }
  for (const transition of ['blur', 'background']) {
    const app = harness(); await app.settle(); app.press('Block student');
    const staleConfirm = app.button('Confirm block').props.onPress;
    if (transition === 'blur') app.blur(); else app.appState('background');
    staleConfirm(); await app.settle(); assert.equal(app.sends.length, 0);
    if (transition === 'blur') app.resume(); else app.appState('active');
    await app.settle(); assert.doesNotMatch(app.content(), /Confirm block/);
    app.press('Block student'); app.press('Confirm block'); await app.settle(); assert.equal(app.sends.length, 1);
    console.log('PASS ' + transition + ' cancels confirmation and refuses a stale confirmation handler');
  }
  {
    const app = harness(); await app.settle(); app.config.offline = true;
    app.press('Block student'); app.press('Confirm block'); await app.settle();
    assert.match(app.content(), /Retry saved change/); assert.doesNotMatch(app.content(), /Confirm unblock/);
    app.config.offline = false;
    const retry = app.button('Retry saved change').props.onPress; retry(); retry(); await app.settle();
    assert.equal(app.sends.length, 2); assert.deepEqual(app.sends[0].args, app.sends[1].args);
    assert.equal(app.changes.length, 1); assert.equal(app.storage.size, 0);
    console.log('PASS offline retry retains exact intent and rapid retry taps send once');
  }
  {
    const app = harness(); await app.settle(); app.config.wait = deferred();
    app.press('Block student'); app.press('Confirm block'); await app.settle();
    app.switchAccount(id(3)); await app.settle(); app.config.wait.resolve(); await app.settle();
    assert.equal(app.changes.length, 0); assert.doesNotMatch(app.content(), /You blocked/);
    assert.ok(app.button('Block student')); assert.equal(app.storage.size, 1);
    console.log('PASS an old account response neither changes the new screen nor consumes its saved intent');
  }
  console.log('Block control: 5 groups passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
