import { MessagingError } from './messages';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAVAILABLE = 'Unable to load this request contact. Check your connection and retry.';

export type RequestContact = {
  profileId: string;
  displayName: string;
  major: string | null;
  yearOfStudy: number | null;
  campusDisplayName: string | null;
};

function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new MessagingError('INVALID_INPUT', 'Choose a valid request or account.');
  }
  return value.toLowerCase();
}

async function sessionFor(userId: string) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id.toLowerCase() !== userId || !data.session.access_token) {
      throw new MessagingError('ACCOUNT_CHANGED', 'Your account changed. Reopen this request before continuing.');
    }
    return data.session;
  } catch (error) {
    if (error instanceof MessagingError) throw error;
    throw new MessagingError('CONTACT_UNAVAILABLE', UNAVAILABLE);
  }
}

async function call(userId: string, requestId: string, otherProfileId: string, method: string): Promise<unknown> {
  const actor = id(userId), request = id(requestId), other = id(otherProfileId);
  if (actor === other) throw new MessagingError('INVALID_INPUT', 'Choose someone else to message.');
  const session = await sessionFor(actor);
  const accessToken = session.access_token;
  let response: { data: unknown; error: unknown } | undefined;
  try {
    response = await supabase.rpc(method, { p_request_id: request, p_other_profile_id: other })
      .setHeader('Authorization', `Bearer ${accessToken}`);
  } catch {
    // Check the session even after failure; stale errors must not belong to another account.
  }
  await sessionFor(actor);
  if (!response || response.error) {
    const code = response?.error && typeof response.error === 'object' && 'code' in response.error
      ? response.error.code : null;
    if (code === '42501' || code === '22023') {
      throw new MessagingError(String(code), 'This request contact is unavailable to your account. Refresh the request.');
    }
    throw new MessagingError('CONTACT_UNAVAILABLE', UNAVAILABLE);
  }
  return response.data;
}

export async function loadRequestContact(userId: string, requestId: string, otherProfileId: string): Promise<RequestContact> {
  const data = await call(userId, requestId, otherProfileId, 'get_request_contact');
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    const row = data as Record<string, unknown>;
    if (id(row.profile_id) !== id(otherProfileId) || typeof row.display_name !== 'string' || !row.display_name.trim()
      || (row.major !== null && typeof row.major !== 'string')
      || (row.campus_display_name !== null && typeof row.campus_display_name !== 'string')
      || (row.year_of_study !== null && (typeof row.year_of_study !== 'number'
        || !Number.isInteger(row.year_of_study) || row.year_of_study < 1 || row.year_of_study > 8))) throw new Error();
    return { profileId: id(row.profile_id), displayName: row.display_name, major: row.major as string | null,
      yearOfStudy: row.year_of_study as number | null, campusDisplayName: row.campus_display_name as string | null };
  } catch {
    throw new MessagingError('INVALID_RESPONSE', UNAVAILABLE);
  }
}

export async function startRequestContactConversation(userId: string, requestId: string, otherProfileId: string): Promise<string> {
  const data = await call(userId, requestId, otherProfileId, 'start_request_contact_conversation');
  try { return id(data); } catch { throw new MessagingError('INVALID_RESPONSE', UNAVAILABLE); }
}
