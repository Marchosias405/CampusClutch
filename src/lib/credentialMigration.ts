export type CredentialStore = {
  getItem(name: string): Promise<string | null>;
  setItem(name: string, value: string): Promise<void>;
  removeItem(name: string): Promise<void>;
};

// Supabase namespaces its session and companion keys by the first hostname label.
export const isLegacySessionKey = (name: string) => /^sb-[a-z0-9-]+-auth-token(?:-code-verifier|-user)?$/.test(name);

// Finish the protected write before erasing an existing installation's copy.
// Serialize reads, refreshes and sign-out so a delayed migration cannot undo sign-out.
export function migrateCredentials(protectedStore: CredentialStore, legacy: CredentialStore): CredentialStore {
  const pending = new Map<string, Promise<unknown>>();
  function inOrder<T>(name: string, operation: () => Promise<T>) {
    const next = (pending.get(name) ?? Promise.resolve()).catch(() => undefined).then(operation);
    pending.set(name, next);
    return next.finally(() => { if (pending.get(name) === next) pending.delete(name); });
  }
  return {
    getItem: name => inOrder(name, async () => {
      const saved = await protectedStore.getItem(name);
      const old = await legacy.getItem(name);
      if (old === null) return saved;
      if (saved === null) await protectedStore.setItem(name, old);
      await legacy.removeItem(name);
      return saved ?? old;
    }),
    setItem: (name, value) => inOrder(name, async () => {
      await protectedStore.setItem(name, value);
      await legacy.removeItem(name);
    }),
    removeItem: name => inOrder(name, async () => {
      await legacy.removeItem(name);
      await protectedStore.removeItem(name);
    }),
  };
}
