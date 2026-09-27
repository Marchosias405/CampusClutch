/* global __dirname */
// Runs the actual RequestOffers component with deterministic hooks and mocked navigation/network events.
// No emulator, database, network access, or additional testing dependency is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'src/components/RequestOffers.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function offer(userId) {
  return {
    id: 'offer-' + userId, request_id: 'request-' + userId, offering_user_id: userId,
    status: 'pending', message: null, created_at: '2026-01-01T00:00:00Z',
    offer_round: 1, request_offer_round: 1, request_points: 10,
    request_title: 'Request for ' + userId, request_status: 'open',
    request_deadline_at: '2099-01-01T00:00:00Z', has_assignment_history: false,
  };
}

function harness() {
  const slots = [], effectUpdates = [], effects = new Set();
  const rows = new Map([['helper-a', [offer('helper-a')]], ['helper-b', [offer('helper-b')]]]);
  const calls = [], mutations = [], alerts = [];
  let cursor = 0, dirty = true, focused = true, tree, userId = 'helper-a', readOffline = false;
  let invalidations = 0, changed = 0;
  const props = { onChanged: async () => { changed += 1; } };
  const equalDeps = (left, right) => left?.length === right?.length && left.every((value, i) => Object.is(value, right[i]));
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
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equalDeps(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
  };
  const api = {
    async loadOfferPage(expectedUser, requestId, offset) {
      calls.push({ kind: 'read', userId: expectedUser, requestId, offset });
      if (readOffline) throw Error('Network request failed');
      const items = rows.get(expectedUser).map(row => ({ ...row }));
      return { items, hasMore: false, nextOffset: items.length };
    },
    decideOffer(expectedUser, offerId, action, round, points) {
      const pending = deferred();
      mutations.push({ ...pending, userId: expectedUser, offerId, action, round, points });
      calls.push({ kind: 'write', userId: expectedUser, offerId, action });
      return pending.promise.then(() => { rows.get(expectedUser).find(row => row.id === offerId).status = action; });
    },
    renewOffer() { throw Error('Unexpected renewal in withdrawal regression'); },
    submitOffer() { throw Error('Unexpected creation in withdrawal regression'); },
    offerError: error => error.message,
  };
  function useFocusEffect(callback) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { callback: null, cleanup: null };
    const slot = slots[index];
    if (slot.callback !== callback) effectUpdates.push(() => {
      slot.cleanup?.();
      slot.callback = callback;
      slot.cleanup = focused ? callback() : null;
    });
    effects.add(slot);
  }
  const exports = {};
  const modules = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { create: value => value }, Alert: { alert: (title, message, buttons) => alerts.push({ title, message, buttons }) } },
    'expo-router': { useFocusEffect, useRouter: () => ({ push: () => blur() }) },
    '../context/AuthContext': { useAuth: () => ({ user: { id: userId } }) },
    '../context/RequestsContext': { useRequests: () => ({ invalidate: () => { invalidations += 1; } }) },
    '../lib/offers': api,
    './RatingSummary': { default: 'RatingSummary', __esModule: true },
    './RequestContact': { default: 'RequestContact', __esModule: true },
  };
  vm.runInNewContext(compiled, { exports, require: name => {
    if (!(name in modules)) throw Error('Unexpected import ' + name);
    return modules[name];
  }, setInterval: () => 1, clearInterval: () => {} });
  const Component = exports.default;
  function render() {
    let renders = 0;
    while (dirty) {
      assert.ok(++renders < 100, 'Render loop should settle');
      dirty = false;
      cursor = 0;
      tree = Component(props);
      while (effectUpdates.length) effectUpdates.shift()();
    }
  }
  async function settle() {
    // Flush promise continuations, renders, and focus effects without any real timers/network.
    for (let i = 0; i < 4; i++) { render(); await new Promise(setImmediate); }
    render();
  }
  function blur() {
    if (!focused) return;
    focused = false;
    for (const slot of effects) { slot.cleanup?.(); slot.cleanup = null; }
  }
  function focus() {
    if (focused) return;
    focused = true;
    for (const slot of effects) slot.cleanup = slot.callback();
    render();
  }
  const textOf = node => node == null || typeof node === 'boolean' ? ''
    : typeof node === 'string' || typeof node === 'number' ? String(node)
      : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.props.children);
  function allNodes(node, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(child => allNodes(child, result)); return result; }
    result.push(node);
    allNodes(node.props.children, result);
    return result;
  }
  function button(label) {
    const result = allNodes(tree).find(node => node.type === 'Pressable' && textOf(node) === label);
    assert.ok(result, 'Expected button: ' + label);
    return result;
  }
  function press(label) {
    const control = button(label);
    assert.ok(!control.props.disabled, label + ' should be enabled');
    control.props.onPress();
    render();
  }
  function confirmWithdrawal() {
    press('Withdraw offer');
    const confirmation = alerts.at(-1).buttons.find(item => item.text === 'Withdraw');
    assert.ok(confirmation);
    confirmation.onPress();
    render();
    assert.equal(button('Refresh offers').props.disabled, true);
  }
  render();
  return { settle, blur, focus, press, button, confirmWithdrawal, mutations, calls, rows, alerts,
    content: () => textOf(tree), invalidations: () => invalidations, changed: () => changed,
    setOffline: value => { readOffline = value; },
    switchAccount: value => { userId = value; dirty = true; render(); },
  };
}

let checks = 0;
function pass(message) { checks++; console.log('PASS ' + message); }

(async () => {
  for (const fails of [false, true]) {
    const app = harness();
    await app.settle();
    app.confirmWithdrawal();
    app.press('View request');
    if (fails) app.mutations[0].reject(Error('Network request failed'));
    else app.mutations[0].resolve();
    await app.settle();
    app.focus(); await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, false);
    assert.ok(!app.content().includes('Saving…'));
    if (fails) assert.equal(app.button('Withdraw offer').props.disabled, false);
    else assert.ok(app.content().includes('Withdrawn'));
    pass((fails ? 'failed' : 'successful') + ' withdrawal finishing behind request details releases saving state on return');
  }

  for (const fails of [false, true]) {
    const app = harness();
    await app.settle(); app.confirmWithdrawal(); app.press('View request');
    app.focus(); await app.settle();
    assert.equal(app.mutations.length, 1);
    if (fails) app.mutations[0].reject(Error('Network request failed'));
    else app.mutations[0].resolve();
    await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, false);
    assert.ok(app.content().includes('Request for helper-a'));
    assert.ok(!app.content().includes('Saving…'));
    if (fails) assert.equal(app.button('Withdraw offer').props.disabled, false);
    else assert.ok(app.content().includes('Withdrawn'));
    pass('returning before ' + (fails ? 'failure' : 'success') + ' reconciles the read skipped during saving');
  }

  {
    const app = harness();
    await app.settle(); app.confirmWithdrawal(); app.press('View request');
    app.setOffline(true); app.mutations[0].reject(Error('Network request failed'));
    await app.settle(); app.focus(); await app.settle();
    assert.ok(app.content().includes('Network request failed'));
    assert.equal(app.button('Refresh offers').props.disabled, false);
    app.setOffline(false); app.press('Refresh offers'); await app.settle();
    assert.equal(app.button('Withdraw offer').props.disabled, false);
    assert.ok(!app.content().includes('Network request failed'));
    pass('offline failure on return leaves retry enabled and reconnect restores offer actions');
  }

  for (const fails of [false, true]) {
    const app = harness();
    await app.settle(); app.confirmWithdrawal();
    app.switchAccount('helper-b'); await app.settle();
    assert.equal(app.button('Withdraw offer').props.disabled, false);
    assert.ok(!app.content().includes('Request for helper-a'));
    app.confirmWithdrawal();
    if (fails) app.mutations[0].reject(Error('Old account failure'));
    else app.mutations[0].resolve();
    await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, true, 'Old completion must not release new account mutation');
    assert.ok(!app.content().includes('Old account failure'));
    assert.ok(!app.content().includes('Your decision was saved.'));
    assert.ok(!app.content().includes('Request for helper-a'));
    app.mutations[1].resolve(); await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, false);
    assert.ok(app.content().includes('Withdrawn'));
    assert.deepEqual(app.calls.filter(call => call.kind === 'write').map(call => call.userId), ['helper-a', 'helper-b']);
    pass('old account ' + (fails ? 'failure' : 'success') + ' cannot unlock or overwrite the new account mutation');
  }

  {
    const app = harness();
    await app.settle(); app.confirmWithdrawal();
    app.switchAccount('helper-b'); await app.settle(); app.confirmWithdrawal();
    app.switchAccount('helper-a'); await app.settle(); app.confirmWithdrawal();
    app.mutations[0].resolve(); await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, true, 'An earlier operation for the same account must not release a newer one');
    app.mutations[1].resolve(); await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, true);
    app.mutations[2].resolve(); await app.settle();
    assert.equal(app.button('Refresh offers').props.disabled, false);
    pass('returning to the original account keeps a newer mutation locked when an older one finishes');
  }

  {
    const app = harness();
    await app.settle(); app.press('Withdraw offer');
    const staleConfirmation = app.alerts.at(-1).buttons.find(item => item.text === 'Withdraw');
    app.blur(); app.focus(); await app.settle();
    staleConfirmation.onPress(); await app.settle();
    assert.equal(app.mutations.length, 0);
    assert.equal(app.button('Withdraw offer').props.disabled, false);
    pass('a confirmation from an earlier focus session cannot submit after returning');
  }
  console.log('Offer lifecycle checks passed: ' + checks + '.');
})().catch(error => { console.error(error); process.exitCode = 1; });
