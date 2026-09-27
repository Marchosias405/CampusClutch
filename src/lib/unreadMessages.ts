// One instance belongs to one signed-in account. Counts come from the entire inbox,
// not just the first loaded page. Failed refreshes preserve the last known count.
export function createUnreadMessages(load: () => Promise<number>) {
  let count = 0;
  let active = false;
  let epoch = 0;
  let revision = 0;
  let running: object | null = null;
  const listeners = new Set<() => void>();

  const refresh = async (): Promise<void> => {
    if (!active) return;
    ++revision;
    if (running) return;
    const operation = {};
    running = operation;
    const started = epoch;
    try {
      let requested: number;
      do {
        requested = revision;
        try {
          const next = await load();
          if (!active || epoch !== started || running !== operation) return;
          // A read receipt or refresh happened during this query. Fetch again before
          // publishing so an older query cannot restore a badge that was just read.
          if (requested === revision && Number.isSafeInteger(next) && next >= 0 && next !== count) {
            count = next;
            listeners.forEach(listener => listener());
          }
        } catch { /* Keep the last confirmed count while offline. */ }
      } while (active && epoch === started && running === operation && requested !== revision);
    } finally {
      if (running === operation) running = null;
    }
  };

  return {
    getSnapshot: () => count,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    setActive(value: boolean) {
      if (active === value) return;
      active = value; ++epoch; running = null;
      if (value) void refresh();
    },
  };
}
