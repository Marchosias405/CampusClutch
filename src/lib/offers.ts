import { supabase } from './supabase';

export type OfferAction = 'accepted' | 'rejected' | 'withdrawn';
export type RequestOffer = {
  id: string;
  request_id: string;
  offering_user_id: string;
  status: 'pending' | OfferAction;
  message: string | null;
  created_at: string;
  offer_round: number;
  request_offer_round: number;
  request_title: string;
  request_status: 'open' | 'accepted' | 'completed' | 'cancelled' | 'expired';
  request_deadline_at: string;
  helper_display_name: string | null;
  helper_major: string | null;
  helper_year: number | null;
  helper_campus: string | null;
};

export async function assertOfferSession(expectedUserId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== expectedUserId) {
    throw new Error('Your account changed. Reopen this screen before continuing.');
  }
  return data.session;
}

export async function loadOfferPage(userId: string, requestId: string | null, offset = 0) {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('get_request_offer_page_v2', {
    p_request_id: requestId, p_limit: 20, p_offset: offset,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  const items = data as RequestOffer[];
  return { items, hasMore: items.length === 20, nextOffset: offset + items.length };
}

export async function submitOffer(userId: string, requestId: string, message: string) {
  if (message.trim().length > 1000) throw new Error('Keep your message within 1,000 characters.');
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('create_my_request_offer', {
    p_request_id: requestId, p_message: message.trim() || null,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  return data as string;
}

export async function decideOffer(userId: string, offerId: string, action: OfferAction, expectedRound: number, expectedPoints?: number) {
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('decide_request_offer_for_round', {
    p_offer_id: offerId, p_action: action, p_expected_round: expectedRound, p_expected_points: expectedPoints ?? null,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export async function renewOffer(userId: string, offerId: string, expectedRound: number, message: string) {
  if (message.trim().length > 1000) throw new Error('Keep your message within 1,000 characters.');
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('renew_my_request_offer', {
    p_offer_id: offerId, p_expected_round: expectedRound, p_message: message.trim() || null,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export async function reopenRequest(userId: string, requestId: string, expectedRound: number, deadlineIso: string) {
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('reopen_my_request', {
    p_request_id: requestId, p_expected_round: expectedRound, p_deadline: deadlineIso,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export function offerError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'P0002') return 'Not enough available points to accept this helper. Check your balance and reserved points in Profile.';
  if (code === '22023') return 'This request or offer has changed. Refresh to see its latest status.';
  if (code === '42501') return 'This action is unavailable to your account. Refresh or sign in again.';
  return 'Unable to confirm the action or load offers. Check your connection and refresh before retrying; your offer may already have been saved.';
}
