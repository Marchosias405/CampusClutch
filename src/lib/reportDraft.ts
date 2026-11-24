import { privateDrafts } from './privateDrafts';
import { env } from './env';
import {
  isReportId, isReportReason, isReportTargetType, normalizeReportAttempt,
  safetyReportError, submitSafetyReport, validateReportFields,
} from './safetyReports';
import type { ReportReason, ReportReceipt, ReportTargetType, SafetyReportAttempt } from './safetyReports';

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export type ReportDraftState = {
  restored: boolean; restoreFailed: boolean; busy: boolean;
  reason: ReportReason | null; details: string;
  pending: SafetyReportAttempt | null; receipt: ReportReceipt | null; error: string;
};
export type ReportDraftOptions = { userId: string; targetType: ReportTargetType; targetId: string };
export type ReportDraftDependencies = {
  namespace: string; storage: Storage; randomUUID(): string;
  send(userId: string, attempt: SafetyReportAttempt): Promise<ReportReceipt>;
};
type SavedReport = {
  version: 1; namespace: string; userId: string; targetType: ReportTargetType; targetId: string;
  reason: ReportReason | null; details: string; pending: SafetyReportAttempt | null;
};

const storageQueues = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (storageQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  storageQueues.set(key, result);
  const finish = () => { if (storageQueues.get(key) === result) storageQueues.delete(key); };
  void result.then(finish, finish);
  return result;
}

export function reportDraftKey(namespace: string, options: ReportDraftOptions) {
  return `campusclutch:report-draft:v1:${encodeURIComponent(namespace.replace(/\/+$/, ''))}:${options.userId.toLowerCase()}:${options.targetType}:${options.targetId.toLowerCase()}`;
}

export function createReportDraftModel(options: ReportDraftOptions, overrides: Partial<ReportDraftDependencies> = {}) {
  if (!isReportId(options.userId) || !isReportId(options.targetId) || !isReportTargetType(options.targetType)) {
    throw new Error('Invalid report route.');
  }
  const scope = { userId: options.userId.toLowerCase(), targetType: options.targetType, targetId: options.targetId.toLowerCase() };
  const deps: ReportDraftDependencies = {
    namespace: env.supabaseUrl, storage: overrides.storage ?? privateDrafts.forAccount(scope.userId),
    randomUUID: () => globalThis.crypto.randomUUID(), send: submitSafetyReport, ...overrides,
  };
  const namespace = deps.namespace.replace(/\/+$/, '');
  const key = reportDraftKey(namespace, scope);
  let state: ReportDraftState = { restored: false, restoreFailed: false, busy: false, reason: null, details: '', pending: null, receipt: null, error: '' };
  let disposed = false;
  let active = true;
  let revision = 0;
  let observedRaw: string | null | undefined;
  const listeners = new Set<() => void>();
  const emit = () => { if (!disposed && active) listeners.forEach(listener => listener()); };
  const update = (patch: Partial<ReportDraftState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    emit();
  };
  const saved = (values: Pick<ReportDraftState, 'reason' | 'details' | 'pending'>): SavedReport => ({ version: 1, namespace, ...scope, ...values });
  const serialize = (values: Pick<ReportDraftState, 'reason' | 'details' | 'pending'>) => JSON.stringify(saved(values));
  const parse = (raw: string): Pick<ReportDraftState, 'reason' | 'details' | 'pending'> => {
    const value = JSON.parse(raw) as SavedReport;
    if (!value || value.version !== 1 || value.namespace !== namespace || value.userId !== scope.userId
      || value.targetType !== scope.targetType || value.targetId !== scope.targetId
      || (value.reason !== null && !isReportReason(value.reason)) || typeof value.details !== 'string'
      || Array.from(value.details).length > 2000) throw new Error('Invalid saved report.');
    let pending: SafetyReportAttempt | null = null;
    if (value.pending !== null) {
      pending = normalizeReportAttempt(value.pending);
      if (pending.targetType !== scope.targetType || pending.targetId !== scope.targetId
        || pending.reason !== value.reason || pending.details !== value.details
        || JSON.stringify(pending) !== JSON.stringify(value.pending)) throw new Error('Invalid saved report.');
    }
    return { reason: value.reason, details: value.details, pending };
  };
  const editable = () => !disposed && active && state.restored && !state.busy && !state.pending && !state.receipt;
  const saveDraft = () => {
    const ticket = ++revision;
    const raw = serialize({ reason: state.reason, details: state.details, pending: null });
    void inOrder(key, async () => {
      const stored = await deps.storage.getItem(key);
      if (stored !== null) {
        const values = parse(stored);
        if (values.pending) {
          update({ ...values, error: 'A saved report is awaiting confirmation. Retry it before starting another report.' });
          return;
        }
      }
      await deps.storage.setItem(key, raw);
    }).catch(() => {
      if (ticket === revision && !state.busy) update({ error: 'Unable to save this report on your device. Your text is still here; retry before leaving.' });
    });
  };
  const restore = async () => {
    if (disposed || !active || state.restored || state.busy) return;
    update({ busy: true, error: '', restoreFailed: false });
    try {
      const raw = await inOrder(key, () => deps.storage.getItem(key));
      observedRaw = raw;
      const values = raw === null ? { reason: null, details: '', pending: null } : parse(raw);
      update({ ...values, restored: true, restoreFailed: false });
    } catch {
      update({ restored: false, restoreFailed: true, error: 'Unable to restore your saved report. Retry loading it, or discard the saved attempt to start again.' });
    } finally { update({ busy: false }); }
  };
  const submit = async () => {
    if (disposed || !active || !state.restored || state.busy || state.receipt) return;
    const issue = state.pending ? null : validateReportFields(state.reason, state.details);
    if (issue) { update({ error: issue }); return; }
    update({ busy: true, error: '' });
    ++revision;
    const wasPending = Boolean(state.pending);
    let attempt: SafetyReportAttempt;
    let raw: string;
    try {
      // An overlapping screen for this target must reuse, never overwrite, a
      // durable attempt whose response may still be in flight.
      const draft = { reason: state.reason, details: state.details, pending: state.pending };
      await inOrder(key, async () => {
        const stored = await deps.storage.getItem(key);
        const existing = stored === null ? null : parse(stored);
        attempt = existing?.pending ?? draft.pending ?? normalizeReportAttempt({
          operationId: deps.randomUUID(), targetType: scope.targetType, targetId: scope.targetId,
          reason: draft.reason as ReportReason, details: draft.details,
        });
        raw = serialize({ reason: attempt.reason, details: attempt.details, pending: attempt });
        // A network write is permitted only after its exact retry identity is durable.
        await deps.storage.setItem(key, raw);
      });
      update({ reason: attempt!.reason, details: attempt!.details, pending: attempt! });
    } catch {
      update({ busy: false, error: wasPending
        ? 'Unable to save the retry on this device. Your previous attempt may already have arrived. Keep this screen open and try again.'
        : 'Unable to save this report on your device. Nothing was submitted. Keep this screen open and try again.' });
      return;
    }
    if (disposed || !active) { update({ busy: false }); return; }
    try {
      const receipt = await deps.send(scope.userId, attempt!);
      // A prior screen's late success must not erase a newer draft for this target.
      let cleanupFailed = false;
      try {
        await inOrder(key, async () => {
          if (await deps.storage.getItem(key) === raw) await deps.storage.removeItem(key);
        });
      } catch { cleanupFailed = true; }
      update({ receipt, pending: null, error: cleanupFailed
        ? 'Your report was received. The saved copy could not be cleared on this device; retrying that copy will not submit it twice.' : '' });
    } catch (error) { update({ error: safetyReportError(error) }); }
    finally { update({ busy: false }); }
  };
  // The screen asks for confirmation first: discarding cannot retract a server report.
  const discard = async () => {
    if (disposed || !active || state.busy) return;
    update({ busy: true, error: '' });
    ++revision;
    const raw = state.restored ? serialize({ reason: state.reason, details: state.details, pending: state.pending }) : observedRaw;
    try {
      await inOrder(key, async () => {
        const stored = await deps.storage.getItem(key);
        if (raw === undefined && stored !== null) {
          // A failed read did not identify a saved attempt to discard. Preserve
          // any subsequently readable valid draft and let the user restore it.
          let valid = true;
          try { parse(stored); } catch { valid = false; }
          if (valid) throw new Error('Saved report changed.');
        } else if (stored !== null && stored !== raw) throw new Error('Saved report changed.');
        await deps.storage.removeItem(key);
      });
      update({ restored: true, restoreFailed: false, reason: null, details: '', pending: null, receipt: null });
    } catch { update({ error: 'Unable to discard the saved report. Your saved attempt has been kept; try again.' }); }
    finally { update({ busy: false }); }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore, submit, discard,
    setReason(reason: ReportReason | null) {
      if (!editable() || (reason !== null && !isReportReason(reason))) return;
      update({ reason, error: '' }); saveDraft();
    },
    setDetails(details: string) {
      if (!editable() || typeof details !== 'string') return;
      update({ details: Array.from(details).slice(0, 2000).join(''), error: '' }); saveDraft();
    },
    setActive(next: boolean) { if (disposed) return; active = next; if (active) emit(); },
    dispose() { disposed = true; listeners.clear(); },
  };
}
