/* global __dirname */
// Exercise production runtime selection and the installed SDK without contacting a backend.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const sdk = require(path.join(root, 'node_modules/@supabase/supabase-js'));
function load(file, modules, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, URL, ...globals, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name);
    return modules[name];
  } }, { filename: file });
  return exports;
}
const backend = 'https://campusclutch-runtime.invalid';
const key = 'synthetic-publishable-key';
const userId = 'a0000000-0000-4000-8000-000000000001';
const clients = [];
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }

function production(os, storage, createClient, browserWindow) {
  const modules = {
    '@/lib/crypto': {}, 'react-native-url-polyfill/auto': {},
    '@react-native-async-storage/async-storage': { default: storage, __esModule: true },
    '@supabase/supabase-js': { createClient, processLock: sdk.processLock, navigatorLock: sdk.navigatorLock },
    'react-native': { Platform: { OS: os } },
    '@/lib/env': { env: { supabaseUrl: backend, supabasePublishableKey: key } },
  };
  const globals = browserWindow === undefined ? {} : { window: browserWindow, navigator: { locks: {} } };
  modules['./credentialMigration'] = load('credentialMigration.ts', {});
  modules['expo-secure-store'] = storage.keychain;
  modules['react-native-quick-crypto'] = { ...crypto, Buffer };
  modules['./credentialStorage'] = load(os === 'web' ? 'credentialStorage.ts' : 'credentialStorage.native.ts', modules, globals);
  return load('supabase.ts', modules, globals).supabase;
}

function browserStorage() {
  const values = new Map(), operations = [];
  const browserWindow = { localStorage: {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: item => { operations.push(['get', item]); return values.get(item) ?? null; },
    setItem: (item, value) => { operations.push(['set', item]); values.set(item, String(value)); },
    removeItem: item => { operations.push(['remove', item]); values.delete(item); },
  } };
  // Use the same installed web adapter named in the reported stack trace.
  const exports = {};
  const file = path.join(root, 'node_modules/@react-native-async-storage/async-storage/lib/commonjs/AsyncStorage.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports, window: browserWindow, require: name => {
    assert.equal(name, 'merge-options'); return require(path.join(root, 'node_modules/merge-options'));
  } }, { filename: file });
  return { storage: exports.default, browserWindow, values, operations };
}

function nativeStorage() {
  const values = new Map(), keys = new Map(), operations = [];
  return { values, operations, storage: {
    getAllKeys: async () => [...values.keys()],
    keychain: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
      getItemAsync: async k => keys.get(k) ?? null,
      setItemAsync: async (k,v) => { assert.ok(v.length < 100); keys.set(k,v); },
      deleteItemAsync: async k => { keys.delete(k); } },
    getItem: async item => { operations.push(['get', item]); return values.get(item) ?? null; },
    setItem: async (item, value) => { operations.push(['set', item]); values.set(item, value); },
    removeItem: async item => { operations.push(['remove', item]); values.delete(item); },
  } };
}

function fakeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp: expiresAt })}.synthetic-signature`,
    refresh_token: 'synthetic-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'runtime-test@example.invalid',
      app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
}

function realClient(os, storage, browserWindow) {
  const requests = [];
  const supabase = production(os, storage, (url, publishableKey, options) => {
    assert.equal(url, backend); assert.equal(publishableKey, key);
    const client = sdk.createClient(url, publishableKey, { ...options, global: {
      fetch: async (input, init) => {
        const requestUrl = String(input);
        requests.push(requestUrl);
        assert.equal(requestUrl, backend + '/auth/v1/token?grant_type=password', 'Unexpected auth network operation');
        assert.equal(init.method, 'POST');
        assert.equal(JSON.parse(init.body).email, 'runtime-test@example.invalid');
        return new Response(JSON.stringify(fakeSession()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    } });
    clients.push(client);
    return client;
  }, browserWindow);
  return { supabase, requests };
}

async function session(client) {
  const result = await client.auth.getSession();
  assert.equal(result.error, null);
  return result.data.session;
}

async function syntheticSignIn(client) {
  const result = await client.auth.signInWithPassword({ email: 'runtime-test@example.invalid', password: 'synthetic-test-password' });
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, userId);
}

(async () => {
  await test('web server has no browser storage, persistence or token-refresh timer', () => {
    const storage = {};
    const config = production('web', storage, (_url, _key, options) => options);
    assert.equal(config.auth.storage, undefined);
    assert.equal(config.auth.persistSession, false);
    assert.equal(config.auth.autoRefreshToken, false);
  });

  await test('browser and native use protected persistent storage and refresh while running', () => {
    for (const [os, browserWindow] of [['web', browserStorage().browserWindow], ['android', undefined], ['ios', undefined]]) {
      const storage = {};
      const config = production(os, storage, (_url, _key, options) => options, browserWindow);
      assert.ok(config.auth.storage, os);
      assert.notEqual(config.auth.storage, storage, os);
      assert.equal(config.auth.persistSession, true, os);
      assert.equal(config.auth.autoRefreshToken, true, os);
    }
  });

  await test('all runtimes preserve PKCE and explicit URL handling, and browser tabs coordinate refreshes', () => {
    for (const [os, browserWindow] of [['web', undefined], ['web', browserStorage().browserWindow], ['android', undefined], ['ios', undefined]]) {
      const config = production(os, {}, (_url, _key, options) => options, browserWindow);
      assert.equal(config.auth.flowType, 'pkce');
      assert.equal(config.auth.detectSessionInUrl, false);
      assert.equal(config.auth.lock, browserWindow ? sdk.navigatorLock : sdk.processLock);
    }
  });

  await test('real SDK initialization and initial-session event avoid window-dependent storage on web server', async () => {
    let attemptedStorage = 0;
    const unavailableStorage = {};
    for (const method of ['getItem', 'setItem', 'removeItem']) unavailableStorage[method] = async () => {
      attemptedStorage++; throw new ReferenceError('window is not defined');
    };
    const { supabase, requests } = realClient('web', unavailableStorage);
    let resolveInitial, initialTimeout;
    const initial = new Promise((resolve, reject) => {
      resolveInitial = resolve;
      initialTimeout = setTimeout(() => reject(Error('INITIAL_SESSION was not emitted')), 2000);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, current) => {
      if (event === 'INITIAL_SESSION') resolveInitial(current);
    });
    try {
      assert.equal(await session(supabase), null);
      assert.equal(await initial, null);
      assert.equal(attemptedStorage, 0);
      assert.equal(requests.length, 0);
    } finally { clearTimeout(initialTimeout); subscription.unsubscribe(); }
  });

  await test('server sessions are in memory and cannot restore a previous client session', async () => {
    const supplied = nativeStorage();
    const first = realClient('web', supplied.storage);
    assert.equal(await session(first.supabase), null);
    await syntheticSignIn(first.supabase);
    assert.equal((await session(first.supabase)).user.id, userId);
    const next = realClient('web', supplied.storage);
    assert.equal(await session(next.supabase), null);
    assert.equal((await session(first.supabase)).user.id, userId);
    assert.equal(supplied.operations.length, 0);
    assert.equal(supplied.values.size, 0);
    assert.equal(first.requests.length, 1);
    assert.equal(next.requests.length, 0);
  });

  await test('browser removes legacy plaintext credentials before opening protected storage', async () => {
    const browser = browserStorage();
    const item = 'sb-campusclutch-runtime-auth-token';
    for (const suffix of ['', '-user', '-code-verifier']) browser.values.set(item + suffix, 'old credential');
    browser.values.set('sb-other-dev-auth-token', 'old development credential');
    browser.values.set('unrelated', 'retained');
    const config = production('web', browser.storage, (_url, _key, options) => options, browser.browserWindow);
    assert.ok(config.auth.storage);
    assert.deepEqual([...browser.values], [['unrelated','retained']]);
    assert.ok(!browser.operations.some(([operation]) => operation === 'set'));
  });

  await test('browser startup migrates every legacy receipt independently and retries an interrupted write', async () => {
    const { storage, browserWindow, values } = browserStorage();
    const prefix = 'campusclutch:account-deletion:v1:';
    const current = prefix + encodeURIComponent('http://127.0.0.1:54321');
    const previous = prefix + encodeURIComponent('https://past-project.invalid');
    const unrelated = previous + ':display';
    values.set(current, 'pending current receipt');
    values.set(previous, 'pending previous receipt');
    values.set(unrelated, 'keep');
    const protectedValues = new Map();
    let interrupt = true;
    const failed = [];
    const protectedStore = {
      getItem: async name => protectedValues.get(name) ?? null,
      async setItem(name, value) {
        if (interrupt && name === previous) {
          failed.push(name);
          throw Error('Interrupted protected write');
        }
        protectedValues.set(name, value);
      },
      removeItem: async name => { protectedValues.delete(name); },
    };
    const migration = load('credentialMigration.ts', {});
    const web = load('credentialStorage.ts', {
      '@react-native-async-storage/async-storage': { default: storage, __esModule: true },
      './credentialMigration': {
        ...migration,
        migrateCredentials: (_indexedDb, legacy) => migration.migrateCredentials(protectedStore, legacy),
      },
    }, { window: browserWindow });
    async function start() {
      assert.ok(web.sessionStorageForProject());
      await new Promise(setImmediate); // Drain the in-memory stores' queued promises.
    }
    await start();
    assert.deepEqual(failed, [previous]);
    assert.equal(protectedValues.get(current), 'pending current receipt');
    assert.equal(values.has(current), false);
    assert.equal(values.get(previous), 'pending previous receipt');
    interrupt = false;
    values.set(current, 'stale duplicate');
    await start();
    assert.equal(await web.credentialStorage.getItem(current), 'pending current receipt');
    assert.equal(protectedValues.get(previous), 'pending previous receipt');
    assert.deepEqual([...values], [[unrelated, 'keep']]);
    assert.equal(protectedValues.has(unrelated), false);
  });

  await test('native restores signed-in sessions across launches with only ciphertext in AsyncStorage', async () => {
    const native = nativeStorage();
    const first = realClient('android', native.storage);
    assert.equal(await session(first.supabase), null);
    await syntheticSignIn(first.supabase);
    const next = realClient('android', native.storage);
    assert.equal((await session(next.supabase)).user.id, userId);
    assert.ok(native.operations.some(([operation]) => operation === 'set'));
    assert.ok(native.operations.some(([operation]) => operation === 'get'));
    assert.equal(first.requests.length, 1);
    assert.equal(next.requests.length, 0);
    assert.ok(!JSON.stringify([...native.values.values()]).includes('synthetic-refresh-token'));
    assert.ok(!native.values.has('sb-campusclutch-runtime-auth-token'));
  });

  await test('native migrates active session and PKCE companion, handles large data, and serializes sign-out', async () => {
    const native = nativeStorage();
    const item = 'sb-campusclutch-runtime-auth-token';
    const old = fakeSession();
    old.user.user_metadata = { description: 'long profile '.repeat(1100) };
    native.values.set(item, JSON.stringify(old)); native.values.set(item + '-code-verifier','private verifier');
    native.values.set('sb-other-dev-auth-token', JSON.stringify(old));
    native.values.set('unrelated', 'keep');
    const client = realClient('android', native.storage);
    assert.equal((await session(client.supabase)).user.id, userId);
    assert.ok(!native.values.has(item));
    assert.ok(!native.values.has(item + '-code-verifier'));
    assert.ok(!native.values.has('sb-other-dev-auth-token'));
    assert.equal(native.values.get('unrelated'),'keep');
    assert.ok([...native.values.values()].every(v => !v.includes('long profile') && !v.includes('private verifier')));
    const adapter = production('android', native.storage, (_u, _k, options) => options).auth.storage;
    const read = adapter.getItem(item);
    const signout = adapter.removeItem(item);
    assert.equal(JSON.parse(await read).user.id, userId);
    await signout;
    assert.equal(await adapter.getItem(item), null);
  });

  await test('failed protected write preserves legacy data for retry and never falls back to a plaintext write', async () => {
    const native = nativeStorage();
    native.values.set('receipt','pending-deletion');
    const write = native.storage.keychain.setItemAsync;
    native.storage.keychain.setItemAsync = async () => { throw Error('Keystore locked'); };
    const adapter = production('android', native.storage, (_u, _k, options) => options).auth.storage;
    await assert.rejects(adapter.getItem('receipt'), /Keystore locked/);
    assert.equal(native.values.get('receipt'), 'pending-deletion');
    await assert.rejects(adapter.setItem('new','secret'), /Keystore locked/);
    assert.equal(native.values.has('new'), false);
    native.storage.keychain.setItemAsync = write;
    assert.equal(await adapter.getItem('receipt'),'pending-deletion');
    assert.ok(!native.values.has('receipt'));
    const sealed = 'campusclutch:sealed:v1:receipt';
    const bytes = Buffer.from(native.values.get(sealed), 'base64'); bytes[28] ^= 1;
    native.values.set(sealed,bytes.toString('base64'));
    await assert.rejects(adapter.getItem('receipt'));
  });
  console.log(`Supabase runtime regressions: ${checks} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(clients.map(client => client.auth.stopAutoRefresh()));
});
