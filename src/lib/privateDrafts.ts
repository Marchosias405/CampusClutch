import AsyncStorage from '@react-native-async-storage/async-storage';
import { toByteArray } from 'base64-js';
import { Platform } from 'react-native';
import { credentialStorage } from './credentialStorage';
import type { CredentialStore } from './credentialMigration';
import { env } from './env';

type Session = { user: { id: string }; access_token: string };
type Lease = { owner: string; sessionId: string };
type LocalStore = CredentialStore & { getAllKeys(): Promise<readonly string[]> };
const sealed = 'campusclutch:sealed:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// This claim only namespaces local storage. Auth establishes the session.
function leaseFor(session: Session | null): Lease | null {
  if (!session) return null;
  try {
    const part = session.access_token.split('.')[1];
    const bytes = toByteArray(part.padEnd(Math.ceil(part.length / 4) * 4, '='));
    const { session_id, sub } = JSON.parse(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    if (sub === session.user.id && typeof session_id === 'string' && uuid.test(session_id)) {
      return { owner: session.user.id.toLowerCase(), sessionId: session_id.toLowerCase() };
    }
  } catch { /* An unrecognized session cannot access saved drafts. */ }
  return null;
}

export function createPrivateDrafts(namespace: string, local: LocalStore, protectedStore: CredentialStore | null) {
  const project = encodeURIComponent(namespace);
  const upgradeKey = 'campusclutch:draft-upgrade:v1:' + project;
  const prefixes = ['message', 'report'].map(kind => `campusclutch:${kind}-draft:v1:${project}:`);
  const memory = new Map<string, string>();
  let current: Lease | null | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let prepare: (() => Promise<void>) | undefined;

  // Finish older IO before cleanup. A screen that outlives sign-out can never
  // borrow the next login's lease, even when the same person signs back in.
  function ordered<T>(operation: () => Promise<T>) {
    const result = tail.catch(() => undefined).then(operation);
    tail = result;
    return result;
  }
  function owner(key: string) {
    const prefix = prefixes.find(p => key.startsWith(p));
    return prefix ? key.slice(prefix.length).split(':', 1)[0] : undefined;
  }
  const sessionKey = (key: string, lease: Lease) => key + ':session:' + lease.sessionId;

  async function sweep(keep: Lease | null, adoptLegacy: boolean, onlyOwner?: string) {
    // Bind an interrupted upgrade to its original login before moving any text.
    // A later login must never claim its predecessor's unconverted drafts.
    let migrate = false;
    if (protectedStore && !onlyOwner) {
      const saved = await local.getItem(upgradeKey);
      migrate = !!keep && adoptLegacy && (saved === null || saved === keep.sessionId);
      const marker = migrate ? keep!.sessionId : 'complete';
      if (saved !== marker) await local.setItem(upgradeKey, marker);
    }
    for (const entry of await local.getAllKeys()) {
      const encrypted = entry.startsWith(sealed);
      const name = encrypted ? entry.slice(sealed.length) : entry;
      const user = owner(name);
      if (!user || (onlyOwner && user !== onlyOwner)) continue;
      if (encrypted) {
        if (protectedStore && (user !== keep?.owner || !name.endsWith(':session:' + keep.sessionId))) {
          await protectedStore.removeItem(name);
        }
        continue;
      }
      if (protectedStore && keep?.owner === user && migrate && !name.includes(':session:')) {
        const destination = sessionKey(name, keep);
        const prior = await local.getItem(name);
        if (prior !== null && await protectedStore.getItem(destination) === null) {
          // Keep the original serialized attempt and operation ID intact.
          await protectedStore.setItem(destination, prior);
        }
      }
      await local.removeItem(name);
    }
    if (migrate) await local.setItem(upgradeKey, 'complete');
  }
  async function ready() {
    const work = prepare;
    if (work) {
      await work();
      if (prepare === work) prepare = undefined;
    }
  }
  function setSession(session: Session | null, restored = false) {
    const next = leaseFor(session);
    if (current === undefined || current?.sessionId !== next?.sessionId || current?.owner !== next?.owner) {
      const adoptLegacy = current === undefined && restored;
      current = next;
      memory.clear();
      // Capture this transition's cleanup even if another login arrives before
      // it runs. A failed scan is retried before subsequent draft operations.
      const work = () => sweep(next, adoptLegacy);
      prepare = work;
      return ordered(async () => {
        await work();
        if (prepare === work) prepare = undefined;
      });
    }
    return ordered(ready);
  }
  function forAccount(userId: string): CredentialStore {
    const lease = current;
    function access<T>(key: string, operation: (physical: string) => Promise<T>) {
      function check() {
        if (!lease || current !== lease || lease.owner !== userId.toLowerCase() || owner(key) !== lease.owner || key.includes(':session:')) {
          throw new Error('Your draft session has ended.');
        }
      }
      return ordered(async () => {
        check();
        await ready();
        check();
        const value = await operation(sessionKey(key, lease!));
        check();
        return value;
      });
    }
    return {
      getItem: key => access(key, async name => {
        if (!protectedStore) return memory.get(name) ?? null;
        const value = await protectedStore.getItem(name);
        if (value === null && await local.getItem(sealed + name) !== null) throw new Error('Unable to unlock saved draft.');
        return value;
      }),
      setItem: (key, value) => access(key, async name => {
        if (protectedStore) await protectedStore.setItem(name, value);
        else memory.set(name, value);
      }),
      removeItem: key => access(key, async name => {
        if (protectedStore) await protectedStore.removeItem(name);
        else memory.delete(name);
      }),
    };
  }
  function clearAccount(userId: string) {
    const user = userId.toLowerCase();
    if (current?.owner === user) return setSession(null);
    return ordered(() => sweep(null, false, user));
  }
  return { setSession, forAccount, clearAccount, get sessionId() { return current?.sessionId; } };
}

export const privateDrafts = createPrivateDrafts(env.supabaseUrl, AsyncStorage, Platform.OS === 'web' ? null : credentialStorage);
