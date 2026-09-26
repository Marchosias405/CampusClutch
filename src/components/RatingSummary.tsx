import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { loadProfileRatingSummary, type ProfileRatingSummary } from '../lib/ratings';

type Props = { profileId: string; requestId?: string };

export default function RatingSummary({ profileId, requestId }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const scope = `${userId}:${profileId}:${requestId ?? 'profile'}`;
  const [result, setResult] = useState<{ scope: string; value: ProfileRatingSummary } | null>(null);
  const [errorScope, setErrorScope] = useState('');
  const [loadingScope, setLoadingScope] = useState('');
  const active = useRef(false);
  const generation = useRef(0);
  const busy = useRef<number | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const refresh = useCallback(async () => {
    if (!userId || busy.current !== null || !active.current || currentScope.current !== scope) return;
    const ticket = ++generation.current;
    busy.current = ticket;
    setLoadingScope(scope);
    try {
      const value = await loadProfileRatingSummary(userId, profileId, requestId);
      if (active.current && currentScope.current === scope && ticket === generation.current) {
        setResult({ scope, value }); setErrorScope('');
      }
    } catch {
      if (active.current && currentScope.current === scope && ticket === generation.current) setErrorScope(scope);
    } finally {
      if (busy.current === ticket) busy.current = null;
      if (active.current && currentScope.current === scope && ticket === generation.current) setLoadingScope('');
    }
  }, [userId, profileId, requestId, scope]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    void refresh();
    return () => { active.current = false; ++generation.current; busy.current = null; };
  }, [refresh]));

  if (!userId) return null;
  const visible = result?.scope === scope ? result.value : null;
  const error = errorScope === scope;
  const loading = loadingScope === scope;
  return <View style={styles.section}>
    <Text style={styles.heading}>Reliability</Text>
    {loading && <ActivityIndicator color="#9B1C31" accessibilityLabel="Loading reliability rating" />}
    {error ? <>
      <Text accessibilityRole="alert" style={styles.text}>Unable to load the reliability rating. Check your connection and try again.</Text>
      <Pressable accessibilityRole="button" disabled={loading} style={styles.retry} onPress={() => { void refresh(); }}><Text style={styles.retryText}>Retry rating</Text></Pressable>
    </> : visible && <>
      {visible.rating_count > 0 && visible.average_score !== null ? <View style={styles.scoreRow}>
        <Ionicons name="star" size={20} color="#9B1C31" />
        <Text style={styles.score}>{Number(visible.average_score).toFixed(1)} / 5 · {visible.rating_count} {visible.rating_count === 1 ? 'rating' : 'ratings'}</Text>
      </View> : <Text style={styles.text}>No published ratings yet.</Text>}
      <Text style={styles.text}>Only completed requests where both people rated count toward this score.</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8, paddingVertical: 12 }, heading: { fontSize: 16, fontWeight: '800', color: '#2B2525' },
  text: { fontSize: 14, lineHeight: 20, color: '#635C5C' }, scoreRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  score: { fontSize: 15, fontWeight: '700', lineHeight: 22, color: '#2B2525', flexShrink: 1 },
  retry: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' }, retryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 },
});
