import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { loadRequestRatingPage, ratingError, submitRequestRating, type AssignmentRatingContext } from '../lib/ratings';

type Props = { requestId: string; requestRevision?: string; disabled?: boolean; onChanged?: () => Promise<void> };
type RatingHistory = { scope: string; items: AssignmentRatingContext[]; hasMore: boolean; offset: number };
type Scoped<T> = { scope: string; value: T };

export default function RequestRating({ requestId, requestRevision = '', disabled = false, onChanged }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const scope = `${userId}:${requestId}`;
  const loadScope = `${scope}:${requestRevision}`;
  const [history, setHistory] = useState<RatingHistory | null>(null);
  const [selections, setSelections] = useState<Scoped<Record<number, number>> | null>(null);
  const [failure, setFailure] = useState<Scoped<string> | null>(null);
  const [saveFailure, setSaveFailure] = useState<Scoped<{ round: number; message: string }> | null>(null);
  const [loadingScope, setLoadingScope] = useState('');
  const [savingScope, setSavingScope] = useState('');
  const active = useRef(false);
  const focusEpoch = useRef(0);
  const generation = useRef(0);
  const busy = useRef<number | null>(null);
  const mutation = useRef<{ scope: string; epoch: number } | null>(null);
  const current = useRef({ scope, loadScope, disabled, onChanged, history });
  current.current = { scope, loadScope, disabled, onChanged, history };

  const refresh = useCallback(async (append = false): Promise<AssignmentRatingContext[] | null> => {
    if (!userId || busy.current !== null || mutation.current?.scope === scope || !active.current || current.current.loadScope !== loadScope) return null;
    const ticket = ++generation.current;
    const previous = current.current.history?.scope === scope ? current.current.history : null;
    busy.current = ticket;
    setLoadingScope(scope);
    try {
      // Keep older assignments visible on refresh, including any unsaved score selections.
      let offset = append ? previous?.offset ?? 0 : 0;
      const target = append ? offset + 20 : Math.max(previous?.offset ?? 0, 20);
      let items = append ? previous?.items ?? [] : [];
      let hasMore = false;
      do {
        const page = await loadRequestRatingPage(userId, requestId, offset);
        if (!active.current || current.current.loadScope !== loadScope || ticket !== generation.current) return null;
        const unique = new Map(items.map(item => [item.offer_round, item]));
        page.items.forEach(item => unique.set(item.offer_round, item));
        items = [...unique.values()].sort((a, b) => b.offer_round - a.offer_round);
        offset = page.nextOffset;
        hasMore = page.hasMore;
      } while (hasMore && offset < target);
      setHistory({ scope, items, hasMore, offset });
      setFailure(null);
      return items;
    } catch (error) {
      if (active.current && current.current.loadScope === loadScope && ticket === generation.current) setFailure({ scope, value: ratingError(error) });
      return null;
    } finally {
      if (busy.current === ticket) busy.current = null;
      if (active.current && current.current.loadScope === loadScope && ticket === generation.current) setLoadingScope('');
    }
  }, [userId, requestId, scope, loadScope]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;

  useFocusEffect(useCallback(() => {
    active.current = true;
    ++focusEpoch.current;
    void refresh();
    return () => { active.current = false; ++focusEpoch.current; ++generation.current; busy.current = null; };
  }, [refresh]));

  const visible = history?.scope === scope ? history : null;
  const error = failure?.scope === scope ? failure.value : '';
  const scores = selections?.scope === scope ? selections.value : {};
  const loading = loadingScope === scope;
  const saving = savingScope === scope;
  const ready = !!visible && !loading && !saving && !error && !disabled;

  const perform = async (context: AssignmentRatingContext, chosenScore: number, epoch: number) => {
    const latest = current.current;
    const latestContext = latest.history?.scope === scope
      ? latest.history.items.find(item => item.offer_round === context.offer_round && item.counterparty_id === context.counterparty_id)
      : null;
    if (!userId || !active.current || latest.scope !== scope || latest.disabled || focusEpoch.current !== epoch
      || busy.current !== null || mutation.current?.scope === scope || !latestContext || latestContext.my_score !== null) return;
    const operation = { scope, epoch };
    mutation.current = operation;
    setSavingScope(scope);
    setSaveFailure(null);
    let committed = false;
    try {
      await submitRequestRating(userId, requestId, context.offer_round, chosenScore);
      committed = true;
    } catch (error) {
      if (active.current && current.current.scope === scope && focusEpoch.current === epoch) {
        setSaveFailure({ scope, value: { round: context.offer_round, message: ratingError(error) } });
      }
    } finally {
      if (mutation.current === operation) mutation.current = null;
      if (current.current.scope === scope) setSavingScope('');
      if (active.current && current.current.scope === scope) {
        // A lost response can follow a successful save. Reconcile without losing an unsaved selection.
        const reconciled = await latestRefresh.current();
        const saved = reconciled?.some(item => item.offer_round === context.offer_round && item.my_score !== null);
        if (saved) setSaveFailure(null);
        if ((committed || saved) && active.current && current.current.scope === scope) await current.current.onChanged?.();
      }
    }
  };

  const confirm = (context: AssignmentRatingContext) => {
    const score = scores[context.offer_round];
    if (!ready || !score || context.my_score !== null) return;
    const epoch = focusEpoch.current;
    const person = context.counterparty_display_name || `this ${context.counterparty_role}`;
    Alert.alert('Submit your rating?', `Give ${person} ${score} out of 5 stars for the ${context.outcome} assignment (round ${context.offer_round})? You cannot change your rating after saving. Both scores become visible only after you have both rated this assignment.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Submit rating', onPress: () => { void perform(context, score, epoch); } },
    ]);
  };

  if (!userId || (visible && !visible.items.length && !error)) return null;
  return <View style={styles.section}>
    <Text style={styles.heading}>Reliability ratings</Text>
    {loading && <ActivityIndicator color="#9B1C31" accessibilityLabel="Loading rating history" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible?.items.map(context => {
      const score = scores[context.offer_round] ?? 0;
      const canRate = ready && context.my_score === null;
      const actionError = saveFailure?.scope === scope && saveFailure.value.round === context.offer_round ? saveFailure.value.message : '';
      return <View key={`${userId}:${requestId}:${context.offer_round}:${context.counterparty_id}`} style={styles.assignment}>
        <Text style={styles.label}>{context.outcome === 'cancelled' ? 'Cancelled assignment' : 'Completed assignment'} · Round {context.offer_round}</Text>
        <Text style={styles.text}>Your experience with {context.counterparty_display_name || `the ${context.counterparty_role}`}.</Text>
        {context.outcome === 'cancelled' && <Text style={styles.text}>This accepted assignment ended without completion. You can still rate each other, even if the request has reopened or another helper is selected.</Text>}
        {!!actionError && <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
        {context.my_score !== null ? <>
          <Text style={styles.label}>Your rating: {context.my_score} out of 5 stars</Text>
          {context.published && context.received_score !== null
            ? <><Text style={styles.label}>Their rating of you: {context.received_score} out of 5 stars</Text><Text style={styles.text}>Both ratings are published and included in your reliability scores.</Text></>
            : <Text style={styles.text}>Your rating is saved. Both scores stay private until the other person also rates this assignment.</Text>}
        </> : <>
          <Text style={styles.text}>Both scores stay private until you both submit. Your saved rating cannot be changed.</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`Round ${context.offer_round}: ${value} out of 5 stars`} accessibilityState={{ checked: score === value, disabled: !canRate }} disabled={!canRate} style={[styles.star, !canRate && styles.disabled]} onPress={() => setSelections(previous => ({ scope, value: { ...(previous?.scope === scope ? previous.value : {}), [context.offer_round]: value } }))}>
              <Ionicons name={value <= score ? 'star' : 'star-outline'} size={32} color="#9B1C31" />
            </Pressable>)}
          </View>
          <Text style={styles.label}>{score ? `Selected: ${score} out of 5 stars` : 'Choose 1 to 5 stars'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Submit rating for round ${context.offer_round}`} accessibilityState={{ disabled: !canRate || !score }} disabled={!canRate || !score} style={[styles.primary, (!canRate || !score) && styles.disabled]} onPress={() => confirm(context)}>
            <Text style={styles.primaryText}>{saving ? 'Saving rating…' : 'Submit rating'}</Text>
          </Pressable>
        </>}
      </View>;
    })}
    <Pressable accessibilityRole="button" disabled={loading || saving} style={[styles.secondary, (loading || saving) && styles.disabled]} onPress={() => { void refresh(); }}>
      <Text style={styles.secondaryText}>{error ? 'Retry rating history' : 'Refresh rating history'}</Text>
    </Pressable>
    {visible?.hasMore && <Pressable accessibilityRole="button" disabled={loading || saving || !!error} style={[styles.secondary, (loading || saving || !!error) && styles.disabled]} onPress={() => { void refresh(true); }}>
      <Text style={styles.secondaryText}>Load older assignments</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 20, padding: 16, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 18 },
  assignment: { gap: 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#ECE3E3' },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' },
  text: { fontSize: 15, lineHeight: 22, color: '#635C5C' }, label: { fontSize: 15, lineHeight: 22, color: '#2B2525', fontWeight: '700' },
  error: { color: '#9B1C31', lineHeight: 22 }, stars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  star: { minHeight: 48, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  primary: { minHeight: 48, padding: 14, borderRadius: 16, backgroundColor: '#9B1C31', alignItems: 'center' }, primaryText: { color: 'white', fontWeight: '800', fontSize: 16 },
  secondary: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' }, secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 }, disabled: { opacity: .45 },
});
