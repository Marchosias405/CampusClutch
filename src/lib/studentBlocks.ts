import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from './env';
import { assertOfferSession } from './offers';
import { supabase } from './supabase';

export type StudentBlockState = {
  profile_id: string; blocked_by_me: boolean; interaction_blocked: boolean; revision: string;
};
export type BlockedStudent = { profile_id: string; display_name: string; blocked_at: string; revision: string };
export type StudentBlockAttempt = { blocked: boolean; expectedRevision: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validRevision = (value: unknown): value is string => typeof value === 'string'
  && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
const codeOf = (error: unknown) => error && typeof error === 'object' && 'code' in error ? error.code : null;
const invalid = () => Object.assign(new Error('This student is unavailable. Reopen their profile and try again.'), { code: 'CC_BLOCK_INPUT' });
function validateIds(userId: string, profileId: string) {
  if (!UUID.test(userId) || !UUID.test(profileId) || userId.toLowerCase() === profileId.toLowerCase()) throw invalid();
}
function parseState(value: unknown, profileId: string): StudentBlockState {
  const data = value as StudentBlockState | null;
  if (!data || data.profile_id?.toLowerCase() !== profileId.toLowerCase()
    || typeof data.blocked_by_me !== 'boolean' || typeof data.interaction_blocked !== 'boolean'
    || (data.blocked_by_me && !data.interaction_blocked) || !validRevision(data.revision)) throw new Error('Invalid block response.');
  return { profile_id: profileId.toLowerCase(), blocked_by_me: data.blocked_by_me,
    interaction_blocked: data.interaction_blocked, revision: data.revision };
}
async function blockSession(userId: string) {
  try { return await assertOfferSession(userId); }
  catch { throw Object.assign(new Error('Your account changed.'), { code: 'CC_BLOCK_SESSION' }); }
}
export function studentBlockError(error: unknown): string {
  const code = codeOf(error);
  if (code === 'CC_BLOCK_INPUT') return 'This student is unavailable. Reopen their profile and try again.';
  if (code === 'CC_BLOCK_SESSION') return 'Your session changed or could not be verified. Sign in again before retrying.';
  if (code === 'PT409') return 'Your block setting changed on another screen or device. Refresh before choosing again.';
  if (code === '42501') return 'This action is unavailable. Your saved change has been kept; try again after signing in.';
  return 'Unable to confirm this change. Check your connection and retry the same saved change; it may already have been applied.';
}
export async function getStudentBlockState(userId: string, profileId: string): Promise<StudentBlockState> {
  validateIds(userId, profileId);
  const session = await blockSession(userId);
  let response;
  try { response = await supabase.rpc('get_student_block_state', { p_profile_id: profileId })
    .setHeader('Authorization', `Bearer ${session.access_token}`); }
  catch (error) { await blockSession(userId); throw error; }
  await blockSession(userId);
  if (response.error) throw response.error;
  return parseState(response.data, profileId);
}
export async function setStudentBlock(userId: string, profileId: string, blocked: boolean, expectedRevision: string): Promise<StudentBlockState> {
  validateIds(userId, profileId);
  if (typeof blocked !== 'boolean' || !validRevision(expectedRevision)) throw invalid();
  const session = await blockSession(userId);
  let response;
  try { response = await supabase.rpc('set_student_block', {
    p_profile_id: profileId, p_blocked: blocked, p_expected_revision: expectedRevision,
  }).setHeader('Authorization', `Bearer ${session.access_token}`); }
  catch (error) { await blockSession(userId); throw error; }
  await blockSession(userId);
  if (response.error) throw response.error;
  const result = parseState(response.data, profileId);
  if (result.blocked_by_me !== blocked || BigInt(result.revision) < BigInt(expectedRevision)
    || BigInt(result.revision) > BigInt(expectedRevision) + BigInt(1)) throw new Error('Unconfirmed block response.');
  return result;
}
export async function getMyBlockedStudents(userId: string, offset = 0, limit = 20): Promise<BlockedStudent[]> {
  if (!UUID.test(userId) || !Number.isInteger(offset) || offset < 0 || offset > 10000
    || !Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid();
  const session = await blockSession(userId);
  let response;
  try { response = await supabase.rpc('get_my_blocked_students', { p_limit: limit, p_offset: offset })
    .setHeader('Authorization', `Bearer ${session.access_token}`); }
  catch (error) { await blockSession(userId); throw error; }
  await blockSession(userId);
  if (response.error) throw response.error;
  if (!Array.isArray(response.data) || response.data.length > limit) throw new Error('Invalid blocked students response.');
  const ids = new Set<string>();
  return response.data.map((row: BlockedStudent) => {
    if (!row || !UUID.test(row.profile_id) || row.profile_id.toLowerCase() === userId.toLowerCase()
      || ids.has(row.profile_id.toLowerCase()) || typeof row.display_name !== 'string'
      || typeof row.blocked_at !== 'string' || !Number.isFinite(Date.parse(row.blocked_at))
      || !validRevision(row.revision)) throw new Error('Invalid blocked student.');
    ids.add(row.profile_id.toLowerCase());
    return { profile_id: row.profile_id.toLowerCase(), display_name: row.display_name,
      blocked_at: row.blocked_at, revision: row.revision };
  });
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
export type StudentBlockOptions = { userId: string; profileId: string };
export type StudentBlockDependencies = {
  namespace: string; storage: Storage;
  load(userId: string, profileId: string): Promise<StudentBlockState>;
  send(userId: string, profileId: string, blocked: boolean, expectedRevision: string): Promise<StudentBlockState>;
};
export type StudentBlockModelState = {
  restored: boolean; restoreFailed: boolean; loading: boolean; busy: boolean;
  data: StudentBlockState | null; pending: StudentBlockAttempt | null; error: string;
};
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, action: () => Promise<T>): Promise<T> {
  const task = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(key, task);
  const finish = () => { if (queues.get(key) === task) queues.delete(key); };
  void task.then(finish, finish);
  return task;
}
export function studentBlockKey(namespace: string, options: StudentBlockOptions) {
  return `campusclutch:student-block:v1:${encodeURIComponent(namespace.replace(/\/+$/, ''))}:${options.userId.toLowerCase()}:${options.profileId.toLowerCase()}`;
}

export function createStudentBlockModel(options: StudentBlockOptions, overrides: Partial<StudentBlockDependencies> = {}) {
  validateIds(options.userId, options.profileId);
  const scope = { userId: options.userId.toLowerCase(), profileId: options.profileId.toLowerCase() };
  const deps: StudentBlockDependencies = { namespace: env.supabaseUrl, storage: AsyncStorage,
    load: getStudentBlockState, send: setStudentBlock, ...overrides };
  const namespace = deps.namespace.replace(/\/+$/, '');
  const key = studentBlockKey(namespace, scope);
  let state: StudentBlockModelState = { restored: false, restoreFailed: false, loading: false, busy: false, data: null, pending: null, error: '' };
  let active = true;
  let disposed = false;
  let epoch = 0;
  let writing = false;
  const listeners = new Set<() => void>();
  const alive = (ticket: number) => !disposed && active && epoch === ticket;
  const emit = () => { if (!disposed && active) listeners.forEach(listener => listener()); };
  const update = (patch: Partial<StudentBlockModelState>) => { if (!disposed) { state = { ...state, ...patch }; emit(); } };
  const serialize = (pending: StudentBlockAttempt) => JSON.stringify({ version: 1, namespace, ...scope, pending });
  const parse = (raw: string): StudentBlockAttempt => {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || data.namespace !== namespace || data.userId !== scope.userId
      || data.profileId !== scope.profileId || typeof data.pending?.blocked !== 'boolean'
      || !validRevision(data.pending?.expectedRevision)) throw new Error('Invalid saved block change.');
    return { blocked: data.pending.blocked, expectedRevision: data.pending.expectedRevision };
  };
  const clear = (raw: string) => inOrder(key, async () => {
    if (await deps.storage.getItem(key) === raw) await deps.storage.removeItem(key);
  });
  const refresh = async () => {
    if (disposed || !active || writing) return;
    const ticket = ++epoch;
    update({ loading: true, error: '', data: null });
    try {
      const raw = await inOrder(key, () => deps.storage.getItem(key));
      const pending = raw === null ? null : parse(raw);
      if (!alive(ticket)) return;
      update({ restored: true, restoreFailed: false, pending });
    } catch {
      if (alive(ticket)) update({ restored: false, restoreFailed: true, loading: false,
        error: 'Unable to restore your saved block setting. Retry loading before making another change.' });
      return;
    }
    try {
      const data = parseState(await deps.load(scope.userId, scope.profileId), scope.profileId);
      if (alive(ticket)) update({ data, error: state.pending ? 'A saved change is awaiting confirmation. Retry it before making another change.' : '' });
    } catch {
      if (alive(ticket)) update({ error: 'Unable to load this block setting. Check your connection and retry.' });
    } finally { if (alive(ticket)) update({ loading: false }); }
  };
  const submit = async (desired?: boolean) => {
    if (disposed || !active || writing || state.loading || !state.restored
      || (desired !== undefined && (state.pending || !state.data || desired === state.data.blocked_by_me))) return;
    if (desired === undefined && !state.pending) return;
    const ticket = ++epoch;
    writing = true;
    update({ busy: true, error: '' });
    let attempt: StudentBlockAttempt | null = null;
    let raw = '';
    let hadPending = !!state.pending;
    let dispatched = false;
    try {
      await inOrder(key, async () => {
        const stored = await deps.storage.getItem(key);
        const existing = stored === null ? null : parse(stored);
        hadPending = hadPending || !!existing;
        // Never overwrite another screen's ambiguous intent with a contrary action.
        if (existing && desired !== undefined) {
          if (alive(ticket)) update({ pending: existing, error: 'A saved change is awaiting confirmation. Retry it before making another change.' });
          return;
        }
        attempt = existing ?? state.pending ?? (state.data && desired !== undefined
          ? { blocked: desired, expectedRevision: state.data.revision } : null);
        if (!attempt || !alive(ticket)) return;
        raw = serialize(attempt);
        await deps.storage.setItem(key, raw);
      });
      if (!attempt || !raw || !alive(ticket)) return;
      const frozen = attempt as StudentBlockAttempt;
      update({ pending: frozen });
      dispatched = true;
      const data = parseState(await deps.send(scope.userId, scope.profileId, frozen.blocked, frozen.expectedRevision), scope.profileId);
      if (data.blocked_by_me !== frozen.blocked || BigInt(data.revision) < BigInt(frozen.expectedRevision)
        || BigInt(data.revision) > BigInt(frozen.expectedRevision) + BigInt(1)) throw new Error('Unconfirmed block response.');
      await clear(raw);
      if (alive(ticket)) update({ data, pending: null, error: '' });
    } catch (error) {
      if (codeOf(error) === 'PT409' && raw) {
        try {
          await clear(raw);
          if (alive(ticket)) update({ pending: null, data: null, error: studentBlockError(error) });
        } catch {
          if (alive(ticket)) update({ error: 'Unable to clear this outdated saved change. Retry it before making another change.' });
        }
      } else if (alive(ticket)) {
        update({ error: dispatched || hadPending ? studentBlockError(error)
          : 'Unable to save this change on your device. Nothing was sent. Retry before leaving this screen.' });
      }
    } finally {
      writing = false;
      if (!disposed) update({ busy: false });
      if (!disposed && active && ticket !== epoch) void refresh();
    }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    change: (blocked: boolean) => typeof blocked === 'boolean' ? submit(blocked) : Promise.resolve(),
    retry: () => submit(),
    setActive(next: boolean) { if (disposed || next === active) return; active = next; ++epoch;
      state = { ...state, data: null, loading: false }; emit(); },
    dispose() { disposed = true; ++epoch; listeners.clear(); },
  };
}
