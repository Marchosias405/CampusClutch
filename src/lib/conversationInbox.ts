import type { ConversationCursor, ConversationPage, ConversationSummary } from '../types/messaging';

export type InboxSnapshot = {
  items: ConversationSummary[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  cursor: ConversationCursor | null;
};

// Server cursors include microseconds. Date alone would merge distinct page
// boundaries that fall in the same millisecond; offsets must compare as instants.
function activityMicros(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  // Android's Date parser need only handle millisecond precision. Restore the
  // remaining server precision below rather than asking it to parse six digits.
  const milliseconds = Date.parse(value.replace(/\.\d+/, `.${fraction.slice(0, 3).padEnd(3, '0')}`));
  const micros = Number(fraction.slice(0, 6).padEnd(6, '0'));
  const millisFraction = Number(fraction.slice(0, 3).padEnd(3, '0'));
  return BigInt(milliseconds) * 1000n + BigInt(micros - millisFraction * 1000);
}
const cursorFor = (item: ConversationSummary): ConversationCursor => ({ activityAt: item.last_activity_at, id: item.id });
function compareCursors(left: ConversationCursor, right: ConversationCursor): number {
  const a = activityMicros(left.activityAt), b = activityMicros(right.activityAt);
  return a === b ? right.id.localeCompare(left.id) : a > b ? -1 : 1;
}

/** One instance per account. Focus epochs discard responses from an earlier visit. */
export function createConversationInbox(
  fetchPage: (before: ConversationCursor | null) => Promise<ConversationPage>,
) {
  let state: InboxSnapshot = { items: [], loaded: false, loading: false, error: null, cursor: null };
  let active = false;
  let epoch = 0;
  let invalidated = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InboxSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const load = async (append = false, preserveHistory = false) => {
    if (!active || state.loading || (append && !state.cursor)) return;
    const ticket = ++epoch;
    const before = append ? state.cursor : null;
    const previous = state;
    if (!append) invalidated = false;
    update({ loading: true, error: null });
    try {
      let page = await fetchPage(before);
      if (!active || ticket !== epoch) return;
      let fresh = page.items;
      const priorHead = preserveHistory && previous.items.length ? cursorFor(previous.items[0]) : null;
      // A burst can push every cached conversation beyond page one. Fill that
      // gap before retaining the old pagination cursor, or those rows are skipped.
      while (priorHead && page.hasMore && page.nextCursor && compareCursors(page.nextCursor, priorHead) < 0) {
        page = await fetchPage(page.nextCursor);
        if (!active || ticket !== epoch) return;
        fresh = [...fresh, ...page.items];
      }
      let items: ConversationSummary[];
      let cursor = page.nextCursor;
      if (priorHead && page.hasMore && cursor) {
        fresh = [...new Map(fresh.map(item => [item.id, item])).values()];
        const freshIds = new Set(fresh.map(item => item.id));
        // Only retain rows older than the fetched range. An absent row inside
        // that range is authoritatively gone; an exhausted page covers all rows.
        const older = previous.items.filter(item => !freshIds.has(item.id) && compareCursors(cursorFor(item), cursor!) > 0);
        items = [...fresh, ...older].sort((a, b) => compareCursors(cursorFor(a), cursorFor(b)));
        // Keep the deepest confirmed boundary, including a previously exhausted
        // inbox. The catch-up may itself have reached farther than the old page.
        if (!previous.cursor || compareCursors(previous.cursor, cursor) > 0) cursor = previous.cursor;
      } else {
        const unique = new Map((append ? previous.items : []).map(item => [item.id, item]));
        fresh.forEach(item => unique.set(item.id, item));
        items = [...unique.values()];
      }
      update({ items, loaded: true, cursor });
    } catch {
      if (active && ticket === epoch) {
        update({ error: 'Unable to load conversations. Check your connection and try again.' });
      }
    } finally {
      if (active && ticket === epoch) {
        update({ loading: false });
        // An event during this request may describe a change newer than its snapshot.
        // Catch up once after it settles, including failed loads and pagination.
        if (invalidated) void load(false, true);
      }
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setActive(value: boolean) {
      if (active === value) return;
      active = value;
      ++epoch;
      invalidated = false;
      update({ loading: false });
      if (active) void load();
    },
    invalidate() {
      if (!active) return;
      invalidated = true;
      if (!state.loading) void load(false, true);
    },
    refresh: (append = false) => load(append),
  };
}
