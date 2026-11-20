import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from './env';
import { moderationAccessLost, moderationCode } from './moderation';
import { normalizeEnforcement, enforceReport } from './moderationEnforcement';
import type { EnforcementAttempt, EnforcementReceipt, EnforcementKind } from './moderationEnforcement';
import { isReportId } from './safetyReports';

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
type Dependencies = { namespace: string; storage: Storage; randomUUID(): string; send(userId: string, attempt: EnforcementAttempt): Promise<EnforcementReceipt> };
export type EnforcementState = {
  ready: boolean; busy: boolean; pending: EnforcementAttempt | null; receipt: EnforcementReceipt | null;
  conflict: boolean; accessLost: boolean; error: string;
};
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, work: () => Promise<T>) {
  const result = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(key, result);
  const finish = () => { if (queues.get(key) === result) queues.delete(key); };
  void result.then(finish, finish);
  return result;
}
export function enforcementKey(namespace: string, userId: string, reportId: string) {
  return `campusclutch:moderation-enforcement:v1:${encodeURIComponent(namespace.replace(/\/+$/, ''))}:${userId.toLowerCase()}:${reportId.toLowerCase()}`;
}

// Only an unconfirmed action is durable. Report evidence, queue summaries,
// history and unfinished notes are never copied into device storage.
export function createModerationEnforcement(userId: string, reportId: string, overrides: Partial<Dependencies> = {}) {
  if (!isReportId(userId) || !isReportId(reportId)) throw new Error('Invalid moderation route.');
  const scope = { userId: userId.toLowerCase(), reportId: reportId.toLowerCase() };
  const deps: Dependencies = { namespace: env.supabaseUrl, storage: AsyncStorage,
    randomUUID: () => globalThis.crypto.randomUUID(), send: enforceReport, ...overrides };
  const namespace = deps.namespace.replace(/\/+$/, '');
  const key = enforcementKey(namespace, scope.userId, scope.reportId);
  let state: EnforcementState = { ready: false, busy: false, pending: null, receipt: null, conflict: false, accessLost: false, error: '' };
  let disposed = false;
  let active = true;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<EnforcementState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    if (active) listeners.forEach(listener => listener());
  };
  const serialize = (attempt: EnforcementAttempt) => JSON.stringify({ version: 1, namespace, ...scope, attempt });
  const parse = (raw: string): EnforcementAttempt => {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || data.namespace !== namespace || data.userId !== scope.userId || data.reportId !== scope.reportId) throw new Error('Invalid saved action.');
    const attempt = normalizeEnforcement(data.attempt);
    if (attempt.reportId !== scope.reportId || JSON.stringify(attempt) !== JSON.stringify(data.attempt)) throw new Error('Invalid saved action.');
    return attempt;
  };
  const restore = async () => {
    if (disposed || !active || state.busy || state.ready) return;
    update({ busy: true, error: '' });
    try {
      const raw = await inOrder(key, () => deps.storage.getItem(key));
      update({ ready: true, pending: raw === null ? null : parse(raw) });
    } catch { update({ error: 'Unable to restore the saved action. Retry loading before taking an action.' }); }
    finally { update({ busy: false }); }
  };
  const submit = async (fields?: { expectedVersion: number; kind: EnforcementKind; reason: string; reviewUpdatedAt: string | null }) => {
    if (disposed || !active || !state.ready || state.busy || state.receipt || state.conflict || state.accessLost) return;
    if (!state.pending && !fields) return;
    update({ busy: true, error: '' });
    let attempt: EnforcementAttempt;
    let raw: string;
    try {
      await inOrder(key, async () => {
        const existing = await deps.storage.getItem(key);
        attempt = existing ? parse(existing) : state.pending ?? normalizeEnforcement({ ...fields!, reportId: scope.reportId, operationId: deps.randomUUID() });
        raw = serialize(attempt);
        await deps.storage.setItem(key, raw);
      });
      update({ pending: attempt! });
    } catch {
      update({ busy: false, error: 'Unable to save this action on the device. No new attempt was sent. Keep this screen open and retry.' });
      return;
    }
    if (disposed || !active) { update({ busy: false }); return; }
    try {
      const receipt = await deps.send(scope.userId, attempt!);
      let cleanupFailed = false;
      try {
        await inOrder(key, async () => { if (await deps.storage.getItem(key) === raw) await deps.storage.removeItem(key); });
      } catch { cleanupFailed = true; }
      update({ receipt, pending: null, error: cleanupFailed ? 'Action recorded. The saved copy could not be cleared; retrying it is safe.' : '' });
    } catch (error) {
      const conflict = moderationCode(error) === 'PT409';
      const accessLost = moderationAccessLost(error);
      update({ conflict, accessLost, error: conflict
        ? 'Another reviewer changed this report. Review the latest version before making a new action.'
        : accessLost ? 'Moderation access could not be verified. Your saved action is kept for your account.'
          : 'Unable to confirm the action. Retry the same saved action; it may already have been recorded.' });
    } finally { update({ busy: false }); }
  };
  // Only a definitive conflict permits abandoning a pending operation. Unknown
  // outcomes must first be reconciled by exact retry, even after app restart.
  const clearConflict = async () => {
    if (disposed || !active || state.busy || !state.conflict || !state.pending) return false;
    update({ busy: true });
    const raw = serialize(state.pending);
    try {
      await inOrder(key, async () => {
        const stored = await deps.storage.getItem(key);
        if (stored !== null && stored !== raw) throw new Error('Saved action changed.');
        await deps.storage.removeItem(key);
      });
      update({ pending: null, conflict: false, error: '' });
      return true;
    } catch { update({ error: 'Unable to clear the conflicted attempt. Retry; the saved action has been kept.' }); return false; }
    finally { update({ busy: false }); }
  };
  return {
    getState: () => state, restore, submit, clearConflict,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setActive(value: boolean) { active = value; },
    dispose() { disposed = true; active = false; listeners.clear(); },
  };
}
