import type { NotificationCursor, NotificationItem, NotificationPage } from '../types/notifications';
import {
  loadNotificationPage, loadUnreadNotificationCount, markAllNotificationsRead,
  markNotificationRead, notificationError,
} from './notifications';

export type NotificationInboxSnapshot = {
  items: NotificationItem[];
  unreadCount: number;
  loaded: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  cursor: NotificationCursor | null;
  error: string | null;
  mutatingIds: string[];
  markingAllRead: boolean;
};
export type NotificationInboxDependencies = {
  loadPage: (userId: string, options: { before: NotificationCursor | null }) => Promise<NotificationPage>;
  loadUnreadCount: (userId: string) => Promise<number>;
  markRead: (userId: string, notificationId: string) => Promise<string>;
  markAllRead: (userId: string) => Promise<number>;
  onChanged?: () => void | Promise<void>;
  now: () => string;
};
const initial = (): NotificationInboxSnapshot => ({
  items: [], unreadCount: 0, loaded: false, loading: false, refreshing: false,
  loadingMore: false, hasMore: false, cursor: null, error: null,
  mutatingIds: [], markingAllRead: false,
});
function micros(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const milliseconds = Date.parse(value.replace(/\.\d+/, `.${fraction.slice(0, 3).padEnd(3, '0')}`));
  return BigInt(milliseconds) * 1000n
    + BigInt(Number(fraction.slice(0, 6).padEnd(6, '0')) - Number(fraction.slice(0, 3).padEnd(3, '0')) * 1000);
}
const cursorFor = (item: NotificationItem): NotificationCursor => ({ createdAt: item.created_at, id: item.id });
function compare(left: NotificationCursor, right: NotificationCursor): number {
  const a = micros(left.createdAt), b = micros(right.createdAt);
  return a === b ? right.id.localeCompare(left.id) : a > b ? -1 : 1;
}

/** One instance belongs to one account; deactivation invalidates every in-flight result. */
export function createNotificationInbox(userId: string, overrides: Partial<NotificationInboxDependencies> = {}) {
  const deps: NotificationInboxDependencies = {
    loadPage: loadNotificationPage, loadUnreadCount: loadUnreadNotificationCount,
    markRead: markNotificationRead, markAllRead: markAllNotificationsRead,
    now: () => new Date().toISOString(), ...overrides,
  };
  let state = initial();
  let active = false, disposed = false;
  let epoch = 0, revision = 0;
  let running: object | null = null;
  let queued: 'refresh' | 'invalidate' | null = null;
  let mutationFailure: { id: string | null; message: string } | null = null;
  const listeners = new Set<() => void>();
  const busy = () => state.markingAllRead || state.mutatingIds.length > 0;
  const update = (patch: Partial<NotificationInboxSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  function changed() {
    // A UI listener failure cannot turn a confirmed database write into a failed mutation.
    try { void Promise.resolve(deps.onChanged?.()).catch(() => {}); } catch { /* The next refresh catches up. */ }
  }
  function queue(preserve: boolean) {
    if (!preserve || queued === 'refresh') queued = 'refresh';
    else queued = 'invalidate';
  }
  function drain() {
    if (!active || running || busy() || !queued) return;
    const preserve = queued === 'invalidate';
    queued = null;
    void load(false, preserve);
  }
  async function load(append: boolean, preserve: boolean): Promise<void> {
    if (!active || disposed || (append && (!state.cursor || !state.loaded))) return;
    if (running || busy()) {
      // Load-more taps do not create a queue; refresh and invalidations must not be lost.
      if (!append) { ++revision; queue(preserve); }
      return;
    }
    const operation = {}, started = epoch, requested = revision, previous = state;
    running = operation;
    const current = () => active && !disposed && epoch === started && running === operation;
    const applicable = () => current() && revision === requested && !busy();
    const before = append ? previous.cursor : null;
    update({ loading: true, refreshing: !append && previous.loaded, loadingMore: append, error: mutationFailure?.message ?? null });
    try {
      let [page, unreadCount] = await Promise.all([
        deps.loadPage(userId, { before }), deps.loadUnreadCount(userId),
      ]);
      if (!applicable()) return;
      let fresh = page.items;
      const priorHead = preserve && previous.items.length ? cursorFor(previous.items[0]) : null;
      const priorEnd = preserve && previous.items.length ? cursorFor(previous.items[previous.items.length - 1]) : null;
      // Refresh visible read states and bridge bursts before retaining an older cursor.
      // Cap catch-up work; a larger burst retains the fresh contiguous range with a safe cursor.
      let pages = 1;
      while (priorEnd && page.hasMore && page.nextCursor && compare(page.nextCursor, priorEnd) < 0 && pages < 5) {
        page = await deps.loadPage(userId, { before: page.nextCursor });
        if (!applicable()) return;
        fresh = [...fresh, ...page.items];
        ++pages;
      }
      let cursor = page.nextCursor;
      const unique = new Map<string, NotificationItem>();
      if (append) previous.items.forEach(item => unique.set(item.id, item));
      fresh.forEach(item => unique.set(item.id, item));
      if (priorHead && page.hasMore && cursor && compare(cursor, priorHead) >= 0) {
        // The fetched range has reached existing history, so it cannot skip intervening notices.
        previous.items.filter(item => compare(cursorFor(item), cursor!) > 0)
          .forEach(item => { if (!unique.has(item.id)) unique.set(item.id, item); });
        if (!previous.cursor || compare(previous.cursor, cursor) > 0) cursor = previous.cursor;
      }
      const items = [...unique.values()].sort((left, right) => compare(cursorFor(left), cursorFor(right)));
      // A lost write response can reconcile on a confirmed read. A denied write must
      // remain visible even when a subsequent inbox read succeeds.
      if (mutationFailure && (mutationFailure.id === null ? unreadCount === 0
        : fresh.some(item => item.id === mutationFailure!.id && item.read_at !== null))) mutationFailure = null;
      update({ items, unreadCount, loaded: true, cursor, hasMore: cursor !== null, error: mutationFailure?.message ?? null });
    } catch (error) {
      if (applicable()) update({ error: mutationFailure?.message ?? notificationError(error) });
    } finally {
      if (current()) {
        running = null;
        update({ loading: false, refreshing: false, loadingMore: false });
        drain();
      }
    }
  }
  async function markRead(id: string): Promise<boolean> {
    if (!active || disposed || busy()) return false;
    const selected = state.items.find(item => item.id === id);
    if (!selected) return false;
    if (selected.read_at !== null) return true;
    const started = epoch;
    mutationFailure = null;
    ++revision;
    queue(true);
    update({ mutatingIds: [id], error: null });
    try {
      await deps.markRead(userId, id);
      if (!active || disposed || epoch !== started) return false;
      // Mark only a confirmed write. A lost response leaves the original unread state retryable.
      const readAt = deps.now();
      update({
        items: state.items.map(item => item.id === id ? { ...item, read_at: item.read_at ?? readAt } : item),
        unreadCount: Math.max(0, state.unreadCount - 1),
      });
      changed();
      return true;
    } catch (error) {
      if (active && !disposed && epoch === started) {
        mutationFailure = { id, message: notificationError(error) };
        update({ error: mutationFailure.message });
      }
      return false;
    } finally {
      if (active && !disposed && epoch === started) {
        ++revision;
        update({ mutatingIds: [] });
        drain();
      }
    }
  }
  async function markAllRead(): Promise<boolean> {
    if (!active || disposed || busy()) return false;
    const started = epoch;
    const observed = new Set(state.items.filter(item => item.read_at === null).map(item => item.id));
    mutationFailure = null;
    ++revision;
    queue(true);
    update({ markingAllRead: true, error: null });
    try {
      const affected = await deps.markAllRead(userId);
      if (!active || disposed || epoch !== started) return false;
      const readAt = deps.now();
      update({
        items: state.items.map(item => observed.has(item.id) ? { ...item, read_at: item.read_at ?? readAt } : item),
        unreadCount: Math.max(0, state.unreadCount - affected),
      });
      changed();
      return true;
    } catch (error) {
      if (active && !disposed && epoch === started) {
        mutationFailure = { id: null, message: notificationError(error) };
        update({ error: mutationFailure.message });
      }
      return false;
    } finally {
      if (active && !disposed && epoch === started) {
        ++revision;
        update({ markingAllRead: false });
        drain();
      }
    }
  }
  function setActive(value: boolean) {
    if (disposed || value === active) return;
    active = value;
    ++epoch; ++revision;
    running = null; queued = null;
    update({ loading: false, refreshing: false, loadingMore: false, mutatingIds: [], markingAllRead: false });
    if (value) void load(false, state.loaded);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive,
    refresh: () => load(false, false),
    loadMore: () => load(true, false),
    invalidate: () => load(false, true),
    markRead,
    markAllRead,
    dispose() { setActive(false); disposed = true; state = initial(); listeners.clear(); },
  };
}
