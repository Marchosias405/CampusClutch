/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness() {
  const slots = [], effects = [], listeners = new Set(), timers = new Set(), requests = [];
  let cursor = 0, dirty = true, value, focusCallback, focusCleanup, focused = true, user = 'first';
  const same = (a, b) => a?.length === b?.length && a.every((item, i) => Object.is(item, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = { value: initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
  };
  const AppState = { currentState: 'active', addEventListener: (_event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/useModerationAccess.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports,
    setInterval: (fn, delay) => { assert.equal(delay, 30000); timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn),
    require: name => {
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState };
      if (name === 'expo-router') return { useFocusEffect: fn => {
        if (fn !== focusCallback) { focusCallback = fn; effects.push(() => { focusCleanup?.(); focusCleanup = focused ? fn() : null; }); }
      } };
      if (name === './moderation') return { getModerationAccess: actor => { const pending = deferred(); requests.push({ actor, ...pending }); return pending.promise; } };
      throw Error(name);
    },
  });
  function render() {
    let count = 0;
    while (dirty) { assert.ok(++count < 50); dirty = false; cursor = 0; value = exports.useModerationAccess(user); while (effects.length) effects.shift()(); }
  }
  async function settle() { await tick(); render(); }
  function focus(next) { focused = next; focusCleanup?.(); focusCleanup = next ? focusCallback() : null; render(); }
  function background(next) { AppState.currentState = next; for (const listener of [...listeners]) listener(next); render(); }
  render();
  return { requests, value: () => value, settle, focus, background, render,
    poll() { for (const timer of [...timers]) timer(); render(); },
    account(next) { user = next; dirty = true; render(); },
    close() { focusCleanup?.(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); },
  };
}
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('unassigned accounts are denied and granted roles become visible only after server confirmation', async () => {
    const h = harness(); assert.equal(h.value().status, 'checking');
    h.requests[0].resolve(null); await h.settle(); assert.equal(h.value().status, 'denied');
    h.poll(); h.requests.at(-1).resolve('moderator'); await h.settle(); assert.equal(h.value().status, 'allowed'); h.close();
  });
  await test('backgrounding hides private content and late responses cannot restore it', async () => {
    const h = harness(); const first = h.requests[0]; h.background('background');
    assert.equal(h.value().status, 'hidden'); first.resolve('admin'); await h.settle(); assert.equal(h.value().status, 'hidden');
    h.background('active'); assert.equal(h.value().status, 'checking'); h.requests.at(-1).resolve('moderator'); await h.settle();
    assert.equal(h.value().status, 'allowed'); h.close();
  });
  await test('blur clears access and refocus rechecks; stale results from an older focus are ignored', async () => {
    const h = harness(); const old = h.requests[0]; h.focus(false); assert.equal(h.value().status, 'hidden');
    h.focus(true); h.requests.at(-1).resolve(null); await h.settle(); old.resolve('admin'); await h.settle();
    assert.equal(h.value().status, 'denied'); h.close();
  });
  await test('polling detects revocation and network failure, without clearing valid editor state on a successful check', async () => {
    const h = harness(); h.requests[0].resolve('admin'); await h.settle();
    h.poll(); assert.equal(h.value().status, 'allowed'); h.poll(); assert.equal(h.requests.length, 2, 'no overlapping polls');
    h.requests[1].resolve(null); await h.settle(); assert.equal(h.value().status, 'denied');
    h.value().retry(); h.render(); assert.equal(h.value().status, 'checking');
    h.requests.at(-1).reject(Error('offline')); await h.settle(); assert.equal(h.value().status, 'unavailable'); h.close();
  });
  await test('explicit access loss invalidates an in-flight poll and requires a fresh check', async () => {
    const h = harness(); h.requests[0].resolve('admin'); await h.settle(); h.poll(); const late = h.requests.at(-1);
    h.value().invalidate(); h.render(); assert.equal(h.value().status, 'unavailable'); late.resolve('admin'); await h.settle();
    assert.equal(h.value().status, 'unavailable'); h.value().retry(); h.render(); h.requests.at(-1).resolve('moderator'); await h.settle();
    assert.equal(h.value().status, 'allowed'); h.close();
  });
  await test('changed users cannot inherit a prior user’s late authorization', async () => {
    const h = harness(); const old = h.requests[0]; h.account('second'); assert.equal(h.requests.at(-1).actor, 'second');
    h.requests.at(-1).resolve(null); await h.settle(); old.resolve('admin'); await h.settle(); assert.equal(h.value().status, 'denied'); h.close();
  });
  console.log(`Moderation access lifecycle checks passed: ${checks}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
