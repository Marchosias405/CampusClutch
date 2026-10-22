/* global __dirname */
// Exercise the production realtime controller and transport without a network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const CHAT = 'c0000000-0000-4000-8000-000000000003';
const OTHER = 'd0000000-0000-4000-8000-000000000004';

function production(file, modules = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exported = {};
  vm.runInNewContext(code, { exports: exported, ...globals, require(name) {
    if (!(name in modules)) throw Error('Unexpected import: ' + name);
    return modules[name];
  } }, { filename: file });
  return exported;
}

function clock() {
  let now = 0, nextId = 0;
  const tasks = new Map();
  const schedule = (callback, delay, repeat = false) => {
    const id = ++nextId;
    tasks.set(id, { callback, delay, at: now + delay, repeat });
    return id;
  };
  const globals = {
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: id => tasks.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: id => tasks.delete(id),
  };
  function advance(milliseconds) {
    const end = now + milliseconds;
    let steps = 0;
    while (true) {
      const next = [...tasks.entries()].filter(([, task]) => task.at <= end)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      assert.ok(++steps < 10000, 'Timers must not loop');
      const [id, task] = next;
      now = task.at;
      if (task.repeat) task.at += task.delay;
      else tasks.delete(id);
      task.callback();
    }
    now = end;
  }
  return { globals, advance, tasks };
}

function harness(options = {}) {
  const time = clock();
  const connections = [], changes = [];
  let refreshes = 0, attempts = 0;
  const { createMessagesRealtime } = production('src/lib/messagesRealtime.ts', {}, time.globals);
  const model = createMessagesRealtime(callbacks => {
    attempts++;
    if (options.throwConnect) throw Error('offline');
    const connection = { ...callbacks, closed: 0 };
    connections.push(connection);
    return () => { connection.closed++; };
  }, async () => { refreshes++; });
  const unsubscribe = model.subscribe(id => changes.push(id));
  function start() { model.setActive(true); time.advance(100); }
  return { model, time, connections, changes, unsubscribe, start,
    refreshes: () => refreshes, attempts: () => attempts };
}

let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }

function transportHarness(url = 'https://campus.example') {
  const clients = [];
  class RealtimeClient {
    constructor(endpoint, options) {
      this.endpoint = endpoint; this.options = options; this.disconnected = 0; this.removed = 0;
      clients.push(this);
    }
    channel(topic, config) {
      this.topic = topic; this.config = config;
      const client = this;
      return {
        on(kind, filter, callback) { client.kind = kind; client.filter = filter; client.event = callback; return this; },
        subscribe(callback) { client.status = callback; return this; },
      };
    }
    disconnect() { this.disconnected++; }
    async removeAllChannels() { this.removed++; if (this.failRemoval) throw Error('already closed'); }
  }
  const { connectAccountMessages } = production('src/lib/messagesRealtimeTransport.ts', {
    '@supabase/supabase-js': { RealtimeClient },
    './env': { env: { supabaseUrl: url, supabasePublishableKey: 'public-test-key' } },
  });
  return { clients, connectAccountMessages };
}

(async () => {
  await test('inactive controller makes no connection, refresh or timer', () => {
    const h = harness(); h.model.setActive(false); h.time.advance(120000);
    assert.equal(h.attempts(), 0); assert.equal(h.refreshes(), 0); assert.equal(h.time.tasks.size, 0);
  });
  await test('activation catches up once and repeated activation keeps one connection', () => {
    const h = harness(); h.model.setActive(true); h.model.setActive(true);
    assert.equal(h.attempts(), 1); assert.equal(h.refreshes(), 0);
    h.time.advance(99); assert.equal(h.refreshes(), 0);
    h.time.advance(1); assert.deepEqual(h.changes, [null]); assert.equal(h.refreshes(), 1);
  });
  await test('event bursts deduplicate UUIDs and refresh one authorized snapshot per batch', () => {
    const h = harness(); h.start(); h.changes.length = 0;
    for (let i = 0; i < 100; i++) h.connections[0].changed(CHAT.toUpperCase());
    h.connections[0].changed(OTHER); h.time.advance(100);
    assert.deepEqual(h.changes, [CHAT, OTHER]); assert.equal(h.refreshes(), 2);
    h.connections[0].changed(CHAT); h.time.advance(100);
    assert.deepEqual(h.changes, [CHAT, OTHER, CHAT]); assert.equal(h.refreshes(), 3);
  });
  await test('untrusted hints cannot inject payloads or malformed conversation IDs', () => {
    const h = harness(); h.start(); h.changes.length = 0;
    for (const bad of [null, undefined, {}, [], 42, '', 'fake-id', `${CHAT} extra`, { conversation_id: CHAT, body: 'injected' }]) {
      h.connections[0].changed(bad);
    }
    h.time.advance(100); assert.deepEqual(h.changes, []); assert.equal(h.refreshes(), 1);
  });
  await test('subscription readiness coalesces with pending hints into one full catch-up', () => {
    const h = harness(); h.start(); h.changes.length = 0;
    h.connections[0].changed(CHAT); h.connections[0].ready(); h.connections[0].changed(OTHER);
    h.time.advance(100); assert.deepEqual(h.changes, [null]); assert.equal(h.refreshes(), 2);
  });
  await test('30-second fallback refreshes all even when the socket never becomes ready', () => {
    const h = harness(); h.start(); h.changes.length = 0;
    h.time.advance(29900); assert.equal(h.refreshes(), 1);
    h.time.advance(100); assert.deepEqual(h.changes, [null]); assert.equal(h.refreshes(), 2);
    h.time.advance(30000); assert.deepEqual(h.changes, [null, null]); assert.equal(h.refreshes(), 3);
  });
  await test('connection failures schedule one retry and retire the old connection', () => {
    const h = harness(); h.start();
    h.connections[0].unavailable(); h.connections[0].unavailable();
    h.time.advance(4999); assert.equal(h.attempts(), 1);
    h.time.advance(1); assert.equal(h.attempts(), 2); assert.equal(h.connections[0].closed, 1);
    h.connections[1].ready(); h.time.advance(100); assert.equal(h.changes.at(-1), null);
  });
  await test('successful subscription cancels a pending retry', () => {
    const h = harness(); h.start(); h.connections[0].unavailable();
    h.time.advance(1000); h.connections[0].ready(); h.time.advance(5000);
    assert.equal(h.attempts(), 1); assert.equal(h.connections[0].closed, 0);
  });
  await test('synchronous connection exceptions recover on a bounded retry timer', () => {
    const h = harness({ throwConnect: true }); h.start();
    assert.equal(h.attempts(), 1); h.time.advance(5000); assert.equal(h.attempts(), 2);
    h.time.advance(5000); assert.equal(h.attempts(), 3);
    h.model.setActive(false); h.time.advance(60000); assert.equal(h.attempts(), 3);
  });
  await test('callbacks from a retired connection cannot publish, cancel retry or reconnect', () => {
    const h = harness(); h.start(); h.connections[0].unavailable(); h.time.advance(5000);
    h.changes.length = 0; const refreshes = h.refreshes();
    h.connections[1].unavailable();
    h.connections[0].changed(CHAT); h.connections[0].ready(); h.connections[0].unavailable();
    h.time.advance(100); assert.deepEqual(h.changes, []); assert.equal(h.refreshes(), refreshes);
    h.time.advance(4900); assert.equal(h.attempts(), 3);
  });
  await test('background closes the channel and cancels queued batches, retries and fallback', () => {
    const h = harness(); h.start(); h.changes.length = 0;
    h.connections[0].changed(CHAT); h.connections[0].unavailable(); h.model.setActive(false);
    assert.equal(h.connections[0].closed, 1); assert.equal(h.time.tasks.size, 0);
    h.connections[0].changed(OTHER); h.connections[0].ready(); h.connections[0].unavailable();
    h.time.advance(120000); assert.deepEqual(h.changes, []); assert.equal(h.refreshes(), 1); assert.equal(h.attempts(), 1);
  });
  await test('foreground opens a fresh channel, catches up and ignores the old foreground epoch', () => {
    const h = harness(); h.start(); h.model.setActive(false); h.model.setActive(true);
    h.connections[0].changed(CHAT); h.connections[0].unavailable(); h.connections[0].ready();
    h.time.advance(100); assert.equal(h.attempts(), 2); assert.deepEqual(h.changes, [null, null]);
    h.connections[1].changed(OTHER); h.time.advance(100); assert.equal(h.changes.at(-1), OTHER);
  });
  await test('unsubscribe stops listener delivery without disabling the account badge refresh', () => {
    const h = harness(); h.start(); h.unsubscribe(); h.connections[0].changed(CHAT); h.time.advance(100);
    assert.deepEqual(h.changes, [null]); assert.equal(h.refreshes(), 2);
  });
  await test('separate account/token controllers never share queued changes', () => {
    const old = harness(), replacement = harness(); old.start(); old.connections[0].changed(CHAT);
    old.model.setActive(false); replacement.start();
    old.connections[0].changed(CHAT); old.connections[0].ready();
    old.time.advance(100); replacement.time.advance(100);
    assert.deepEqual(replacement.changes, [null]); assert.deepEqual(old.changes, [null]);
    replacement.connections[0].changed(OTHER); replacement.time.advance(100);
    assert.deepEqual(replacement.changes, [null, OTHER]);
  });
  await test('transport joins only the account private broadcast topic with its exact token', async () => {
    const h = transportHarness(); const hints = []; let ready = 0, unavailable = 0;
    h.connectAccountMessages(A, 'token-a')({ changed: value => hints.push(value), ready: () => ready++, unavailable: () => unavailable++ });
    const client = h.clients[0];
    assert.equal(client.endpoint, 'wss://campus.example/realtime/v1');
    assert.equal(client.options.params.apikey, 'public-test-key');
    assert.equal(await client.options.accessToken(), 'token-a');
    assert.equal(client.topic, `messages:${A}`); assert.equal(client.config.config.private, true);
    assert.equal(client.kind, 'broadcast'); assert.equal(client.filter.event, 'messages_changed');
    client.event({ payload: { conversation_id: CHAT, body: 'untrusted message body' } });
    assert.deepEqual(hints, [CHAT]); client.status('SUBSCRIBED'); assert.equal(ready, 1);
    for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) client.status(status);
    client.status('JOINING'); assert.equal(unavailable, 3);
  });
  await test('transport creates distinct clients for account and token replacements', async () => {
    const h = transportHarness('http://127.0.0.1:54321');
    const callbacks = { changed() {}, ready() {}, unavailable() {} };
    const closeA = h.connectAccountMessages(A, 'old-token')(callbacks);
    h.connectAccountMessages(A, 'new-token')(callbacks); h.connectAccountMessages(B, 'b-token')(callbacks);
    closeA(); assert.equal(h.clients[0].endpoint, 'ws://127.0.0.1:54321/realtime/v1');
    assert.equal(h.clients[0].disconnected, 1); assert.equal(h.clients[0].removed, 1);
    assert.equal(h.clients[1].disconnected, 0); assert.equal(h.clients[2].disconnected, 0);
    assert.equal(await h.clients[1].options.accessToken(), 'new-token');
    assert.equal(await h.clients[2].options.accessToken(), 'b-token');
    assert.equal(h.clients[2].topic, `messages:${B}`);
  });
  await test('transport cleanup tolerates an already disconnected channel removal', async () => {
    const h = transportHarness();
    const close = h.connectAccountMessages(A, 'token')({ changed() {}, ready() {}, unavailable() {} });
    h.clients[0].failRemoval = true; close(); await new Promise(setImmediate);
    assert.equal(h.clients[0].disconnected, 1); assert.equal(h.clients[0].removed, 1);
  });
  console.log(`Realtime messaging controller/transport: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
