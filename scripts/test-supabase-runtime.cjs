/* global __dirname */
// Exercise production runtime selection and the installed SDK without contacting a backend.
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const sdk = require(path.join(root, 'node_modules/@supabase/supabase-js'));
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/supabase.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const backend = 'https://campusclutch-runtime.invalid';
const key = 'synthetic-publishable-key';
const userId = 'a0000000-0000-4000-8000-000000000001';
const clients = [];
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }

function production(os, storage, createClient, browserWindow) {
  const exports = {};
  const modules = {
    '@/lib/crypto': {}, 'react-native-url-polyfill/auto': {},
    '@react-native-async-storage/async-storage': { default: storage, __esModule: true },
    '@supabase/supabase-js': { createClient, processLock: sdk.processLock },
    'react-native': { Platform: { OS: os } },
    '@/lib/env': { env: { supabaseUrl: backend, supabasePublishableKey: key } },
  };
  const globals = browserWindow === undefined ? {} : { window: browserWindow };
  vm.runInNewContext(source, { exports, ...globals, require: name => {
    if (!(name in modules)) throw Error('Unexpected import: ' + name);
    return modules[name];
  } }, { filename: 'src/lib/supabase.ts' });
  return exports.supabase;
}

function browserStorage() {
  const values = new Map(), operations = [];
  const browserWindow = { localStorage: {
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
  const values = new Map(), operations = [];
  return { values, operations, storage: {
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

  await test('browser and native runtimes retain persistent AsyncStorage and refresh', () => {
    for (const [os, browserWindow] of [['web', {}], ['android', undefined], ['ios', undefined]]) {
      const storage = {};
      const config = production(os, storage, (_url, _key, options) => options, browserWindow);
      assert.equal(config.auth.storage, storage, os);
      assert.equal(config.auth.persistSession, true, os);
      assert.equal(config.auth.autoRefreshToken, true, os);
    }
  });

  await test('all runtimes preserve PKCE, explicit URL handling and process locking', () => {
    for (const [os, browserWindow] of [['web', undefined], ['web', {}], ['android', undefined], ['ios', undefined]]) {
      const config = production(os, {}, (_url, _key, options) => options, browserWindow);
      assert.equal(config.auth.flowType, 'pkce');
      assert.equal(config.auth.detectSessionInUrl, false);
      assert.equal(config.auth.lock, sdk.processLock);
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

  await test('installed browser AsyncStorage persists real SDK sign-in across client reloads', async () => {
    const browser = browserStorage();
    const first = realClient('web', browser.storage, browser.browserWindow);
    assert.equal(await session(first.supabase), null);
    await syntheticSignIn(first.supabase);
    assert.ok(browser.operations.some(([operation]) => operation === 'set'));
    const next = realClient('web', browser.storage, browser.browserWindow);
    assert.equal((await session(next.supabase)).user.id, userId);
    assert.equal(first.requests.length, 1);
    assert.equal(next.requests.length, 0);
    await browser.storage.removeItem('sb-campusclutch-runtime-auth-token');
    const signedOutReload = realClient('web', browser.storage, browser.browserWindow);
    assert.equal(await session(signedOutReload.supabase), null);
  });

  await test('native without window still restores the persisted session through AsyncStorage', async () => {
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
  });
  console.log(`Supabase runtime regressions: ${checks} passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(clients.map(client => client.auth.stopAutoRefresh()));
});
