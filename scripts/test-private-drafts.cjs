/* global __dirname */
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const project = 'https://draft-test.invalid';
const alice = crypto.randomUUID();
const bob = crypto.randomUUID();
const dm = user => 'campusclutch:message-draft:v1:' + encodeURIComponent(project) + ':' + user + ':chat';
const report = user => 'campusclutch:report-draft:v1:' + encodeURIComponent(project) + ':' + user + ':student:target';
const deletionReceipt = 'campusclutch:account-deletion:v1:' + encodeURIComponent(project);
const otherProject = dm(alice).replace('draft-test', 'other');
const requestDraft = dm(alice).replace('message-draft', 'request-draft');
const prefix = 'campusclutch:sealed:v1:';
const attempts = [
  [dm(alice), JSON.stringify({ version: 1, draft: 'unfinished message', pending: { clientMessageId: crypto.randomUUID(), body: 'unfinished message' } })],
  [report(alice), JSON.stringify({ details: 'private report', pending: { operationId: crypto.randomUUID(), details: 'private report' } })],
];
function session(user, id = crypto.randomUUID(), sequence = 1) {
  return { user: { id: user }, access_token: 'header.' + Buffer.from(JSON.stringify({ sub: user, session_id: id, sequence })).toString('base64url') + '.signature' };
}
function load(name, modules) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', name + '.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: id => {
    assert.ok(id in modules, 'Unexpected dependency ' + id);
    return modules[id];
  } }, { filename: name });
  return exports;
}
function device(web = false) {
  const disk = new Map(), keychain = new Map();
  const local = {
    getAllKeys: async () => [...disk.keys()],
    getItem: async key => disk.get(key) ?? null,
    setItem: async (key, value) => { disk.set(key, value); },
    removeItem: async key => { disk.delete(key); },
  };
  const modules = {
    '@react-native-async-storage/async-storage': local,
    'expo-secure-store': {
      getItemAsync: async key => keychain.get(key) ?? null,
      setItemAsync: async (key, value) => { keychain.set(key, value); },
      deleteItemAsync: async key => { keychain.delete(key); },
    },
    'react-native-quick-crypto': { ...crypto, Buffer },
    './credentialMigration': load('credentialMigration', {}),
    'base64-js': require('base64-js'),
    'react-native': { Platform: { OS: web ? 'web' : 'android' } },
    './env': { env: { supabaseUrl: project } },
  };
  modules['./credentialStorage'] = load('credentialStorage.native', modules);
  const open = () => load('privateDrafts', modules).privateDrafts;
  return { disk, keychain, local, open };
}

test('upgrade protects both drafts, preserves exact pending attempts and removes unopened legacy drafts', async () => {
  const { open, disk, keychain } = device();
  const sid = crypto.randomUUID(), login = session(alice, sid);
  for (const [key, value] of attempts) disk.set(key, value);
  disk.set(dm(bob), 'old account');
  for (const key of [otherProject, deletionReceipt, requestDraft]) disk.set(key, 'untouched');
  const manager = open();
  await manager.setSession(login, true);
  const draft = manager.forAccount(alice);
  assert.equal(keychain.size, 2);
  for (const [key, value] of attempts) {
    assert.equal(disk.has(key), false);
    assert.equal(await draft.getItem(key), value);
    const ciphertext = disk.get(prefix + key + ':session:' + sid);
    assert.ok(ciphertext);
    assert.equal(Buffer.from(ciphertext, 'base64').includes(Buffer.from(value)), false);
  }
  assert.equal(disk.has(dm(bob)), false);
  await manager.setSession(session(alice, sid, 2));
  assert.equal(await draft.getItem(dm(alice)), attempts[0][1]);
  const restarted = open();
  await restarted.setSession(login, true);
  assert.equal(await restarted.forAccount(alice).getItem(report(alice)), attempts[1][1]);
  await restarted.setSession(null);
  for (const key of [otherProject, deletionReceipt, requestDraft]) assert.equal(disk.get(key), 'untouched');
  assert.equal(keychain.size, 0);
  assert.equal([...disk.keys()].some(k => k.startsWith(prefix)), false);
  await restarted.setSession(session(alice));
  assert.equal(await restarted.forAccount(alice).getItem(dm(alice)), null);
});

test('new login and signed-out startup discard legacy plaintext, including closed threads', async () => {
  for (const auth of [null, session(alice)]) {
    const { open, disk } = device();
    for (const [key, value] of attempts) disk.set(key, value);
    const manager = open();
    await manager.setSession(auth);
    for (const [key] of attempts) assert.equal(disk.has(key), false);
    if (auth) assert.equal(await manager.forAccount(alice).getItem(report(alice)), null);
  }
});

test('late writes cannot recreate a draft after sign-out or an immediate same-account login', async () => {
  const { open, local, disk, keychain } = device();
  const manager = open();
  await manager.setSession(session(alice));
  const old = manager.forAccount(alice);
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const write = local.setItem;
  local.setItem = async (key, value) => {
    if (key.startsWith(prefix)) { started(); await blocked; }
    await write(key, value);
  };
  const writing = old.setItem(dm(alice), 'private');
  await began;
  const logout = manager.setSession(null);
  const login = manager.setSession(session(alice));
  const late = old.setItem(report(alice), 'also private');
  release();
  await assert.rejects(writing, /session has ended/);
  await Promise.all([logout, login]);
  await assert.rejects(late, /session has ended/);
  assert.equal(await manager.forAccount(alice).getItem(dm(alice)), null);
  assert.equal(keychain.size, 0);
  assert.equal([...disk.keys()].some(k => k.startsWith(prefix)), false);
});

test('switching users and deletion isolate both accounts and preserve a pending deletion receipt', async () => {
  const { open, disk } = device();
  disk.set(deletionReceipt, 'pending fixture');
  const m = open();
  await m.setSession(session(alice));
  const a = m.forAccount(alice);
  await a.setItem(report(alice), 'Alice');
  await m.setSession(session(bob));
  const b = m.forAccount(bob);
  await assert.rejects(a.getItem(report(alice)), /session has ended/);
  await assert.rejects(b.getItem(dm(alice)), /session has ended/);
  await b.setItem(report(bob), 'Bob');
  await m.clearAccount(alice);
  assert.equal(await b.getItem(report(bob)), 'Bob');
  await m.clearAccount(bob);
  await assert.rejects(b.getItem(report(bob)), /session has ended/);
  assert.equal(disk.get(deletionReceipt), 'pending fixture');
});

test('interrupted migration retries protected writes and keeps the newer protected attempt', async () => {
  const { open, disk, local } = device();
  const m = open(), login = session(alice);
  disk.set(dm(alice), attempts[0][1]);
  const write = local.setItem;
  local.setItem = async (k,v) => { if (k.startsWith(prefix)) throw Error('write unavailable'); await write(k,v); };
  await assert.rejects(m.setSession(login, true), /write unavailable/);
  assert.equal(disk.get(dm(alice)), attempts[0][1]);
  local.setItem = write;
  const a = m.forAccount(alice);
  assert.equal(await a.getItem(dm(alice)), attempts[0][1]);
  await a.setItem(dm(alice), 'new pending attempt');
  disk.set(dm(alice), 'stale legacy attempt');
  const restart = open();
  await restart.setSession(login, true);
  assert.equal(await restart.forAccount(alice).getItem(dm(alice)), 'new pending attempt');
  assert.equal(disk.has(dm(alice)), false);
});

test('a different session cannot resume an interrupted migration for the same email', async () => {
  const { open, local, disk } = device();
  disk.set(report(alice), 'old login');
  const write = local.setItem;
  local.setItem = async (k,v) => { if (k.startsWith(prefix)) throw Error('locked'); await write(k,v); };
  await assert.rejects(open().setSession(session(alice), true), /locked/);
  local.setItem = write;
  const fresh = open();
  await fresh.setSession(session(alice), true);
  assert.equal(await fresh.forAccount(alice).getItem(report(alice)), null);
  assert.equal(disk.has(report(alice)), false);
});

test('browser edits survive navigation in memory and never reach durable storage', async () => {
  const { open, disk, keychain } = device(true);
  disk.set(report(alice), 'legacy browser data');
  const m = open(), login = session(alice);
  await m.setSession(login, true);
  for (const [key, text] of attempts) {
    await m.forAccount(alice).setItem(key, text);
    assert.equal(await m.forAccount(alice).getItem(key), text);
  }
  assert.equal(disk.size, 0);
  assert.equal(keychain.size, 0);
  const reload = open();
  await reload.setSession(login, true);
  assert.equal(await reload.forAccount(alice).getItem(report(alice)), null);
  const previousTabView = m.forAccount(alice);
  await m.setSession(session(bob));
  await assert.rejects(previousTabView.getItem(report(alice)), /session has ended/);
  assert.equal(await m.forAccount(bob).getItem(dm(bob)), null);
  await m.forAccount(bob).setItem(dm(bob), 'temporary');
  await m.setSession(null);
  await m.setSession(session(alice));
  assert.equal(await m.forAccount(alice).getItem(dm(alice)), null);
});

test('invalid session data and missing encryption keys fail closed', async () => {
  const { open, keychain } = device();
  const m = open();
  await m.setSession(session(alice));
  const a = m.forAccount(alice);
  await a.setItem(dm(alice), 'pending attempt');
  keychain.clear();
  await assert.rejects(a.getItem(dm(alice)), /unlock/);
  await m.setSession({ ...session(bob), user: { id: alice } });
  await assert.rejects(m.forAccount(alice).getItem(dm(alice)), /session has ended/);
});
