import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, Text, View } from 'react-native';
import { getAccountStanding } from '../lib/accountStanding';
import type { AccountStanding } from '../lib/accountStanding';
import { moderationAccessLost } from '../lib/moderation';
import { actionLabel, appealStatusLabel, listOwnActions } from '../lib/moderationAppeals';
import type { OwnAction, AppealCursor } from '../lib/moderationAppeals';
import AppealEditor from './AppealEditor';
import DetailsDisclosure from './DetailsDisclosure';
import { ModerationButton, moderationStyles as styles } from './ModerationShell';

export default function AccountAppeals({ userId, onClose, active = true }: { userId: string; onClose(): void; active?: boolean }) {
  const [rows, setRows] = useState<OwnAction[]>([]), [cursor, setCursor] = useState<AppealCursor>();
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), running = useRef(false);
  const load = useCallback(async (next?: AppealCursor, keepOlder = false) => {
    if (running.current) return;
    running.current = true; const ticket = ++sequence.current; setBusy(true); setError('');
    try {
      const [page, currentStanding] = await Promise.all([listOwnActions(userId, next), getAccountStanding(userId)]);
      if (ticket !== sequence.current) return;
      setStanding(currentStanding);
      setRows(old => Array.from(new Map((next ? [...old,...page] : keepOlder ? [...old,...page] : page).map(row => [row.id,row])).values())
        .sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)));
      setCursor(old => keepOlder && old ? old : page.length === 20 ? page[page.length-1] : undefined);
    } catch (failure) {
      if (ticket === sequence.current) {
        setStanding(null);
        if (moderationAccessLost(failure)) { setRows([]); setCursor(undefined); }
        setError('Couldn’t refresh decisions or warning count. Check your connection and retry.');
      }
    }
    finally { if (ticket === sequence.current) { running.current = false; setBusy(false); } }
  }, [userId]);
  const cancelLoad = useCallback(() => { ++sequence.current; running.current = false; }, []);
  useEffect(() => {
    if (!active) return;
    // Preserve loaded older cards and their editor state during background checks.
    const refreshWhileActive = () => { if (AppState.currentState === 'active') void load(undefined, true); };
    void load();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load(undefined, true); });
    const timer = setInterval(refreshWhileActive, 30_000);
    return () => { clearInterval(timer); subscription.remove(); cancelLoad(); };
  }, [active,load,cancelLoad]);
  const refresh = useCallback(() => { void load(); }, [load]);
  return <ScrollView contentContainerStyle={[styles.content, { paddingTop: 56 }]}>
    <ModerationButton title="Back" onPress={onClose} />
    <Text style={styles.heading}>Account decisions & appeals</Text>
    <Text style={styles.body}>See account decisions or ask for a review.</Text>
    {standing && <View style={styles.card} testID="current-warning-count" accessibilityLiveRegion="polite">
      <Text style={styles.subheading}>Current formal warnings: {standing.warning_count}</Text>
      <Text style={styles.body}>{standing.warning_count % 3}/3 warnings this cycle</Text>
      <Text style={styles.body}>Every third warning means a 7-day suspension.</Text>
      <DetailsDisclosure title="How warnings and appeals work">
        <Text style={styles.small}>Overturned warnings are excluded. Upheld warnings still count.</Text>
        <Text style={styles.small}>You can appeal each decision once, even during a suspension. It stays in effect during review. Response times vary.</Text>
      </DetailsDisclosure>
    </View>}
    <ModerationButton title="Refresh decisions" onPress={refresh} disabled={busy} />
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {rows.map(row => <View key={row.id} testID={`account-action-${row.id}`} style={styles.card}>
      <Text style={styles.subheading}>{actionLabel(row.kind)}</Text>
      {row.revoked_at && <Text style={styles.body}>Overturned</Text>}
      <Text style={styles.small}>{new Date(row.created_at).toLocaleString()}</Text>
      <Text style={styles.value}>{row.reason}</Text>
      {row.automatic_suspension && <Text style={styles.body}>This was the third warning in its cycle.</Text>}
      {row.appeal ? <View style={styles.notice}>
        <Text style={styles.subheading}>{appealStatusLabel(row.appeal.status)}</Text>
        <DetailsDisclosure title="Your appeal">
          <Text style={styles.value}>{row.appeal.explanation}</Text>
        </DetailsDisclosure>
        {!!row.appeal.decision_reason && <Text style={styles.value}>Admin response: {row.appeal.decision_reason}</Text>}
        {!!row.appeal.effect && <Text style={styles.body}>{row.appeal.effect}</Text>}
      </View> : !row.revoked_at && <AppealEditor userId={userId} targetId={row.id} kind="submit" onDone={refresh} onAccessLost={refresh} />}
    </View>)}
    {busy && <ActivityIndicator accessibilityLabel="Loading account decisions" color="#9B1C31" />}
    {!busy && !error && !rows.length && <Text style={styles.body}>No account decisions.</Text>}
    {!busy && cursor && <ModerationButton title="Load older decisions" onPress={() => { void load(cursor); }} />}
  </ScrollView>;
}
