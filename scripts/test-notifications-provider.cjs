/* global __dirname */
// Run production count state and UI wiring without a device or a network connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const CHAT = 'c0000000-0000-4000-8000-000000000003';
const tick = () => new Promise(setImmediate);
function production(file, modules = {}, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...globals, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name); return modules[name];
  } }, { filename: file });
  return exports;
}
const { createUnreadMessages } = production('src/lib/unreadMessages.ts');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
async function resolveAll(h, count) { for (let round = 0; round < 3; ++round) { h.requests.forEach(request => request.resolve(count)); await h.settle(); } }
function providerHarness(initial = {}) {
  const state = { userId: A, token: 'token-a', completed: true, path: '/', ...initial };
  const slots = [], effects = [], listeners = new Set(), timers = new Map(), requests = [], connections = [];
  let cursor = 0, dirty = true, tree, timerId = 0;
  const equal = (left, right) => left?.length === right?.length && left.every((item, index) => Object.is(item, right[index]));
  const react = {
    createElement,
    createContext: () => ({ Provider: 'UnreadProvider' }),
    useContext: () => tree?.props.value,
    useMemo(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: callback(), deps };
      return slots[index].value;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index]) slots[index] = {};
      const slot = slots[index];
      if (!equal(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = callback(); });
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor++;
      if (slots[index]?.subscribe !== subscribe) {
        slots[index]?.cleanup?.(); slots[index] = { subscribe, cleanup: subscribe(() => { dirty = true; }) };
      }
      return getSnapshot();
    },
  };
  const AppState = { currentState: initial.appState ?? 'active', addEventListener: (_event, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } };
  const timerGlobals = {
    setTimeout: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration, repeat: false }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, duration) => { const id = ++timerId; timers.set(id, { callback, duration, repeat: true }); return id; },
    clearInterval: id => timers.delete(id),
  };
  function flushRealtime() {
    for (const [id, timer] of [...timers]) if (!timer.repeat && timer.duration === 100) {
      timers.delete(id); timer.callback();
    }
  }
  const realtime = production('src/lib/messagesRealtime.ts', {}, timerGlobals);
  const modules = {
    react, 'expo-router': { usePathname: () => state.path }, 'react-native': { AppState },
    '../lib/unreadMessages': { createUnreadMessages },
    '../lib/notifications': { loadUnreadNotificationCount: userId => { const pending = deferred(); requests.push({ userId, ...pending }); return pending.promise; } },
    '../lib/messagesRealtime': realtime,
    '../lib/notificationsRealtimeTransport': { connectAccountNotifications: (userId, token) => callbacks => {
      const connection = { userId, token, ...callbacks, closed: 0 }; connections.push(connection);
      return () => { connection.closed++; };
    } },
    './AuthContext': { useAuth: () => ({ user: state.userId ? { id: state.userId } : null,
      session: state.token ? { access_token: state.token } : null, isPasswordRecovery: !!state.recovery }) },
    './ProfileContext': { useProfile: () => ({ isProfileComplete: state.completed,
      profile: state.userId ? { id: state.profileId ?? state.userId } : null }) },
  };
  const component = production('src/context/NotificationsContext.tsx', modules).NotificationsProvider;
  function render(runEffects = true) {
    let rounds = 0;
    while (dirty) {
      assert.ok(++rounds < 100); dirty = false; cursor = 0; tree = component({ children: 'app' });
      if (runEffects) { while (effects.length) effects.shift()(); flushRealtime(); }
    }
  }
  async function settle() { for (let i = 0; i < 4; i++) { render(); await tick(); } render(); }
  function mutate(patch, runEffects = true) { Object.assign(state, patch); dirty = true; render(runEffects); }
  function flushEffects() { while (effects.length) effects.shift()(); render(); }
  function appState(value) { AppState.currentState = value; for (const listener of listeners) listener(value); render(); }
  function unmount() { for (const slot of slots) slot?.cleanup?.(); }
  render();
  return { requests, timers, connections, flushRealtime, settle, mutate, flushEffects, appState, unmount, value: () => tree.props.value };
}


(async () => {
  await test('notification provider loads authoritative count and preserves it on transient errors', async () => {
    const h = providerHarness(); await resolveAll(h, 8); assert.equal(h.value().unreadCount, 8);
    const pending = h.value().refreshUnread(); h.requests.at(-1).reject(Error('offline')); await pending; await h.settle();
    assert.equal(h.value().unreadCount, 8); h.unmount();
  });
  await test('account switch hides prior count immediately before effect cleanup and discards its late responses', async () => {
    const h = providerHarness(); await resolveAll(h, 8); void h.value().refreshUnread(); const old = h.requests.at(-1);
    h.mutate({ userId: B, token: 'token-b' }, false); assert.equal(h.value().unreadCount, 0);
    h.flushEffects(); old.resolve(99); await h.settle(); assert.equal(h.value().unreadCount, 0);
    assert.ok(h.connections[0].closed > 0); await resolveAll(h, 2); assert.equal(h.value().unreadCount, 2); h.unmount();
  });
  await test('signed-out, incomplete, stale-profile and password-recovery accounts never subscribe or load', async () => {
    for (const initial of [{ userId: null, token: null }, { completed: false }, { profileId: B }, { recovery: true }]) {
      const h = providerHarness(initial); await h.settle(); assert.equal(h.requests.length, 0); assert.equal(h.connections.length, 0);
      assert.equal(h.value().unreadCount, 0); h.unmount();
    }
  });
  await test('foreground recovery creates a fresh subscription and count, background suppresses responses', async () => {
    const h = providerHarness(); await resolveAll(h, 3); void h.value().refreshUnread(); const old = h.requests.at(-1);
    h.appState('background'); assert.ok(h.connections[0].closed > 0); old.resolve(90); await h.settle(); assert.equal(h.value().unreadCount, 3);
    h.appState('active'); await resolveAll(h, 4); assert.equal(h.connections.length, 2); assert.equal(h.value().unreadCount, 4); h.unmount();
  });
  await test('token replacement retires old channel callbacks without losing account count', async () => {
    const h = providerHarness(); await resolveAll(h, 5); const first = h.connections[0];
    h.mutate({ token: 'token-a-new' }); await resolveAll(h, 5); const seen = [];
    h.value().subscribeNotifications(value => seen.push(value)); first.changed(A); first.ready(); h.flushRealtime();
    assert.equal(seen.length, 0); const current = h.connections.at(-1); current.changed(A); h.flushRealtime();
    assert.equal(seen.length, 1); assert.equal(current.token, 'token-a-new'); assert.equal(h.value().unreadCount, 5); h.unmount();
  });
  await test('route changes refresh notifications without recreating its account store or subscription', async () => {
    const h = providerHarness(); await resolveAll(h, 6); const refresh = h.value().refreshUnread; const connections = h.connections.length;
    const count = h.requests.length; h.mutate({ path: '/notifications' }); assert.ok(h.requests.length > count);
    assert.equal(h.value().refreshUnread, refresh); assert.equal(h.connections.length, connections); h.unmount();
  });
  await test('unmount closes private channels and cancels all reconnect and fallback timers', () => {
    const h = providerHarness(); h.connections[0].unavailable(); h.unmount(); assert.equal(h.timers.size, 0); assert.equal(h.connections[0].closed, 1);
  });
  console.log(`Notification provider: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
