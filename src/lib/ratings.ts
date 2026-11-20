import { assertOfferSession } from './offers';
import { supabase } from './supabase';

export type RequestRatingContext = {
  eligible: true;
  request_id: string;
  offer_round: number;
  counterparty_id: string;
  counterparty_display_name: string | null;
  counterparty_role: 'poster' | 'helper';
  my_score: number | null;
  published: boolean;
  received_score: number | null;
};

export type AssignmentRatingContext = RequestRatingContext & { outcome: 'completed' | 'cancelled' };

export type ProfileRatingSummary = {
  profile_id: string;
  average_score: number | null;
  rating_count: number;
};

export async function loadRequestRating(userId: string, requestId: string): Promise<RequestRatingContext | null> {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('get_request_rating_context', {
    p_request_id: requestId,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  return data as RequestRatingContext | null;
}

export async function loadRequestRatingPage(userId: string, requestId: string, offset = 0) {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('get_my_request_rating_contexts', {
    p_request_id: requestId, p_limit: 20, p_offset: offset,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  const items = (data ?? []) as AssignmentRatingContext[];
  return { items, hasMore: items.length === 20, nextOffset: offset + items.length };
}

export async function submitRequestRating(userId: string, requestId: string, expectedRound: number, score: number): Promise<void> {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Choose a rating from 1 to 5 stars.');
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('submit_request_rating', {
    p_request_id: requestId, p_expected_round: expectedRound, p_score: score,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export async function loadProfileRatingSummary(userId: string, profileId: string, requestId?: string): Promise<ProfileRatingSummary> {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('get_profile_rating_summary', {
    p_profile_id: profileId, p_request_id: requestId ?? null,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  return data as ProfileRatingSummary;
}

export function ratingError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === '23505') return 'You already rated this assignment. Your saved rating cannot be changed. Refresh to see it.';
  if (code === '22023') return 'This assignment is not ready to rate or has changed. Refresh its status before continuing.';
  if (code === '42501') return 'These ratings are unavailable to your account. Refresh or sign in again.';
  return 'Unable to confirm the rating status. Check your connection and refresh before retrying; your rating may already have been saved.';
}
