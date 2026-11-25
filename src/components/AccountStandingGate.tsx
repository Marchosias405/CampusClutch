import { LoadingState, LoadingNotice } from '@/components/LoadingState';
import { DeleteAccountButton } from "@/context/AccountDeletionProvider";
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { acknowledgeAccountNotice, getAccountStanding } from '../lib/accountStanding';
import type { AccountStanding } from '../lib/accountStanding';
import { ModerationButton, moderationStyles as styles } from './ModerationShell';
import AccountAppeals from './AccountAppeals';

export default function AccountStandingGate({ children }: { children: React.ReactNode }) {
  const { user, isRestoringSession, isPasswordRecovery, signOut } = useAuth();
  if (!user || isRestoringSession || isPasswordRecovery) return <>{children}</>;
  return <SignedInStanding key={user.id} userId={user.id} signOut={signOut}>{children}</SignedInStanding>;
}
function SignedInStanding({ userId, signOut, children }: {
  userId: string; signOut(): Promise<unknown>; children: React.ReactNode;
}) {
  const [standing, setStanding] = useState<AccountStanding | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showAppeals, setShowAppeals] = useState(false);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true, running = false;
    const check = async () => {
      if (!active || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const value = await getAccountStanding(userId);
        if (active) { setStanding(value); setError(''); }
      } catch { if (active) setError('Unable to check your account status. Check your connection and retry.'); }
      finally { running = false; }
    };
    void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    const interval = setInterval(() => { void check(); }, 30000);
    return () => { active = false; clearInterval(interval); subscription.remove(); };
  }, [userId, revision]);
  // Warnings remain in the bell inbox. Only suspension or other account notices gate access.
  const notices = standing?.notices.filter(notice => standing.suspended || notice.kind !== 'warn') ?? [];
  if (showAppeals) return <View style={styles.screen}><AccountAppeals key={userId} userId={userId}
    onClose={() => { setShowAppeals(false); retry(); }} /></View>;
  if (!standing && !error) return <LoadingState title="Checking your account" fullScreen />;
  if (standing && !standing.suspended && !notices.length) return <>{children}</>;
  return <View style={styles.screen}><ScrollView contentContainerStyle={[styles.content, { paddingTop: 64 }]}>
    {!standing ? <Text style={styles.heading}>Unable to check your account</Text> : <>
      <Text style={styles.heading}>{standing.suspended ? 'Account temporarily suspended' : 'Account notice'}</Text>
      {standing.suspended && <Text style={styles.body}>Your Clu access resumes after {new Date(standing.suspended_until!).toLocaleString()}. Your points and request history are preserved.</Text>}
      <Text style={styles.body}>{standing.warning_count} formal warnings</Text>
      <Text style={styles.body}>{standing.warning_count % 3}/3 warnings this cycle</Text>
      <Text style={styles.body}>Every third warning results in a 7-day suspension.</Text>
      {notices.map(notice => <View key={notice.id} style={styles.notice}>
        <Text style={styles.subheading}>{notice.kind === 'warn' ? 'Formal warning' : notice.kind === 'remove_review' ? 'Course review removed' : notice.kind === 'remove_request' ? 'Request removed' : '7-day suspension'}</Text>
        <Text style={styles.small}>{new Date(notice.created_at).toLocaleString()}</Text>
        <Text style={styles.value}>{notice.reason}</Text>
        {notice.automatic_suspension && <Text style={styles.body}>The third warning started a 7-day suspension.</Text>}
      </View>)}
      {!standing.suspended && notices.length > 0 && <ModerationButton title="Acknowledge and continue" primary disabled={busy} onPress={() => {
        const latest = notices.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at;
        setBusy(true);
        void acknowledgeAccountNotice(userId, latest).then(retry).catch(() => setError('Unable to acknowledge this notice. Please retry.')).finally(() => setBusy(false));
      }} />}
    </>}
    {busy && <LoadingNotice label="Saving acknowledgement" />}
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    <ModerationButton title="Check again" onPress={retry} disabled={busy} />
    <ModerationButton title="Account decisions & appeals" onPress={() => setShowAppeals(true)} disabled={busy} />
    <DeleteAccountButton />
    <ModerationButton title="Sign out" onPress={() => { void signOut().then(result => { if (result) setError('Unable to sign out. Please retry.'); }).catch(() => setError('Unable to sign out. Please retry.')); }} disabled={busy} />
  </ScrollView></View>;
}
