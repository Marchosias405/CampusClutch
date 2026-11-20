import { NOTIFICATION_EVENT_TYPES } from '../types/notifications';
import type { NotificationCursor, NotificationItem, NotificationPage } from '../types/notifications';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_CHANGED = 'Your account changed. Reopen notifications before continuing.';

export class NotificationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'NotificationError';
  }
}

function invalid(message: string): never { throw new NotificationError('INVALID_INPUT', message); }
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('Refresh notifications before continuing.');
  return value.toLowerCase();
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value.replace(/\.\d+/, fraction => fraction.slice(0, 4))))) {
    invalid('Refresh notifications before continuing.');
  }
  return value;
}
function timestampMicros(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const milliseconds = Date.parse(value.replace(/\.\d+/, `.${fraction.slice(0, 3).padEnd(3, '0')}`));
  return BigInt(milliseconds) * 1000n
    + BigInt(Number(fraction.slice(0, 6).padEnd(6, '0')) - Number(fraction.slice(0, 3).padEnd(3, '0')) * 1000);
}
function safeError(error: unknown): NotificationError {
  if (error instanceof NotificationError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === '42501') return new NotificationError(code, 'Notifications are unavailable to this account. Sign in again and retry.');
  if (code === '22023') return new NotificationError(code, 'This notification is no longer available. Refresh notifications and try again.');
  return new NotificationError('UNCONFIRMED', 'Unable to update notifications. Check your connection and retry.');
}
export function notificationError(error: unknown): string { return safeError(error).message; }

async function notificationSession(expectedUserId: string) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id.toLowerCase() !== expectedUserId || !data.session?.access_token) {
      throw new NotificationError('ACCOUNT_CHANGED', ACCOUNT_CHANGED);
    }
    return data.session;
  } catch (error) { throw safeError(error); }
}
async function call(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const expectedUserId = uuid(userId);
  const session = await notificationSession(expectedUserId);
  // A request always acts using its captured account, including across token/account changes.
  const accessToken = session.access_token;
  let response: { data: unknown; error: unknown } | undefined;
  let failure: unknown;
  try { response = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${accessToken}`); }
  catch (error) { failure = error; }
  // Suppress both successful data and failures from an account that has since signed out.
  await notificationSession(expectedUserId);
  if (!response) throw safeError(failure);
  if (response.error) throw safeError(response.error);
  return response.data;
}
function parse<T>(read: () => T): T {
  try { return read(); }
  catch { throw new NotificationError('INVALID_RESPONSE', 'Unable to load notifications. Refresh and try again.'); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > limit) throw new Error();
  return value;
}
const nullableUuid = (value: unknown): string | null => value === null ? null : uuid(value);
function item(value: unknown, userId: string): NotificationItem {
  const row = record(value);
  if (uuid(row.recipient_id) !== userId.toLowerCase()
    || !NOTIFICATION_EVENT_TYPES.includes(row.event_type as NotificationItem['event_type'])
    || row.navigation_key !== (row.event_type === 'message_received' ? 'conversation'
      : ['account_warning', 'appeal_decided'].includes(row.event_type as string) ? 'account_notice' : 'request_details')
    || (['account_warning', 'appeal_decided'].includes(row.event_type as string) && [row.actor_id, row.request_id, row.offer_id, row.conversation_id, row.message_id].some(value => value !== null))) {
    throw new Error();
  }
  return {
    id: uuid(row.id), recipient_id: uuid(row.recipient_id), actor_id: nullableUuid(row.actor_id),
    event_type: row.event_type as NotificationItem['event_type'],
    title: text(row.title, 160), body: text(row.body, row.event_type === 'account_warning' ? 2200 : 500),
    request_id: nullableUuid(row.request_id), offer_id: nullableUuid(row.offer_id),
    conversation_id: nullableUuid(row.conversation_id), message_id: nullableUuid(row.message_id),
    navigation_key: row.navigation_key as NotificationItem['navigation_key'],
    read_at: row.read_at === null ? null : timestamp(row.read_at), created_at: timestamp(row.created_at),
  };
}
export async function loadNotificationPage(userId: string, options: {
  limit?: number; before?: NotificationCursor | null;
} = {}): Promise<NotificationPage> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid('Choose a page size from 1 to 50.');
  const before = options.before
    ? { createdAt: timestamp(options.before.createdAt), id: uuid(options.before.id) }
    : null;
  const data = await call(userId, 'get_my_notifications_v3', {
    p_limit: limit, p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null,
  });
  return parse(() => {
    if (!Array.isArray(data) || data.length > limit) throw new Error();
    const items = data.map(value => item(value, userId));
    if (new Set(items.map(value => value.id)).size !== items.length) throw new Error();
    let previous = before ? { time: timestampMicros(before.createdAt), id: before.id } : null;
    for (const value of items) {
      const current = { time: timestampMicros(value.created_at), id: value.id };
      if (previous && (current.time > previous.time || (current.time === previous.time && current.id >= previous.id))) throw new Error();
      previous = current;
    }
    const hasMore = items.length === limit, last = items[items.length - 1];
    return { items, hasMore, nextCursor: hasMore ? { createdAt: last.created_at, id: last.id } : null };
  });
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error();
  return value;
}
export async function loadUnreadNotificationCount(userId: string): Promise<number> {
  const data = await call(userId, 'get_my_notification_unread_count_v3', {});
  return parse(() => count(data));
}
export async function markNotificationRead(userId: string, notificationId: string): Promise<string> {
  const id = uuid(notificationId);
  const data = await call(userId, 'mark_my_notification_read', { p_notification_id: id });
  return parse(() => {
    if (uuid(data) !== id) throw new Error();
    return id;
  });
}
export async function markAllNotificationsRead(userId: string): Promise<number> {
  return parseCount(await call(userId, 'mark_all_my_notifications_read_v3', {}));
}
function parseCount(value: unknown): number { return parse(() => count(value)); }

export type PushPreference = 'push_enabled' | 'messages' | 'offers' | 'request_updates';
export type PushSettings = Record<PushPreference | 'registered', boolean>;

async function pushSettingsCall(userId: string, name: string, args: Record<string, unknown>) {
  const response = await call(userId, name, args);
  return parse(() => {
    const row = record(response);
    const fields = ['push_enabled', 'messages', 'offers', 'request_updates', 'registered'] as const;
    for (const field of fields) if (typeof row[field] !== 'boolean') throw new Error();
    return Object.fromEntries(fields.map(field => [field, row[field]])) as PushSettings;
  });
}
export const loadPushSettings = (userId: string) => pushSettingsCall(userId, 'get_my_push_settings', {});
export const savePushPreference = (userId: string, name: PushPreference, enabled: boolean) =>
  pushSettingsCall(userId, 'set_my_push_preference', { p_name: name, p_enabled: enabled });
export const savePushDevice = (userId: string, token: string | null) =>
  pushSettingsCall(userId, 'set_my_android_push_device', { p_token: token });
export const refreshPushDevice = (userId: string, token: string) =>
  pushSettingsCall(userId, 'refresh_my_android_push_device', { p_token: token });
export async function openPushNotification(userId: string, id: string) {
  const response = await call(userId, 'open_my_push_notification', { p_notification_id: uuid(id) });
  return getNotificationTarget(parse(() => item(response, userId)));
}

export type NotificationTarget = {
  pathname: '/requests/[id]' | '/messages/[id]';
  params: { id: string };
} | { pathname: '/profile/appeals' };
/** Only fixed app destinations are allowed; missing/deleted targets remain readable notices. */
export function getNotificationTarget(value: NotificationItem): NotificationTarget | null {
  if (value.navigation_key === 'account_notice') return { pathname: '/profile/appeals' };
  if (value.navigation_key === 'request_details' && value.request_id && UUID.test(value.request_id)) {
    return { pathname: '/requests/[id]', params: { id: value.request_id.toLowerCase() } };
  }
  if (value.navigation_key === 'conversation' && value.conversation_id && UUID.test(value.conversation_id)) {
    return { pathname: '/messages/[id]', params: { id: value.conversation_id.toLowerCase() } };
  }
  return null;
}
