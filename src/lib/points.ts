import { supabase } from './supabase';
import { assertOfferSession } from './offers';

export type PointsEntry = { id: string; kind: 'starter_grant' | 'request_sent' | 'request_received'; amount: number; created_at: string; request_id: string | null };
export type PointsWallet = { balance: number; reserved: number; available: number; history: PointsEntry[] };
export type RequestReservation = { request_id: string; offer_round: number; poster_id: string; helper_id: string; amount: number; status: 'reserved' | 'released' | 'settled' };

export async function readWallet(userId: string): Promise<PointsWallet> {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.rpc('get_my_points').setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  return data as PointsWallet;
}

export async function loadRequestReservation(userId: string, requestId: string, expectedRound: number): Promise<RequestReservation | null> {
  const session = await assertOfferSession(userId);
  const { data, error } = await supabase.from('request_point_reservations')
    .select('request_id,offer_round,poster_id,helper_id,amount,status')
    .eq('request_id', requestId).eq('offer_round', expectedRound).maybeSingle()
    .setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
  return data as RequestReservation | null;
}

export async function completeRequest(userId: string, requestId: string, expectedRound: number): Promise<void> {
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('complete_my_request', {
    p_request_id: requestId, p_expected_round: expectedRound,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export async function cancelAcceptedHelp(userId: string, requestId: string, expectedRound: number): Promise<void> {
  const session = await assertOfferSession(userId);
  const { error } = await supabase.rpc('cancel_my_accepted_help', {
    p_request_id: requestId, p_expected_round: expectedRound,
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw error;
  await assertOfferSession(userId);
}

export function pointsError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'P0002') return 'Not enough available points. Check your balance and reserved points in Profile.';
  if (code === 'P0003') return 'This request has no reserved points. Reopen it and accept a fresh offer before confirming completion.';
  if (code === '22023') return 'This request has changed. Refresh before continuing.';
  if (code === '42501') return 'This action is unavailable to your account. Refresh or sign in again.';
  return 'Unable to confirm your points or assignment status. Check your connection and refresh before retrying; the action may already have saved.';
}
