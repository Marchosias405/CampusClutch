import type { ConversationMessage, ConversationSummary, MessagePage, SendMessageInput } from '../types/messaging';

export type PendingMessage = { clientMessageId: string; body: string };
type SavedDraft = { version: 1; draft: string; pending: PendingMessage | null };
export type ThreadState = {
  summary: ConversationSummary | null;
  messages: ConversationMessage[];
  loading: boolean;
  loadingOlder: boolean;
  hasMore: boolean;
  draft: string;
  pending: PendingMessage | null;
  sending: boolean;
  restored: boolean;
  error: string;
  sendError: string;
  storageError: string;
  readError: string;
};
type Dependencies = {
  namespace: string;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  randomUUID(): string;
  loadSummary(userId: string, conversationId: string): Promise<ConversationSummary>;
  loadPage(userId: string, conversationId: string, options?: { beforeSequence?: string | null }): Promise<MessagePage>;
  send(userId: string, input: SendMessageInput): Promise<ConversationMessage>;
  markRead(userId: string, conversationId: string, sequence: string): Promise<string>;
  errorText(error: unknown): string;
};

export const isConversationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const compareSequences = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
const EMPTY: SavedDraft = { version: 1, draft: '', pending: null };
const STORAGE_ERROR = 'Unable to save or restore your draft on this device. Retry before sending.';
// Serialize storage across screen instances too: returning to a thread must wait for its older writes.
const storageQueues = new Map<string, Promise<unknown>>();
function inStorageOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (storageQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  storageQueues.set(key, next);
  void next.finally(() => { if (storageQueues.get(key) === next) storageQueues.delete(key); }).catch(() => {});
  return next;
}
function savedDraft(raw: string | null): SavedDraft {
  if (raw === null) return { ...EMPTY };
  const value = JSON.parse(raw);
  if (value?.version !== 1 || typeof value.draft !== 'string'
    || (value.pending !== null && (!isConversationId(value.pending?.clientMessageId)
      || typeof value.pending.body !== 'string' || !value.pending.body.trim()
      || value.pending.body !== value.pending.body.trim() || Array.from(value.pending.body).length > 4000))) {
    throw new Error('Invalid saved draft');
  }
  return { version: 1, draft: value.draft, pending: value.pending };
}
function merged(previous: ConversationMessage[], incoming: ConversationMessage[]) {
  const byId = new Map(previous.map(row => [row.id, row]));
  incoming.forEach(row => byId.set(row.id, row));
  return [...byId.values()].sort((a, b) => compareSequences(b.sequence, a.sequence));
}

/** One controller belongs to exactly one account/conversation. It never switches its identity. */
export function createMessageThread(userId: string, conversationId: string, deps: Dependencies) {
  const key = `campusclutch:message-draft:v1:${encodeURIComponent(deps.namespace)}:${userId}:${conversationId}`;
  let state: ThreadState = {
    summary: null, messages: [], loading: false, loadingOlder: false, hasMore: false,
    draft: '', pending: null, sending: false, restored: false,
    error: '', sendError: '', storageError: '', readError: '',
  };
  const listeners = new Set<() => void>();
  let active = false, epoch = 0, generation = 0;
  let oldestCursor: string | null = null, readThrough = '0', readBusy = false, queuedRead: string | null = null;
  let newestFetched: string | null = null;
  let restoring: Promise<void> | null = null;
  let sendBusy = false;
  const emit = (patch: Partial<ThreadState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const valid = (ticket: number, focus: number) => active && generation === ticket && epoch === focus;
  const mutateStorage = (change: (current: SavedDraft) => SavedDraft) => inStorageOrder(key, async () => {
    const next = change(savedDraft(await deps.storage.getItem(key)));
    await deps.storage.setItem(key, JSON.stringify(next));
    return next;
  });

  async function restore() {
    if (state.restored) return;
    if (restoring) return restoring;
    const focus = epoch;
    const work = async () => {
      try {
        const value = await inStorageOrder(key, async () => savedDraft(await deps.storage.getItem(key)));
        if (!active || epoch !== focus) return;
        emit({ draft: value.draft, pending: value.pending, restored: true, storageError: '' });
        await reconcilePending(state.messages);
      } catch { if (active && epoch === focus) emit({ storageError: STORAGE_ERROR }); }
    };
    restoring = work().finally(() => {
      restoring = null;
      if (active && !state.restored && epoch !== focus) void restore();
    });
    return restoring;
  }

  async function reconcilePending(rows: ConversationMessage[]) {
    const pending = state.pending;
    if (!pending) return;
    const found = rows.find(row => row.sender_id === userId && row.client_message_id === pending.clientMessageId && row.body === pending.body);
    if (!found) return;
    try {
      await mutateStorage(current => current.pending?.clientMessageId === pending.clientMessageId ? { ...EMPTY } : current);
      if (state.pending?.clientMessageId === pending.clientMessageId) emit({ pending: null, draft: '', sendError: '', storageError: '' });
    } catch { emit({ storageError: STORAGE_ERROR }); }
  }

  async function refresh() {
    if (!active || state.loading || state.loadingOlder) return;
    const focus = epoch, ticket = ++generation;
    emit({ loading: true, error: '' });
    try {
      const [summary, first] = await Promise.all([deps.loadSummary(userId, conversationId), deps.loadPage(userId, conversationId)]);
      if (!valid(ticket, focus)) return;
      let rows = first.items, tail = first;
      const previousNewest = newestFetched;
      // Fill any gap since the last visit before merging into already loaded history.
      while (previousNewest && tail.hasMore && tail.nextCursor
        && tail.items.length && compareSequences(tail.items[tail.items.length - 1].sequence, previousNewest) > 0) {
        tail = await deps.loadPage(userId, conversationId, { beforeSequence: tail.nextCursor });
        if (!valid(ticket, focus)) return;
        rows = [...rows, ...tail.items];
      }
      const hadHistory = state.messages.length > 0;
      newestFetched = rows[0]?.sequence ?? newestFetched ?? '0';
      readThrough = compareSequences(summary.last_read_sequence, readThrough) > 0 ? summary.last_read_sequence : readThrough;
      if (!hadHistory) oldestCursor = tail.nextCursor;
      emit({ summary, messages: merged(state.messages, rows), hasMore: hadHistory ? state.hasMore : tail.hasMore, error: '' });
      await restore();
      if (valid(ticket, focus)) await reconcilePending(rows);
    } catch (error) {
      if (valid(ticket, focus)) {
        const denied = error && typeof error === 'object' && 'code' in error && ['42501', 'ACCOUNT_CHANGED'].includes(String(error.code));
        if (denied) { newestFetched = null; oldestCursor = null; }
        emit({ error: deps.errorText(error), ...(denied ? { summary: null, messages: [], hasMore: false } : {}) });
      }
    } finally { if (valid(ticket, focus)) emit({ loading: false }); }
  }

  async function loadOlder() {
    if (!active || state.loading || state.loadingOlder || !state.hasMore || !oldestCursor) return;
    const focus = epoch, ticket = ++generation;
    emit({ loadingOlder: true, error: '' });
    try {
      const page = await deps.loadPage(userId, conversationId, { beforeSequence: oldestCursor });
      if (!valid(ticket, focus)) return;
      oldestCursor = page.nextCursor;
      emit({ messages: merged(state.messages, page.items), hasMore: page.hasMore });
      await reconcilePending(page.items);
    } catch (error) { if (valid(ticket, focus)) emit({ error: deps.errorText(error) }); }
    finally { if (valid(ticket, focus)) emit({ loadingOlder: false }); }
  }

  function setDraft(draft: string) {
    if (!active || !state.restored || state.pending || sendBusy) return;
    emit({ draft, sendError: '' });
    void mutateStorage(current => current.pending ? current : { version: 1, draft, pending: null })
      .then(() => emit({ storageError: '' })).catch(() => emit({ storageError: STORAGE_ERROR }));
  }

  async function send() {
    if (!active || sendBusy || !state.restored || !state.summary
      || (!state.pending && state.summary.status !== 'active')) return;
    const body = state.pending?.body ?? state.draft.trim();
    if (!body || Array.from(body).length > 4000) {
      emit({ sendError: 'Write a message of 1–4,000 characters.' }); return;
    }
    sendBusy = true;
    const focus = epoch;
    let persisted = false;
    let pending: PendingMessage;
    try {
      pending = state.pending ?? { clientMessageId: deps.randomUUID(), body };
      emit({ pending, sending: true, sendError: '' });
      // A durable retry identity must exist before any network request can commit.
      await mutateStorage(current => {
        if (current.pending && current.pending.clientMessageId !== pending.clientMessageId) throw new Error('Another pending send');
        return { version: 1, draft: state.draft, pending };
      });
      persisted = true;
      emit({ storageError: '' });
      if (!active || epoch !== focus) return;
      const row = await deps.send(userId, { conversationId, ...pending });
      // Clear only this confirmed submission, including when its original screen has been left.
      await mutateStorage(current => current.pending?.clientMessageId === pending.clientMessageId ? { ...EMPTY } : current);
      if (state.pending?.clientMessageId === pending.clientMessageId) {
        emit({ pending: null, draft: '', messages: merged(state.messages, [row]), sendError: '', storageError: '' });
      }
    } catch (error) {
      emit(persisted ? { sendError: deps.errorText(error) } : { storageError: STORAGE_ERROR });
    } finally {
      sendBusy = false;
      emit({ sending: false });
    }
  }

  async function discardPending() {
    if (!active || sendBusy || !state.restored) return;
    const pendingId = state.pending?.clientMessageId;
    try {
      await mutateStorage(current => current.pending?.clientMessageId === pendingId ? { ...EMPTY } : current);
      if (state.pending?.clientMessageId === pendingId) emit({ pending: null, draft: '', sendError: '', storageError: '' });
    } catch { emit({ storageError: STORAGE_ERROR }); }
  }

  async function observe(sequence: string) {
    if (!active || !state.summary || compareSequences(sequence, readThrough) <= 0
      || !state.messages.some(row => row.sequence === sequence && row.sender_id !== userId)) return;
    if (readBusy) {
      if (!queuedRead || compareSequences(sequence, queuedRead) > 0) queuedRead = sequence;
      return;
    }
    readBusy = true;
    const focus = epoch;
    try {
      const cursor = await deps.markRead(userId, conversationId, sequence);
      if (active && epoch === focus) { readThrough = cursor; emit({ readError: '' }); }
    } catch { if (active && epoch === focus) emit({ readError: 'Unable to update unread status. Refresh to retry.' }); }
    finally {
      readBusy = false;
      const next = queuedRead; queuedRead = null;
      if (active && next) void observe(next);
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    setActive(value: boolean) {
      if (active === value) return;
      active = value; epoch += 1; generation += 1;
      if (value) { void restore(); void refresh(); }
      else { queuedRead = null; emit({ loading: false, loadingOlder: false }); }
    },
    refresh, loadOlder, setDraft, send, observe, discardPending,
    retryStorage: async () => {
      if (!active) return;
      if (!state.restored) await restore();
      else {
        const snapshot: SavedDraft = { version: 1, draft: state.draft, pending: state.pending };
        try {
          await mutateStorage(current => current.pending && current.pending.clientMessageId !== snapshot.pending?.clientMessageId ? current : snapshot);
          emit({ storageError: '' });
        } catch { emit({ storageError: STORAGE_ERROR }); }
      }
      if (active) await reconcilePending(state.messages);
    },
  };
}
