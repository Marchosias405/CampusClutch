import { MessagingError } from './messages';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const LOAD_ERROR = 'Unable to load assignment chats. Check your connection and refresh.';

export type RequestConversationAssignment = {
  request_id: string;
  offer_round: number;
  poster_id: string;
  helper_id: string;
  status: 'reserved' | 'released' | 'settled';
};

function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new MessagingError('INVALID_INPUT', 'Choose a valid request or account.');
  }
  return value.toLowerCase();
}

async function sessionFor(userId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new MessagingError('ASSIGNMENTS_UNAVAILABLE', LOAD_ERROR);
  if (data.session?.user.id.toLowerCase() !== userId || !data.session.access_token) {
    throw new MessagingError('ACCOUNT_CHANGED', 'Your account changed. Reopen this request before continuing.');
  }
  return data.session;
}

/** RLS returns only the poster's rounds or the caller's own accepted assignments. */
export async function loadRequestConversationAssignments(userId: string, requestId: string, beforeRound: number | null = null) {
  const actor = id(userId), request = id(requestId);
  if (beforeRound !== null && (!Number.isInteger(beforeRound) || beforeRound < 1 || beforeRound > 2147483647)) {
    throw new MessagingError('INVALID_INPUT', 'Refresh the assignment history before continuing.');
  }
  const session = await sessionFor(actor);
  const accessToken = session.access_token;
  let query = supabase.from('request_point_reservations')
    .select('request_id,offer_round,poster_id,helper_id,status')
    .eq('request_id', request).order('offer_round', { ascending: false }).limit(PAGE_SIZE);
  if (beforeRound !== null) query = query.lt('offer_round', beforeRound);
  let response: { data: unknown; error: unknown } | undefined;
  try {
    response = await query.setHeader('Authorization', `Bearer ${accessToken}`);
  } catch {
    // Check identity even when the request fails; never attach an old error to a new account.
  }
  await sessionFor(actor);
  if (!response || response.error) throw new MessagingError('ASSIGNMENTS_UNAVAILABLE', LOAD_ERROR);
  try {
    if (!Array.isArray(response.data) || response.data.length > PAGE_SIZE) throw new Error();
    let previous = beforeRound;
    const items: RequestConversationAssignment[] = response.data.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const row = value as Record<string, unknown>;
      const poster = id(row.poster_id), helper = id(row.helper_id);
      const round = row.offer_round;
      if (id(row.request_id) !== request || (poster !== actor && helper !== actor) || poster === helper
        || typeof round !== 'number' || !Number.isInteger(round) || round < 1 || round > 2147483647
        || (previous !== null && round >= previous)
        || !['reserved', 'released', 'settled'].includes(String(row.status))) throw new Error();
      previous = round;
      return { request_id: request, offer_round: round, poster_id: poster, helper_id: helper,
        status: row.status as RequestConversationAssignment['status'] };
    });
    const hasMore = items.length === PAGE_SIZE;
    return { items, hasMore, nextRound: hasMore ? items[items.length - 1].offer_round : null };
  } catch {
    throw new MessagingError('INVALID_RESPONSE', LOAD_ERROR);
  }
}
