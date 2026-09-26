import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestsContext';
import { cancelAcceptedHelp, completeRequest, loadRequestReservation, pointsError, type RequestReservation } from '../lib/points';
import type { CampusRequest } from '../types';

type Props = { request: CampusRequest; disabled?: boolean; onChanged: () => Promise<void> };

export default function RequestCompletion({ request, disabled = false, onChanged }: Props) {
  const { user } = useAuth();
  const { invalidate } = useRequests();
  const userId = user?.id;
  const round = request.offerRound ?? 1;
  const scope = `${userId}:${request.id}:${round}:${request.status}`;
  const [reservation, setReservation] = useState<RequestReservation | null>(null);
  const [loadedScope, setLoadedScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const focusEpoch = useRef(0);
  const busy = useRef(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const current = useRef({ scope, disabled, onChanged });
  current.current = { scope, disabled, onChanged };

  const refresh = useCallback(async () => {
    if (!userId || !active.current || current.current.scope !== scope || busy.current || mutation.current) return;
    const ticket = ++generation.current;
    busy.current = true; setLoading(true);
    try {
      const result = await loadRequestReservation(userId, request.id, round);
      if (active.current && current.current.scope === scope && ticket === generation.current) {
        setReservation(result); setLoadedScope(scope); setError('');
      }
    } catch (failure) {
      if (active.current && current.current.scope === scope && ticket === generation.current) setError(pointsError(failure));
    } finally {
      if (ticket === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [userId, request.id, round, scope]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    ++focusEpoch.current;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { active.current = false; ++focusEpoch.current; busy.current = false; ++generation.current; clearInterval(timer); };
  }, [refresh]));

  const owner = request.ownerId === userId;
  const visible = loadedScope === scope ? reservation : null;
  const helper = visible?.helper_id === userId;
  const ready = loadedScope === scope && !loading && !saving && !error && !disabled;

  const perform = async (action: 'complete' | 'cancel', epoch: number) => {
    if (!userId || (action === 'complete' ? !owner : !helper) || !active.current || focusEpoch.current !== epoch
      || current.current.scope !== scope || current.current.disabled || mutation.current || busy.current
      || visible?.status !== 'reserved' || request.status !== 'accepted') return;
    mutation.current = true; setSaving(true); setError('');
    let committed = false;
    try {
      if (action === 'complete') await completeRequest(userId, request.id, round);
      else await cancelAcceptedHelp(userId, request.id, round);
      committed = true; invalidate();
    } catch (failure) {
      if (active.current && current.current.scope === scope && focusEpoch.current === epoch) setError(pointsError(failure));
    } finally {
      mutation.current = false;
      if (current.current.scope === scope) setSaving(false);
      if (active.current && current.current.scope === scope) {
        if (committed || focusEpoch.current !== epoch) {
          await refresh();
          if (active.current && current.current.scope === scope) await current.current.onChanged();
        }
      }
    }
  };

  const confirm = () => {
    if (!ready || !owner || visible?.status !== 'reserved' || request.status !== 'accepted') return;
    const epoch = focusEpoch.current;
    Alert.alert('Confirm work completed?',
      `Confirm only after the helper has finished. This transfers ${visible.amount} reserved points to the helper and completes the request. You cannot reopen it afterward.`, [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Confirm and transfer', onPress: () => { void perform('complete', epoch); } },
      ]);
  };

  const confirmCancellation = () => {
    if (!ready || !helper || visible?.status !== 'reserved' || request.status !== 'accepted') return;
    const epoch = focusEpoch.current;
    Alert.alert('Cancel your accepted help?',
      `This ends your assignment. You will not receive the ${visible.amount} points; they return to the poster’s available balance. The request reopens for fresh offers unless its deadline has passed, when it becomes expired. You and the poster can still rate this cancelled assignment.`, [
        { text: 'Keep helping', style: 'cancel' },
        { text: 'Cancel my help', style: 'destructive', onPress: () => { void perform('cancel', epoch); } },
      ]);
  };

  // A former helper can read the request to rate an earlier assignment without joining the current one.
  if (!owner && loadedScope === scope && !loading && !error && !visible) return null;

  return <View style={styles.section}>
    <Text style={styles.heading}>Completion and points</Text>
    {loading && <ActivityIndicator color="#9B1C31" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible?.status === 'reserved' && <Text style={styles.text}>
      {visible.amount} points are reserved from the poster’s balance. {owner ? 'Confirm completion when the work is done to pay your helper.' : 'The poster must confirm completion before these points are added to your balance.'}
    </Text>}
    {visible?.status === 'settled' && <Text accessibilityRole="alert" style={styles.text}>Completed. {visible.amount} points were transferred to the helper. Check Profile for your updated balance.</Text>}
    {visible?.status === 'released' && <Text accessibilityRole="alert" style={styles.text}>This assignment was cancelled. Its reserved points were released without payment. Refresh the request to see its current status and rate the cancelled assignment.</Text>}
    {ready && !visible && request.status === 'accepted' && <Text style={styles.text}>
      {owner ? 'This request was accepted before points were enabled. Reopen it and accept a fresh offer to reserve points before completion.' : 'Points have not been reserved for this request. The poster needs to reopen it before you offer again.'}
    </Text>}
    {owner && request.status === 'accepted' && visible?.status === 'reserved' && <Pressable accessibilityRole="button" disabled={!ready} style={[styles.primary, !ready && styles.disabled]} onPress={confirm}>
      <Text style={styles.primaryText}>{saving ? 'Confirming…' : 'Confirm completion'}</Text>
    </Pressable>}
    {helper && request.status === 'accepted' && visible?.status === 'reserved' && <Pressable accessibilityRole="button" disabled={!ready} style={[styles.secondary, !ready && styles.disabled]} onPress={confirmCancellation}>
      <Text style={styles.secondaryText}>{saving ? 'Cancelling…' : 'Cancel my accepted help'}</Text>
    </Pressable>}
    <Pressable accessibilityRole="button" disabled={loading || saving} style={styles.secondary} onPress={() => { void refresh().then(() => { if (active.current && current.current.scope === scope) void current.current.onChanged(); }); }}>
      <Text style={styles.secondaryText}>Refresh completion status</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 20, padding: 16, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 18 },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' }, text: { fontSize: 15, lineHeight: 22, color: '#635C5C' },
  error: { color: '#9B1C31', lineHeight: 22 }, primary: { minHeight: 48, padding: 14, borderRadius: 16, backgroundColor: '#9B1C31', alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '800', fontSize: 16 }, secondary: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' },
  secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 }, disabled: { opacity: .45 },
});
