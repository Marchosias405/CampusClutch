/* global __dirname */
// Deferred API/storage promises exercise the actual thread controller, without native dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const compiled = ts.transpileModule(fs.readFileSync(root + '/src/lib/messageThread.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject, Error });
const { createMessageThread, isConversationId } = exportsObject;
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const OTHER = 'd0000000-0000-4000-8000-000000000004';
const TIME = '2026-09-26T10:00:00Z';
const plain = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(test) { for (let i = 0; i < 100; i++) { if (test()) return; await tick(); } assert.fail('Timed out waiting for controller state'); }
const row = (sequence, extra = {}) => ({
  id: `60000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, conversation_id: C,
  sender_id: B, client_message_id: `50000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  sequence: String(sequence), body: 'Message ' + sequence, created_at: TIME, ...extra,
});
const summary = { id: C, type: 'direct', status: 'active', other_profile_id: B, other_display_name: 'Student B',
  last_message_body: null, last_message_at: null, last_activity_at: TIME, last_message_sequence: '0', last_read_sequence: '0', unread_count: 0, created_at: TIME };
let fixtureId = 0, count = 0;
function fixture() {
  const data = new Map();
  const state = { page: { items: [], hasMore: false, nextCursor: null }, summary: { ...summary }, calls: [], reads: [], uuids: 0, failStorage: false };
  const storage = {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { if (state.failStorage) throw Error('storage offline'); data.set(key, value); },
  };
  const deps = {
    namespace: 'local-test-' + (++fixtureId), storage,
    randomUUID: () => `70000000-0000-4000-8000-${String(++state.uuids).padStart(12, '0')}`,
    loadSummary: async () => state.summary,
    loadPage: async () => state.page,
    send: async (user, input) => { state.calls.push(plain(input)); return row(1, { sender_id: user, client_message_id: input.clientMessageId, body: input.body }); },
    markRead: async (_user, _chat, sequence) => { state.reads.push(sequence); return sequence; },
    errorText: () => 'Unable to confirm. Retry the same message.',
  };
  const create = (user = A, chat = C) => createMessageThread(user, chat, deps);
  return { state, deps, data, create };
}
async function ready(model) { model.setActive(true); await until(() => model.getSnapshot().restored && !model.getSnapshot().loading); }
async function test(name, run) { await run(); count++; console.log('PASS ' + name); }

(async () => {
  await test('loads real rows but marks only an observed incoming message while active', async () => {
    const { create, state } = fixture();
    state.page = { items: [row(3, { sender_id: A }), row(2), row(1)], hasMore: false, nextCursor: null };
    const model = create(); await ready(model);
    assert.equal(model.getSnapshot().messages.length, 3); assert.equal(state.reads.length, 0);
    await model.observe('999'); await model.observe('3'); assert.equal(state.reads.length, 0);
    await model.observe('2'); assert.deepEqual(state.reads, ['2']);
    model.setActive(false); await model.observe('1'); assert.deepEqual(state.reads, ['2']);
  });

  await test('late loads and errors from a blurred thread cannot replace the next account/thread snapshot', async () => {
    const f = fixture(), pending = defer();
    f.deps.loadPage = () => pending.promise;
    const old = f.create(); old.setActive(true); await tick(); old.setActive(false);
    f.deps.loadPage = async () => ({ items: [row(5, { conversation_id: OTHER, sender_id: A })], hasMore: false, nextCursor: null });
    const next = f.create(B, OTHER); await ready(next);
    pending.resolve({ items: [row(9)], hasMore: false, nextCursor: null }); await tick();
    assert.equal(old.getSnapshot().messages.length, 0);
    assert.equal(next.getSnapshot().messages[0].conversation_id, OTHER);
    assert.equal(f.state.reads.length, 0);
    next.setActive(false);
  });

  await test('delayed initial draft restoration retries after a fast blur/refocus instead of staying disabled', async () => {
    const f = fixture(), pending = defer(); let first = true;
    f.deps.storage.getItem = async () => {
      if (first) { first = false; return pending.promise; }
      return JSON.stringify({ version: 1, draft: 'Recovered draft', pending: null });
    };
    const model = f.create(); model.setActive(true); await tick(); model.setActive(false); model.setActive(true); await tick();
    pending.resolve(JSON.stringify({ version: 1, draft: 'Recovered draft', pending: null }));
    await until(() => model.getSnapshot().restored && !model.getSnapshot().loading);
    assert.equal(model.getSnapshot().draft, 'Recovered draft'); model.setActive(false);
  });

  await test('draft writes survive immediate navigation and remain scoped to backend, account and conversation', async () => {
    const f = fixture(), old = f.create(); await ready(old);
    old.setDraft('Unfinished text'); old.setActive(false);
    const same = f.create(); await ready(same); assert.equal(same.getSnapshot().draft, 'Unfinished text');
    const account = f.create(B), chat = f.create(A, OTHER); await ready(account); await ready(chat);
    assert.equal(account.getSnapshot().draft, ''); assert.equal(chat.getSnapshot().draft, '');
    f.deps.namespace = 'different-backend'; const backend = f.create(); await ready(backend); assert.equal(backend.getSnapshot().draft, '');
    [same, account, chat, backend].forEach(model => model.setActive(false));
  });

  await test('refresh never overwrites an edited draft with its older persisted copy', async () => {
    const f = fixture(), pending = defer(), model = f.create(); await ready(model);
    f.deps.storage.setItem = async (key, value) => { await pending.promise; f.data.set(key, value); };
    model.setDraft('Latest edit'); await model.refresh();
    assert.equal(model.getSnapshot().draft, 'Latest edit'); pending.resolve(); await tick(); model.setActive(false);
  });

  await test('ambiguous send freezes durable body/UUID, blocks double taps and retries after navigation with the same identity', async () => {
    const f = fixture(), response = defer();
    f.deps.send = async (_user, input) => {
      f.state.calls.push(plain(input));
      assert.equal(JSON.parse([...f.data.values()][0]).pending.clientMessageId, input.clientMessageId);
      return response.promise;
    };
    const model = f.create(); await ready(model); model.setDraft('  My message\n');
    const sending = model.send(); void model.send(); await until(() => f.state.calls.length === 1);
    model.setDraft('Changed text'); assert.equal(model.getSnapshot().pending.body, 'My message');
    model.setActive(false); response.reject(Error('Lost response')); await sending;
    assert.equal(model.getSnapshot().sending, false);
    const original = f.state.calls[0], next = f.create(); await ready(next);
    assert.equal(next.getSnapshot().pending.clientMessageId, original.clientMessageId);
    assert.equal(f.state.uuids, 1);
    f.deps.send = async (user, input) => { f.state.calls.push(plain(input)); return row(7, { sender_id: user, client_message_id: input.clientMessageId, body: input.body }); };
    await next.send(); assert.deepEqual(f.state.calls[1], original);
    assert.equal(next.getSnapshot().messages[0].sequence, '7'); assert.equal(next.getSnapshot().pending, null);
    assert.equal(JSON.parse([...f.data.values()][0]).pending, null); next.setActive(false);
  });

  await test('storage failure prevents dispatch and keeps the same retry ID for recovery', async () => {
    const f = fixture(), model = f.create(); await ready(model); model.setDraft('Keep me');
    f.state.failStorage = true; await model.send();
    assert.equal(f.state.calls.length, 0); assert.ok(model.getSnapshot().storageError);
    const id = model.getSnapshot().pending.clientMessageId;
    f.state.failStorage = false; await model.send();
    assert.equal(f.state.calls[0].clientMessageId, id); assert.equal(f.state.uuids, 1); model.setActive(false);
  });

  await test('leaving while durable submission is being saved prevents a new offscreen dispatch', async () => {
    const f = fixture(), pending = defer(), model = f.create(); await ready(model); model.setDraft('Wait');
    let saving = false;
    f.deps.storage.setItem = async (key, value) => { if (JSON.parse(value).pending) { saving = true; await pending.promise; } f.data.set(key, value); };
    const sending = model.send(); await until(() => saving); model.setActive(false); pending.resolve(); await sending;
    assert.equal(f.state.calls.length, 0); assert.equal(model.getSnapshot().sending, false);
    const id = model.getSnapshot().pending.clientMessageId;
    await ready(model); await model.send(); assert.equal(f.state.calls[0].clientMessageId, id); model.setActive(false);
  });

  await test('late confirmation from an old screen cannot erase the newer screen draft', async () => {
    const f = fixture(), pending = defer(), old = f.create(); await ready(old); old.setDraft('First');
    let firstInput;
    f.deps.send = async (_user, input) => { firstInput = input; return pending.promise; };
    const sending = old.send(); await until(() => firstInput); old.setActive(false);
    const next = f.create(); await ready(next);
    const confirmed = row(1, { sender_id: A, client_message_id: firstInput.clientMessageId, body: firstInput.body });
    f.deps.send = async () => confirmed; await next.send(); next.setDraft('New unsent draft'); await tick();
    pending.resolve(confirmed); await sending;
    assert.equal(next.getSnapshot().draft, 'New unsent draft');
    assert.equal(JSON.parse([...f.data.values()][0]).draft, 'New unsent draft'); next.setActive(false);
  });

  await test('refresh reconciles a persisted send whose response was lost without resending', async () => {
    const f = fixture(), model = f.create(); await ready(model); model.setDraft('Persisted');
    f.deps.send = async (_user, input) => { f.state.calls.push(input); throw Error('Lost response'); };
    await model.send(); const submitted = f.state.calls[0];
    f.state.page = { items: [row(1, { sender_id: A, client_message_id: submitted.clientMessageId, body: submitted.body })], hasMore: false, nextCursor: null };
    await model.refresh(); assert.equal(model.getSnapshot().pending, null); assert.equal(model.getSnapshot().draft, '');
    assert.equal(f.state.calls.length, 1); model.setActive(false);
  });

  await test('refresh fills incoming history gaps even after a much newer own send', async () => {
    const f = fixture(), model = f.create();
    f.state.page = { items: Array.from({ length: 10 }, (_, i) => row(10 - i)), hasMore: false, nextCursor: null };
    await ready(model);
    f.deps.send = async (user, input) => row(60, { sender_id: user, client_message_id: input.clientMessageId, body: input.body });
    model.setDraft('My reply'); await model.send();
    const pages = [];
    f.deps.loadPage = async (_user, _chat, options) => {
      pages.push(options?.beforeSequence ?? null);
      if (!options?.beforeSequence) return { items: [model.getSnapshot().messages[0], ...Array.from({ length: 29 }, (_, i) => row(59 - i))], hasMore: true, nextCursor: '31' };
      return { items: Array.from({ length: 30 }, (_, i) => row(30 - i)), hasMore: true, nextCursor: '1' };
    };
    await model.refresh(); assert.deepEqual(pages, [null, '31']);
    assert.equal(model.getSnapshot().messages.length, 60);
    assert.equal(model.getSnapshot().messages[59].sequence, '1');
    assert.equal(model.getSnapshot().hasMore, false); model.setActive(false);
  });

  await test('older pagination survives refresh, deduplicates overlap and retries without losing its cursor', async () => {
    const f = fixture(), model = f.create();
    f.state.page = { items: [row(4), row(3)], hasMore: true, nextCursor: '3' }; await ready(model);
    f.deps.loadPage = async (_user, _chat, options) => options?.beforeSequence
      ? { items: [row(2)], hasMore: true, nextCursor: '2' } : { items: [row(5), row(4)], hasMore: true, nextCursor: '4' };
    await model.loadOlder(); await model.refresh();
    assert.deepEqual(plain(model.getSnapshot().messages.map(item => item.sequence)), ['5', '4', '3', '2']);
    f.deps.loadPage = async (_user, _chat, options) => { assert.equal(options.beforeSequence, '2'); throw Error('offline'); };
    await model.loadOlder(); assert.equal(model.getSnapshot().messages.length, 4); assert.equal(model.getSnapshot().hasMore, true);
    f.deps.loadPage = async (_user, _chat, options) => { assert.equal(options.beforeSequence, '2'); return { items: [row(1)], hasMore: false, nextCursor: null }; };
    await model.loadOlder(); assert.equal(model.getSnapshot().messages.length, 5); assert.equal(model.getSnapshot().hasMore, false); model.setActive(false);
  });

  await test('new visible read cursor queues behind an in-flight read and same-row failures retry after resume', async () => {
    const f = fixture(), pending = defer(), model = f.create();
    f.state.page = { items: [row(2), row(1)], hasMore: false, nextCursor: null }; await ready(model);
    f.deps.markRead = async (_user, _chat, sequence) => { f.state.reads.push(sequence); return sequence === '1' ? pending.promise : sequence; };
    const first = model.observe('1'); await model.observe('2'); assert.deepEqual(f.state.reads, ['1']);
    pending.resolve('1'); await first; await until(() => f.state.reads.length === 2); assert.deepEqual(f.state.reads, ['1', '2']);
    const fresh = f.create(); await ready(fresh); f.deps.markRead = async () => { throw Error('offline'); };
    await fresh.observe('2'); assert.ok(fresh.getSnapshot().readError); fresh.setActive(false);
    f.deps.markRead = async (_user, _chat, sequence) => { f.state.reads.push(sequence); return sequence; };
    await ready(fresh); await fresh.observe('2'); assert.equal(fresh.getSnapshot().readError, '');
    [model, fresh].forEach(item => item.setActive(false));
  });

  await test('closed conversations prohibit new sends, permit exact retries, and invalid legacy routes are rejected', async () => {
    const f = fixture(), model = f.create(); await ready(model); model.setDraft('Saved');
    f.deps.send = async () => { throw Error('offline'); }; await model.send();
    f.state.summary = { ...summary, status: 'closed' }; await model.refresh();
    const pending = model.getSnapshot().pending;
    f.deps.send = async (_user, input) => { f.state.calls.push(input); return row(1, { sender_id: A, client_message_id: input.clientMessageId, body: input.body }); };
    await model.send(); assert.equal(f.state.calls[0].clientMessageId, pending.clientMessageId);
    model.setDraft('New closed message'); await model.send(); assert.equal(f.state.calls.length, 1);
    assert.equal(isConversationId('marcus'), false); assert.equal(isConversationId('new'), false); assert.equal(isConversationId(C), true);
    model.setActive(false);
  });

  await test('authorization loss clears previously loaded conversation data', async () => {
    const f = fixture(), model = f.create(); f.state.page = { items: [row(1)], hasMore: false, nextCursor: null }; await ready(model);
    f.deps.loadSummary = async () => { throw Object.assign(Error('denied'), { code: '42501' }); };
    await model.refresh(); assert.equal(model.getSnapshot().summary, null); assert.equal(model.getSnapshot().messages.length, 0); model.setActive(false);
  });
  console.log(`Message thread: ${count} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
