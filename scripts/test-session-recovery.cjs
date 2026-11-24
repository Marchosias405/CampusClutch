/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../src/context/AuthContext.tsx');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

const saved = { user: { id: 'saved-user' }, access_token: 'older-test-token' };
const newer = { user: { id: 'new-user' }, access_token: 'newer-test-token' };
const ok = session => ({ data: { session }, error: null });

function provider() {
  const slots = [], effects = [], cleanups = [], reads = [], signIns = [], refresh = [], signups = [], resends = [];
  const draftEvents = [];
  let cursor, value, authEvent, appEvent, unsubscribed = false, appRemoved = false, stateWrites = 0;
  const memo = (factory, deps) => {
    const i = cursor++;
    if (!slots[i] || deps.some((dep, j) => !Object.is(dep, slots[i].deps[j]))) slots[i] = { deps, value: factory() };
    return slots[i].value;
  };
  const react = {
    createContext: () => ({ Provider: 'AuthContext.Provider' }),
    createElement: (type, props) => ({ type, props }),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => {
        stateWrites++;
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
      }];
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(callback, deps) {
      const i = cursor++;
      if (slots[i] && deps.every((dep, j) => Object.is(dep, slots[i][j]))) return;
      slots[i] = deps;
      effects.push(() => { cleanups[i]?.(); cleanups[i] = callback(); });
    },
  };
  const modules = {
    react,
    'react-native': { AppState: {
      currentState: 'active',
      addEventListener(name, callback) {
        assert.equal(name, 'change');
        appEvent = callback;
        return { remove: () => { appRemoved = true; } };
      },
    } },
    '@/lib/privateDrafts': { privateDrafts: { setSession: async (session, restored) => { draftEvents.push({ session, restored }); } } },
    '@/lib/passwordRecovery': { sendPasswordRecoveryEmail: async () => null },
    '@/lib/env': { env: { supabaseUrl: 'https://preview.example.test' } },
    '@/lib/supabase': { supabase: { auth: {
      getSession: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
      onAuthStateChange(callback) {
        authEvent = callback;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
      startAutoRefresh: () => refresh.push('start'),
      stopAutoRefresh: () => refresh.push('stop'),
      signUp: async credentials => { signups.push(credentials); return { data: { session: null }, error: null }; },
      resend: async credentials => { resends.push(credentials); return { error: null }; },
      signInWithPassword: async credentials => { signIns.push(credentials); return { error: null }; },
    } } },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    assert.ok(name in modules, 'Unexpected dependency ' + name);
    return modules[name];
  } });
  function render() {
    cursor = 0;
    value = exports.AuthProvider({ children: null }).props.value;
    while (effects.length) effects.shift()();
    return value;
  }
  render();
  return {
    reads, signIns, refresh, render, signups, resends, draftEvents,
    emit: (event, session) => authEvent(event, session),
    changeAppState: state => appEvent(state),
    stateWrites: () => stateWrites,
    closed: () => unsubscribed && appRemoved,
    unmount: () => cleanups.forEach(cleanup => cleanup?.()),
    async settle() { await new Promise(setImmediate); return render(); },
  };
}

test('startup waits for the saved session and distinguishes a signed-out device', async () => {
  for (const session of [null, saved]) {
    const app = provider();
    assert.equal(app.render().isRestoringSession, true);
    app.emit('INITIAL_SESSION', null);
    assert.equal(app.render().isRestoringSession, true, 'the initial event may mask a storage error');
    app.reads[0].resolve(ok(session));
    const state = await app.settle();
    assert.equal(state.isRestoringSession, false);
    assert.equal(state.session, session);
    assert.equal(state.user, session?.user ?? null);
    assert.equal(state.restorationError, null);
    app.unmount();
  }
});

test('draft migration accepts an SDK-restored login and ignores stale or failed initial reads', async () => {
  const app = provider();
  app.emit('INITIAL_SESSION', null);
  app.reads[0].reject(Error('Temporarily locked'));
  await app.settle();
  assert.deepEqual(app.draftEvents, []);
  const pending = app.render().retrySessionRestore();
  app.emit('SIGNED_IN', saved);
  app.reads.at(-1).resolve(ok(null));
  await pending;
  app.emit('TOKEN_REFRESHED', saved);
  app.emit('SIGNED_OUT', null);
  assert.deepEqual(app.draftEvents, [
    { session: saved, restored: true }, { session: saved, restored: false }, { session: null, restored: false },
  ]);
  app.unmount();
});

test('interactive login cannot adopt legacy drafts during a slow initial restore', async () => {
  const app = provider();
  await app.render().signIn('student@example.com', 'fixture');
  app.emit('SIGNED_IN', newer);
  app.reads[0].resolve(ok(saved));
  await app.settle();
  assert.deepEqual(app.draftEvents, [{ session: newer, restored: false }]);
  app.unmount();
});

test('a returned session error can be retried without losing the saved identity', async () => {
  const app = provider();
  app.reads[0].resolve({ data: { session: null }, error: { message: 'Storage is unavailable' } });
  const failed = await app.settle();
  assert.equal(failed.isRestoringSession, false);
  assert.ok(failed.restorationError);
  app.emit('INITIAL_SESSION', null);
  assert.ok(app.render().restorationError, 'a delayed initial event must not erase the error');
  const retry = failed.retrySessionRestore();
  assert.equal(app.render().isRestoringSession, true);
  app.reads.at(-1).resolve(ok(saved));
  await retry;
  const restored = await app.settle();
  assert.equal(restored.user, saved.user);
  assert.equal(restored.restorationError, null);
  assert.equal(restored.isRestoringSession, false);
  app.unmount();
});

test('a rejected storage read also leaves the loading state and offers recovery', async () => {
  const app = provider();
  app.reads[0].reject(Error('Storage read rejected'));
  const state = await app.settle();
  assert.ok(state.restorationError);
  assert.equal(state.isRestoringSession, false);
  assert.equal(state.user, null);
  assert.equal(typeof state.retrySessionRestore, 'function');
  app.unmount();
});

test('a slow saved session cannot replace newer auth events or undo sign-out', async () => {
  for (const [event, session] of [['SIGNED_IN', newer], ['TOKEN_REFRESHED', newer], ['SIGNED_OUT', null], ['PASSWORD_RECOVERY', newer]]) {
    const app = provider();
    app.emit(event, session);
    app.reads[0].resolve(ok(saved));
    const state = await app.settle();
    assert.equal(state.session, session, event);
    assert.equal(state.isPasswordRecovery, event === 'PASSWORD_RECOVERY');
    assert.equal(state.isRestoringSession, false);
    assert.equal(state.restorationError, null);
    app.unmount();
  }
});

test('sign-in during a restore retry wins even if the read subsequently fails', async () => {
  const app = provider();
  app.reads[0].resolve({ data: { session: null }, error: { message: 'Offline' } });
  const failed = await app.settle();
  const retry = failed.retrySessionRestore();
  app.emit('SIGNED_IN', newer);
  app.reads.at(-1).reject(Error('Old retry failed'));
  await retry;
  const state = await app.settle();
  assert.equal(state.user, newer.user);
  assert.equal(state.restorationError, null);
  assert.equal(state.isRestoringSession, false);
  app.unmount();
});

test('password recovery survives a token refresh and ends on sign-out', async () => {
  const app = provider();
  app.reads[0].resolve(ok(null));
  await app.settle();
  app.emit('PASSWORD_RECOVERY', saved);
  app.emit('TOKEN_REFRESHED', { ...saved, access_token: 'refreshed-test-token' });
  assert.equal(app.render().isPasswordRecovery, true);
  app.emit('SIGNED_OUT', null);
  const state = app.render();
  assert.equal(state.isPasswordRecovery, false);
  assert.equal(state.user, null);
  app.unmount();
});

test('auth provider normalizes the email and preserves the password for sign-in', async () => {
  const app = provider();
  await app.render().signIn('  Student@Example.COM  ', ' Case Sensitive! ');
  assert.equal(app.signIns.length, 1);
  assert.equal(app.signIns[0].email, 'student@example.com');
  assert.equal(app.signIns[0].password, ' Case Sensitive! ');
  app.unmount();
});

test('backgrounding pauses token refresh and unmount ignores late reads and auth callbacks', async () => {
  const app = provider();
  app.changeAppState('background');
  app.changeAppState('active');
  app.unmount();
  assert.deepEqual(app.refresh, ['start', 'stop', 'start', 'stop']);
  assert.ok(app.closed());
  const writes = app.stateWrites();
  app.emit('SIGNED_IN', newer);
  app.reads[0].resolve(ok(saved));
  await new Promise(setImmediate);
  assert.equal(app.stateWrites(), writes);
});

test('signup and resend use the public browser callback, independent of the email-reading device', async () => {
  const app = provider(); app.reads[0].resolve(ok(null)); await app.settle();
  const result = await app.render().signUp(' Student@Example.com ', 'fixture-password');
  assert.equal(result.verificationRequired, true);
  assert.equal(await app.render().resendVerification(' Student@Example.com '), null);
  assert.equal(app.signups[0].email, 'student@example.com');
  assert.equal(app.resends[0].type, 'signup');
  assert.equal(app.signups[0].options.emailRedirectTo, 'https://preview.example.test/functions/v1/email-verified');
  assert.equal(app.resends[0].options.emailRedirectTo, app.signups[0].options.emailRedirectTo);
  app.unmount();
});
