import type { ConversationCursor, ConversationPage, ConversationSummary } from '../types/messaging';

export type InboxSnapshot = {
  items: ConversationSummary[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  cursor: ConversationCursor | null;
};

/** One instance per account. Focus epochs discard responses from an earlier visit. */
export function createConversationInbox(
  fetchPage: (before: ConversationCursor | null) => Promise<ConversationPage>,
) {
  let state: InboxSnapshot = { items: [], loaded: false, loading: false, error: null, cursor: null };
  let active = false;
  let epoch = 0;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InboxSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  const refresh = async (append = false) => {
    if (!active || state.loading || (append && !state.cursor)) return;
    const ticket = ++epoch;
    const before = append ? state.cursor : null;
    update({ loading: true, error: null });
    try {
      const page = await fetchPage(before);
      if (!active || ticket !== epoch) return;
      // Inbox activity changes while paging. Retain one row per conversation;
      // the next first-page refresh resets ordering and cursor together.
      const unique = new Map((append ? state.items : []).map(item => [item.id, item]));
      page.items.forEach(item => unique.set(item.id, item));
      update({ items: [...unique.values()], loaded: true, cursor: page.nextCursor });
    } catch {
      if (active && ticket === epoch) {
        update({ error: 'Unable to load conversations. Check your connection and try again.' });
      }
    } finally {
      if (active && ticket === epoch) update({ loading: false });
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
      update({ loading: false });
      if (active) void refresh();
    },
    refresh,
  };
}
