/* global __dirname */
// Run the real contact card and offer integration through account/focus/network transitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const REQUEST = 'd0000000-0000-4000-8000-000000000004';
const CHAT = 'e0000000-0000-4000-8000-000000000005';
const files = { contact: 'src/components/RequestContact.tsx', offers: 'src/components/RequestOffers.tsx' };
const compiled = Object.fromEntries(Object.entries(files).map(([kind, file]) => [kind, ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText]));
const identity = id => ({ profileId: id, displayName: 'Student ' + id[0], major: 'Computing', yearOfStudy: 2, campusDisplayName: 'Burnaby' });
const textOf = node => node == null || typeof node === 'boolean' ? ''
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props.children);
function nodes(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) { node.forEach(item => nodes(item, output)); return output; }
  output.push(node); nodes(node.props.children, output); return output;
}
function harness(kind = 'contact', options = {}) {
  let slots = [], focusEffects = new Set(), normalEffects = new Set(), effectQueue = [];
  let cursor = 0, dirty = true, focused = true, tree, currentKey, userId = options.userId ?? A;
  const events = new Set(), reads = [], opens = [], navigation = [];
  const props = kind === 'contact' ? { requestId: REQUEST, profileId: B, role: 'poster', revision: '1:open', ...options.props }
    : { requestId: REQUEST, request: { id: REQUEST, ownerId: B, offerRound: 1, status: 'open', points: 10, deadlineAt: '2099-01-01T00:00:00Z' }, ...options.props };
  const rows = options.rows ?? [];
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { deps: null, cleanup: null };
      const slot = slots[index]; normalEffects.add(slot);
      if (!equal(slot.deps, deps)) effectQueue.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
  };
  function useFocusEffect(callback) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { callback: null, cleanup: null };
    const slot = slots[index]; focusEffects.add(slot);
    if (slot.callback !== callback) effectQueue.push(() => { slot.cleanup?.(); slot.callback = callback; slot.cleanup = focused ? callback() : null; });
  }
  const AppState = { currentState: 'active', addEventListener: (_event, listener) => { events.add(listener); return { remove: () => events.delete(listener) }; } };
  const pending = (list, args) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    list.push({ args, resolve, reject }); return promise;
  };
  const modules = {
    react,
    'react-native': { AppState, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', View: 'View', Text: 'Text', TextInput: 'TextInput',
      Alert: { alert() {} }, StyleSheet: { create: value => value } },
    'expo-router': { useFocusEffect, useRouter: () => ({ push: value => { navigation.push(value); blur(); } }) },
    '../context/AuthContext': { useAuth: () => ({ user: userId ? { id: userId } : null }) },
    '../context/RequestsContext': { useRequests: () => ({ invalidate() {} }) },
    '../lib/requestContacts': { loadRequestContact: (...args) => pending(reads, args), startRequestContactConversation: (...args) => pending(opens, args) },
    '../lib/offers': { loadOfferPage: async () => ({ items: rows, hasMore: false, nextOffset: rows.length }), offerError: () => 'Unable to load offers' },
    './RequestContact': { default: 'RequestContact', __esModule: true },
    './RatingSummary': { default: 'RatingSummary', __esModule: true },
  };
  const exports = {};
  vm.runInNewContext(compiled[kind], { exports, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name); return modules[name];
  }, setInterval: () => 1, clearInterval() {} });
  function reset() {
    for (const effect of [...focusEffects, ...normalEffects]) effect.cleanup?.();
    slots = []; focusEffects = new Set(); normalEffects = new Set(); effectQueue = [];
  }
  function render() {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 100, 'Render should settle'); dirty = false;
      if (kind === 'offers') { cursor = 0; tree = exports.default(props); }
      else {
        const outer = exports.default(props);
        if (!outer) { reset(); currentKey = undefined; tree = null; continue; }
        if (currentKey !== outer.props.key) { reset(); currentKey = outer.props.key; }
        cursor = 0; tree = outer.type(outer.props);
      }
      while (effectQueue.length) effectQueue.shift()();
    }
  }
  async function settle() { for (let i = 0; i < 5; i++) { render(); await new Promise(setImmediate); } render(); }
  function blur() { if (!focused) return; focused = false; for (const effect of focusEffects) { effect.cleanup?.(); effect.cleanup = null; } }
  function focus() { if (focused) return; focused = true; for (const effect of focusEffects) effect.cleanup = effect.callback(); render(); }
  function appState(value) { AppState.currentState = value; for (const listener of events) listener(value); render(); }
  function button(label) {
    const found = nodes(tree).find(node => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(found, 'Missing button ' + label); return found;
  }
  function press(label) { const found = button(label); assert.ok(!found.props.disabled, label + ' must be enabled'); found.props.onPress(); render(); }
  render();
  return { settle, press, button, blur, focus, appState, reads, opens, navigation, content: () => textOf(tree), nodes: () => nodes(tree),
    switchAccount: id => { userId = id; dirty = true; render(); },
    updateProps: value => { Object.assign(props, value); dirty = true; render(); },
  };
}
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };
async function ready(app) { app.reads.at(-1).resolve(identity(app.reads.at(-1).args[2])); await app.settle(); }
(async () => {
  {
    const app = harness('offers'); await app.settle();
    const contacts = app.nodes().filter(node => node.type === 'RequestContact');
    assert.equal(contacts.length, 1); assert.equal(contacts[0].props.profileId, B);
    assert.equal(contacts[0].props.role, 'poster'); assert.equal(contacts[0].props.requestId, REQUEST);
    assert.ok(app.content().includes('You have not offered help'));
    pass('an unoffered request renders poster contact independently of offer history');
  }
  {
    const app = harness('offers', { userId: B, rows: [{ id: C, request_id: REQUEST, offering_user_id: A, status: 'pending',
      offer_round: 1, request_offer_round: 1, request_status: 'open', request_points: 10, request_deadline_at: '2099-01-01T00:00:00Z',
      helper_display_name: 'Prospective helper', helper_major: 'Computing', created_at: '2026-01-01T00:00:00Z' }] }); await app.settle();
    const contacts = app.nodes().filter(node => node.type === 'RequestContact');
    assert.equal(contacts.length, 1); assert.equal(contacts[0].props.profileId, A); assert.equal(contacts[0].props.role, 'helper');
    assert.equal(contacts[0].props.requestId, REQUEST); assert.ok(app.content().includes('Prospective helper'));
    assert.ok(app.content().includes('Accept helper'));
    pass('posters can identify and message pending helpers before accepting');
  }
  {
    const app = harness(); assert.deepEqual(app.reads[0].args, [A, REQUEST, B]);
    assert.equal(app.opens.length, 0); assert.equal(app.button('Message poster').props.disabled, true);
    await ready(app); assert.ok(app.content().includes('Student b')); assert.ok(app.content().includes('Computing · Year 2 · Burnaby'));
    assert.equal(app.opens.length, 0, 'Loading identity must not create a chat');
    const handler = app.button('Message poster').props.onPress; handler(); handler(); await app.settle();
    assert.equal(app.opens.length, 1); assert.deepEqual(app.opens[0].args, [A, REQUEST, B]);
    app.opens[0].resolve(CHAT); await app.settle();
    assert.equal(app.navigation.length, 1); assert.equal(app.navigation[0].pathname, '/messages/[id]'); assert.equal(app.navigation[0].params.id, CHAT);
    pass('contact identity loads without creating a chat, then double taps open one server conversation');
  }
  {
    const app = harness(); app.reads[0].reject(Error('private database diagnostic')); await app.settle();
    assert.equal(app.button('Message poster').props.disabled, true); assert.ok(!app.content().includes('private database'));
    app.press('Retry contact'); await ready(app); app.press('Message poster');
    app.opens[0].reject(Error('private database diagnostic')); await app.settle();
    assert.ok(!app.content().includes('private database')); assert.ok(app.content().includes('Unable to open this chat'));
    app.press('Message poster'); app.opens[1].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 1);
    pass('read and open failures retain safe, usable retries');
  }
  for (const transition of ['account', 'request', 'target', 'revision', 'blur', 'background']) {
    for (const operation of ['read', 'open']) {
      const app = harness();
      if (operation === 'open') { await ready(app); app.press('Message poster'); }
      const stale = operation === 'read' ? app.reads[0] : app.opens[0];
      if (transition === 'account') app.switchAccount(C);
      if (transition === 'request') app.updateProps({ requestId: C });
      if (transition === 'target') app.updateProps({ profileId: C });
      if (transition === 'revision') app.updateProps({ revision: '2:accepted' });
      if (transition === 'blur') { app.blur(); app.focus(); }
      if (transition === 'background') { app.appState('background'); app.appState('active'); }
      assert.ok(app.reads.length > 1, 'Return must recheck contact eligibility');
      await ready(app);
      if (operation === 'open') {
        // A hung request from a previous screen must not block a fresh attempt.
        app.press('Message poster'); assert.equal(app.opens.length, 2);
        stale.resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 0);
        assert.equal(app.button('Opening chat…').props.disabled, true, 'Old completion must not unlock the new operation');
        app.opens[1].resolve(CHAT); await app.settle(); assert.equal(app.navigation.length, 1);
      } else {
        stale.resolve({ ...identity(B), displayName: 'Stale identity' }); await app.settle();
        assert.ok(!app.content().includes('Stale identity')); assert.equal(app.opens.length, 0);
      }
    }
    pass('request contact discards stale identity/open results and remains usable after ' + transition);
  }
  {
    const app = harness(); app.switchAccount(B); await app.settle(); assert.equal(app.content(), '');
    app.reads[0].resolve(identity(B)); await app.settle(); assert.equal(app.content(), ''); assert.equal(app.opens.length, 0);
    app.switchAccount(null); await app.settle(); assert.equal(app.content(), '');
    pass('self and signed-out contact cards stay hidden even after a prior read finishes');
  }
  console.log('Request contact entry checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
