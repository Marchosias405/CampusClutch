export type MessageChangeListener = (conversationId: string | null) => void;
export type MessageConnectionCallbacks = {
  changed: (conversationId: unknown) => void;
  ready: () => void;
  unavailable: () => void;
};
export type ConnectMessages = (callbacks: MessageConnectionCallbacks) => () => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Broadcasts are hints only. Subscribers reload through the authorized APIs;
// they never insert broadcast content into their local message history.
export function createMessagesRealtime(connect: ConnectMessages, refreshUnread: () => Promise<void>) {
  const listeners = new Set<MessageChangeListener>();
  const pending = new Set<string>();
  let all = false;
  let active = false;
  let generation = 0;
  let close: (() => void) | undefined;
  let batch: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;

  function invalidate(conversationId: string | null) {
    if (!active) return;
    if (conversationId === null) all = true;
    else pending.add(conversationId);
    if (batch !== undefined) return;
    batch = setTimeout(() => {
      batch = undefined;
      if (!active) return;
      const changes = all ? [null] : [...pending];
      all = false;
      pending.clear();
      void refreshUnread();
      for (const change of changes) for (const listener of listeners) listener(change);
    }, 100);
  }

  function open() {
    const ticket = ++generation;
    close?.();
    close = undefined;
    const current = () => active && ticket === generation;
    const unavailable = () => {
      if (!current() || retry !== undefined) return;
      retry = setTimeout(() => {
        retry = undefined;
        if (current()) open();
      }, 5000);
    };
    try {
      close = connect({
        changed: value => { if (current() && typeof value === 'string' && UUID.test(value)) invalidate(value.toLowerCase()); },
        ready: () => {
          if (!current()) return;
          clearTimeout(retry);
          retry = undefined;
          // Catch anything committed before joining or while disconnected.
          invalidate(null);
        },
        unavailable,
      });
    } catch {
      unavailable();
    }
  }

  return {
    subscribe(listener: MessageChangeListener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive(value: boolean) {
      if (value === active) return;
      active = value;
      if (active) {
        open();
        invalidate(null);
        // Also recovers missed events and works if the realtime service is down.
        fallback = setInterval(() => invalidate(null), 30000);
      } else {
        ++generation;
        clearTimeout(batch);
        clearTimeout(retry);
        clearInterval(fallback);
        batch = retry = fallback = undefined;
        pending.clear();
        all = false;
        close?.();
        close = undefined;
      }
    },
  };
}
