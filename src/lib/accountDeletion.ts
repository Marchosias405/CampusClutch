import '@/lib/crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { privateDrafts } from './privateDrafts';
import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { credentialStorage } from './credentialStorage';

export type DeletionReceipt = { id: string; secret: string; userId: string };
export type DeletionReadiness = { eligible: boolean; blockers: string[]; points_balance: string };
const key = `campusclutch:account-deletion:v1:${encodeURIComponent(env.supabaseUrl)}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readDeletionReceipt(): Promise<DeletionReceipt | null> {
  const raw = await credentialStorage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!uuid.test(value.id) || !uuid.test(value.userId) || !/^[0-9a-f]{64}$/.test(value.secret)) {
    throw new Error('Unable to read your saved deletion. Please contact support.');
  }
  return value;
}
export const clearDeletionReceipt = () => credentialStorage.removeItem(key);
export function deletionBlockerText(blockers: string[]) {
  if (blockers.includes('accepted_jobs') || blockers.includes('reserved_points')) return 'Finish or cancel accepted jobs before deleting your account.';
  if (blockers.includes('staff_access')) return 'Arrange an admin handover before deleting this account.';
  return 'Sign in again to confirm deletion.';
}
// React Native's AbortSignal has no static timeout(). Keep the timeout active
// through body decoding, and always clear it after success or failure.
async function postDeletionJson(path: string, headers: Record<string, string>, body: object,
  timeoutMs: number, errorMessage: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${env.supabaseUrl}${path}`, {
      method: 'POST', headers: { apikey: env.supabasePublishableKey, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new Error(errorMessage);
    return await response.json();
  } catch {
    throw new Error(errorMessage);
  } finally {
    clearTimeout(timer);
  }
}
async function rpc(token: string, name: string, args: object) {
  return postDeletionJson(`/rest/v1/rpc/${name}`, { Authorization: `Bearer ${token}` }, args, 20000,
    'Unable to confirm deletion. Check your connection and retry.');
}
export async function confirmAccountDeletion(userId: string, email: string, password: string,
  existing: DeletionReceipt | null, onSaved: (receipt: DeletionReceipt) => void,
  onRejected: () => void): Promise<DeletionReceipt> {
  if (existing && existing.userId !== userId) throw new Error('Sign in to the account that started this deletion.');
  const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let began = false;
  try {
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.session || login.data.user.id !== userId) throw new Error('Check your password and try again.');
    const token = login.data.session.access_token;
    const ready: DeletionReadiness = await rpc(token, 'get_my_account_deletion_preflight', {});
    if (ready.eligible !== true) throw new Error(deletionBlockerText(ready.blockers ?? []));
    const receipt = existing ?? { id: globalThis.crypto.randomUUID(), userId,
      secret: Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') };
    // Persist before dispatch. A lost response must reuse this receipt, including
    // after the database revoked the session or the app process restarted.
    await credentialStorage.setItem(key, JSON.stringify(receipt));
    onSaved(receipt);
    began = true;
    const result = await rpc(token, 'begin_my_account_deletion', {
      p_operation_id: receipt.id, p_receipt_secret: receipt.secret, p_confirmation: 'DELETE',
    });
    if (result.accepted === false) {
      await clearDeletionReceipt(); onRejected(); began = false;
      throw new Error(deletionBlockerText(result.blockers ?? []));
    }
    if (result.accepted !== true) throw new Error('Unable to confirm deletion. Retry to check its status.');
    return receipt;
  } finally {
    // A failed eligibility check must not leave a fresh unused Auth session.
    if (!began) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
export async function finishAccountDeletion(receipt: DeletionReceipt): Promise<'complete' | 'pending' | 'unconfirmed'> {
  const value = await postDeletionJson('/functions/v1/account-deletion', {},
    { id: receipt.id, secret: receipt.secret }, 30000,
    'Unable to check deletion status. Check your connection and retry.');
  if (!['complete', 'pending', 'unconfirmed'].includes(value.status)) throw new Error('Unable to check deletion. Please retry.');
  return value.status;
}
export async function clearDeletedAccountDrafts(userId: string) {
  await privateDrafts.clearAccount(userId);
  const keys = await AsyncStorage.getAllKeys();
  const own = keys.filter(name => name.startsWith('campusclutch:') && [env.supabaseUrl, encodeURIComponent(env.supabaseUrl)].some(scope =>
      name.includes(scope + ':' + userId.toLowerCase() + ':')) && name !== key);
  if (own.length) await AsyncStorage.multiRemove(own);
}
