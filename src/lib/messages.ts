import type {
  ConversationCursor, ConversationMessage, ConversationPage, ConversationSummary,
  MessagePage, MessageSequence, SendMessageInput,
} from '../types/messaging';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEQUENCE = '9223372036854775807';
const ACCOUNT_CHANGED = 'Your account changed. Reopen this screen before continuing.';
const UNCONFIRMED = 'Unable to confirm the message status. Check your connection and retry with the same message; it may already have been saved.';

export class MessagingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MessagingError';
  }
}

function invalid(message: string): never {
  throw new MessagingError('INVALID_INPUT', message);
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`Choose a valid ${label}.`);
  return value.toLowerCase();
}

function sequence(value: unknown, allowZero = false): MessageSequence {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)
    || (!allowZero && value === '0') || value.length > MAX_SEQUENCE.length
    || (value.length === MAX_SEQUENCE.length && value > MAX_SEQUENCE)) {
    invalid('Refresh the conversation before continuing.');
  }
  return value;
}

function pageLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) invalid('Choose a page size from 1 to 50.');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) {
    invalid('Refresh the conversation before continuing.');
  }
  return value;
}

function safeError(error: unknown): MessagingError {
  if (error instanceof MessagingError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === '42501') return new MessagingError(code, 'This conversation is unavailable to your account. Refresh or sign in again.');
  if (code === '22023') return new MessagingError(code, 'This conversation or message is unavailable or has changed. Refresh before continuing.');
  if (code === '23505') return new MessagingError(code, 'This message ID was already used. Refresh to check the original message before sending again.');
  if (code === '55000') return new MessagingError(code, 'This conversation is unavailable for new messages. Refresh to check its status.');
  return new MessagingError('UNCONFIRMED', UNCONFIRMED);
}

export function messagingError(error: unknown): string {
  return safeError(error).message;
}

async function messagingSession(expectedUserId: string) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id.toLowerCase() !== expectedUserId || !data.session?.access_token) {
      throw new MessagingError('ACCOUNT_CHANGED', ACCOUNT_CHANGED);
    }
    return data.session;
  } catch (error) {
    throw safeError(error);
  }
}

async function call(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const expectedUserId = uuid(userId, 'account');
  const session = await messagingSession(expectedUserId);
  // Capture the credential before awaiting the RPC so an account switch cannot change its actor.
  const accessToken = session.access_token;
  let response: { data: unknown; error: unknown } | undefined;
  let failure: unknown;
  try {
    response = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${accessToken}`);
  } catch (error) {
    failure = error;
  }
  // Check identity on both success and failure; neither stale data nor stale errors belong to a new account.
  await messagingSession(expectedUserId);
  if (!response) throw safeError(failure);
  if (response.error) throw safeError(response.error);
  return response.data;
}

function parse<T>(reader: () => T): T {
  try { return reader(); } catch {
    throw new MessagingError('INVALID_RESPONSE', 'Unable to load this conversation. Refresh and try again.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

function nullableText(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') throw new Error();
  return value;
}

function summary(value: unknown, userId: string): ConversationSummary {
  const row = record(value);
  if (row.type !== 'direct' || !['active', 'closed', 'removed'].includes(String(row.status))
    || !Number.isSafeInteger(row.unread_count) || (row.unread_count as number) < 0) throw new Error();
  const otherId = uuid(row.other_profile_id, 'profile');
  if (otherId === userId.toLowerCase()) throw new Error();
  return {
    id: uuid(row.id, 'conversation'), type: 'direct', status: row.status as ConversationSummary['status'],
    other_profile_id: otherId, other_display_name: nullableText(row.other_display_name),
    last_message_body: nullableText(row.last_message_body),
    last_message_at: row.last_message_at === null ? null : timestamp(row.last_message_at),
    last_activity_at: timestamp(row.last_activity_at),
    last_message_sequence: sequence(row.last_message_sequence, true),
    last_read_sequence: sequence(row.last_read_sequence, true), unread_count: row.unread_count as number,
    created_at: timestamp(row.created_at),
  };
}

function message(value: unknown, conversationId: string): ConversationMessage {
  const row = record(value);
  if (uuid(row.conversation_id, 'conversation') !== conversationId || typeof row.body !== 'string') throw new Error();
  return {
    id: uuid(row.id, 'message'), conversation_id: conversationId, sender_id: uuid(row.sender_id, 'sender'),
    client_message_id: uuid(row.client_message_id, 'message'), sequence: sequence(row.sequence),
    body: row.body, created_at: timestamp(row.created_at),
  };
}

function rows(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error();
  return value;
}

export async function startDirectConversation(userId: string, otherProfileId: string): Promise<string> {
  const otherId = uuid(otherProfileId, 'profile');
  if (otherId === uuid(userId, 'account')) invalid('Choose someone else to message.');
  const data = await call(userId, 'start_direct_conversation', { p_other_profile_id: otherId });
  return parse(() => uuid(data, 'conversation'));
}

export async function openRequestConversation(userId: string, requestId: string, offerRound: number): Promise<string> {
  if (!Number.isInteger(offerRound) || offerRound < 1 || offerRound > 2147483647) invalid('Choose a valid request assignment.');
  const data = await call(userId, 'open_request_conversation', {
    p_request_id: uuid(requestId, 'request'), p_offer_round: offerRound,
  });
  return parse(() => uuid(data, 'conversation'));
}

export async function loadConversationSummary(userId: string, conversationId: string): Promise<ConversationSummary> {
  const id = uuid(conversationId, 'conversation');
  const data = await call(userId, 'get_conversation_summary', { p_conversation_id: id });
  return parse(() => {
    const item = summary(data, userId);
    if (item.id !== id) throw new Error();
    return item;
  });
}

export async function loadConversationPage(userId: string, options: {
  limit?: number; before?: ConversationCursor | null;
} = {}): Promise<ConversationPage> {
  const limit = pageLimit(options.limit ?? 20);
  const data = await call(userId, 'get_my_conversations', {
    p_limit: limit,
    p_before_activity_at: options.before ? timestamp(options.before.activityAt) : null,
    p_before_id: options.before ? uuid(options.before.id, 'conversation') : null,
  });
  return parse(() => {
    const items = rows(data, limit).map(value => summary(value, userId));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error();
    const hasMore = items.length === limit, last = items[items.length - 1];
    return { items, hasMore, nextCursor: hasMore ? { activityAt: last.last_activity_at, id: last.id } : null };
  });
}

export async function loadMessagePage(userId: string, conversationId: string, options: {
  limit?: number; beforeSequence?: MessageSequence | null;
} = {}): Promise<MessagePage> {
  const id = uuid(conversationId, 'conversation'), limit = pageLimit(options.limit ?? 30);
  const before = options.beforeSequence == null ? null : sequence(options.beforeSequence);
  const data = await call(userId, 'get_conversation_messages', {
    p_conversation_id: id, p_before_sequence: before, p_limit: limit,
  });
  return parse(() => {
    const items = rows(data, limit).map(value => message(value, id));
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error();
    let previous = before;
    for (const item of items) {
      if (previous !== null && (item.sequence.length > previous.length
        || (item.sequence.length === previous.length && item.sequence >= previous))) throw new Error();
      previous = item.sequence;
    }
    const hasMore = items.length === limit;
    return { items, hasMore, nextCursor: hasMore ? items[items.length - 1].sequence : null };
  });
}

/** Retry an uncertain send with the same clientMessageId and unchanged body; never mint an ID here. */
export async function sendMessage(userId: string, input: SendMessageInput): Promise<ConversationMessage> {
  const id = uuid(input.conversationId, 'conversation'), clientId = uuid(input.clientMessageId, 'message');
  if (typeof input.body !== 'string') invalid('Write a message first.');
  const body = input.body.trim();
  if (!body) invalid('Write a message first.');
  if (Array.from(body).length > 4000) invalid('Keep your message within 4,000 characters.');
  const data = await call(userId, 'send_conversation_message', {
    p_conversation_id: id, p_client_message_id: clientId, p_body: body,
  });
  return parse(() => {
    const item = message(data, id);
    if (item.sender_id !== userId.toLowerCase() || item.client_message_id !== clientId || item.body !== body) throw new Error();
    return item;
  });
}

/** Supply the highest message sequence actually observed while the conversation is focused. */
export async function markConversationRead(userId: string, conversationId: string, throughSequence: MessageSequence): Promise<MessageSequence> {
  const data = await call(userId, 'mark_conversation_read', {
    p_conversation_id: uuid(conversationId, 'conversation'), p_through_sequence: sequence(throughSequence),
  });
  return parse(() => sequence(data, true));
}
