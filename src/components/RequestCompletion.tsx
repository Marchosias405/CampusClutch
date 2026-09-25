import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestsContext';
import { completeRequest, loadRequestReservation, pointsError, type RequestReservation } from '../lib/points';
import type { CampusRequest } from '../types';

type Props = { request: CampusRequest; onChanged: () => Promise<void> };

export default function RequestCompletion({ request, onChanged }: Props) {
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
  const busy = useRef(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const current = useRef({ scope, onChanged });
  current.current = { scope, onChanged };

  const refresh = useCallback(async () => {
    if (!userId || busy.current || mutation.current) return;
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
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { active.current = false; busy.current = false; ++generation.current; clearInterval(timer); };
  }, [refresh]));

  const owner = request.ownerId === userId;
  const visible = loadedScope === scope ? reservation : null;
  const ready = loadedScope === scope && !loading && !saving && !error;

  const perform = async () => {
    if (!userId || !owner || !active.current || current.current.scope !== scope || mutation.current || busy.current) return;
    mutation.current = true; setSaving(true); setError('');
    let committed = false;
    try {
      await completeRequest(userId, request.id, round);
      committed = true; invalidate();
    } catch (failure) {
      if (active.current && current.current.scope === scope) setError(pointsError(failure));
    } finally {
      mutation.current = false;
      if (active.current && current.current.scope === scope) {
        setSaving(false);
        if (committed) { await refresh(); await current.current.onChanged(); }
      }
    }
  };

  const confirm = () => {
    if (!ready || !owner || visible?.status !== 'reserved' || request.status !== 'accepted') return;
    Alert.alert('Confirm work completed?',
      `Confirm only after the helper has finished. This transfers ${visible.amount} reserved points to the helper and completes the request. You cannot reopen it afterward.`, [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Confirm and transfer', onPress: () => { void perform(); } },
      ]);
  };

  return <View style={styles.section}>
    <Text style={styles.heading}>Completion and points</Text>
    {loading && <ActivityIndicator color="#9B1C31" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible?.status === 'reserved' && <Text style={styles.text}>
      {visible.amount} points are reserved from the poster’s balance. {owner ? 'Confirm completion when the work is done to pay your helper.' : 'The poster must confirm completion before these points are added to your balance.'}
    </Text>}
    {visible?.status === 'settled' && <Text accessibilityRole="alert" style={styles.text}>Completed. {visible.amount} points were transferred to the helper. Check Profile for your updated balance.</Text>}
    {ready && !visible && request.status === 'accepted' && <Text style={styles.text}>
      {owner ? 'This request was accepted before points were enabled. Reopen it and accept a fresh offer to reserve points before completion.' : 'Points have not been reserved for this request. The poster needs to reopen it before you offer again.'}
    </Text>}
    {owner && request.status === 'accepted' && visible?.status === 'reserved' && <Pressable accessibilityRole="button" disabled={!ready} style={[styles.primary, !ready && styles.disabled]} onPress={confirm}>
      <Text style={styles.primaryText}>{saving ? 'Confirming…' : 'Confirm completion'}</Text>
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
