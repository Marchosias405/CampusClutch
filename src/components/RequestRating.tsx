import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { loadRequestRating, ratingError, submitRequestRating, type RequestRatingContext } from '../lib/ratings';

type Props = { requestId: string; expectedRound: number; disabled?: boolean; onChanged?: () => Promise<void> };
type Scoped<T> = { scope: string; value: T };

export default function RequestRating({ requestId, expectedRound, disabled = false, onChanged }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const scope = `${userId}:${requestId}:${expectedRound}`;
  const [result, setResult] = useState<Scoped<RequestRatingContext | null> | null>(null);
  const [selection, setSelection] = useState<Scoped<number> | null>(null);
  const [failure, setFailure] = useState<Scoped<string> | null>(null);
  const [loadingScope, setLoadingScope] = useState('');
  const [savingScope, setSavingScope] = useState('');
  const active = useRef(false);
  const focusEpoch = useRef(0);
  const generation = useRef(0);
  const busy = useRef<number | null>(null);
  const mutation = useRef<{ scope: string; epoch: number } | null>(null);
  const current = useRef({ scope, disabled, onChanged });
  current.current = { scope, disabled, onChanged };

  const refresh = useCallback(async () => {
    if (!userId || busy.current !== null || mutation.current?.scope === scope || !active.current || current.current.scope !== scope) return;
    const ticket = ++generation.current;
    busy.current = ticket;
    setLoadingScope(scope);
    try {
      const value = await loadRequestRating(userId, requestId);
      if (active.current && current.current.scope === scope && ticket === generation.current) {
        setResult({ scope, value });
        setFailure(null);
      }
    } catch (error) {
      if (active.current && current.current.scope === scope && ticket === generation.current) setFailure({ scope, value: ratingError(error) });
    } finally {
      if (busy.current === ticket) busy.current = null;
      if (active.current && current.current.scope === scope && ticket === generation.current) setLoadingScope('');
    }
  }, [userId, requestId, scope]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    ++focusEpoch.current;
    void refresh();
    return () => { active.current = false; ++focusEpoch.current; ++generation.current; busy.current = null; };
  }, [refresh]));

  const visible = result?.scope === scope ? result.value : null;
  const loaded = result?.scope === scope;
  const error = failure?.scope === scope ? failure.value : '';
  const score = selection?.scope === scope ? selection.value : 0;
  const loading = loadingScope === scope;
  const saving = savingScope === scope;
  const roundMatches = visible?.offer_round === expectedRound;
  const ready = !!visible && roundMatches && !visible.my_score && !loading && !saving && !error && !disabled;

  const perform = async (chosenScore: number, epoch: number) => {
    if (!userId || !active.current || current.current.scope !== scope || current.current.disabled || focusEpoch.current !== epoch || busy.current !== null || mutation.current?.scope === scope) return;
    const operation = { scope, epoch };
    mutation.current = operation;
    setSavingScope(scope);
    let committed = false;
    try {
      await submitRequestRating(userId, requestId, expectedRound, chosenScore);
      committed = true;
    } catch (error) {
      if (active.current && current.current.scope === scope && focusEpoch.current === epoch) setFailure({ scope, value: ratingError(error) });
    } finally {
      if (mutation.current === operation) mutation.current = null;
      if (current.current.scope === scope) setSavingScope('');
      if (active.current && current.current.scope === scope) {
        // Always reconcile after a save attempt: a lost response may have followed a successful save.
        if (committed || focusEpoch.current !== epoch) await refresh();
        if (committed && active.current && current.current.scope === scope) await current.current.onChanged?.();
      }
    }
  };

  const confirm = () => {
    if (!ready || !score) return;
    const epoch = focusEpoch.current;
    const person = visible.counterparty_display_name || `this ${visible.counterparty_role}`;
    Alert.alert('Submit your rating?', `Give ${person} ${score} out of 5 stars? You cannot change your rating after saving. Both scores become visible only after you have both rated.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Submit rating', onPress: () => { void perform(score, epoch); } },
    ]);
  };

  if (!userId || (loaded && !visible && !error)) return null;
  return <View style={styles.section}>
    <Text style={styles.heading}>Reliability rating</Text>
    {loading && <ActivityIndicator color="#9B1C31" accessibilityLabel="Loading rating status" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible && <>
      <Text style={styles.text}>Rate your experience with {visible.counterparty_display_name || `the ${visible.counterparty_role}`} on this completed request.</Text>
      {!!visible.my_score ? <>
        <Text style={styles.label}>Your rating: {visible.my_score} out of 5 stars</Text>
        {visible.published && visible.received_score !== null
          ? <><Text style={styles.label}>Their rating of you: {visible.received_score} out of 5 stars</Text><Text style={styles.text}>Both ratings are published and included in your reliability scores.</Text></>
          : <Text style={styles.text}>Your rating is saved. Both scores stay private until the other person also rates.</Text>}
      </> : <>
        <Text style={styles.text}>Both scores stay private until you both submit. Your saved rating cannot be changed.</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} out of 5 stars`} accessibilityState={{ checked: score === value, disabled: !ready }} disabled={!ready} style={[styles.star, !ready && styles.disabled]} onPress={() => setSelection({ scope, value })}>
            <Ionicons name={value <= score ? 'star' : 'star-outline'} size={32} color="#9B1C31" />
          </Pressable>)}
        </View>
        <Text style={styles.label}>{score ? `Selected: ${score} out of 5 stars` : 'Choose 1 to 5 stars'}</Text>
        {!roundMatches && <Text accessibilityRole="alert" style={styles.error}>This request has changed. Reopen the request to load its latest details.</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || !score }} disabled={!ready || !score} style={[styles.primary, (!ready || !score) && styles.disabled]} onPress={confirm}>
          <Text style={styles.primaryText}>{saving ? 'Saving rating…' : 'Submit rating'}</Text>
        </Pressable>
      </>}
    </>}
    <Pressable accessibilityRole="button" disabled={loading || saving} style={[styles.secondary, (loading || saving) && styles.disabled]} onPress={() => { void refresh(); }}>
      <Text style={styles.secondaryText}>{error ? 'Retry rating status' : 'Refresh rating status'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 20, padding: 16, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 18 },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' },
  text: { fontSize: 15, lineHeight: 22, color: '#635C5C' }, label: { fontSize: 15, lineHeight: 22, color: '#2B2525', fontWeight: '700' },
  error: { color: '#9B1C31', lineHeight: 22 }, stars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  star: { minHeight: 48, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  primary: { minHeight: 48, padding: 14, borderRadius: 16, backgroundColor: '#9B1C31', alignItems: 'center' }, primaryText: { color: 'white', fontWeight: '800', fontSize: 16 },
  secondary: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' }, secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 }, disabled: { opacity: .45 },
});
