import { useAuth } from '@/context/AuthContext';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { ModerationButton, ModerationFrame, ModerationGate, moderationStyles as styles } from '../../components/ModerationShell';
import HeldDeletionEvidence from '../../components/HeldDeletionEvidence';
import { decisionValidation, moderationAccessLost, moderationCode } from '../../lib/moderation';
import { changeHold, loadHolds, retentionTargets, validHoldDate } from '../../lib/retentionHolds';
import type { Hold, HoldChange, TargetKind } from '../../lib/retentionHolds';
import { isReportId } from '../../lib/safetyReports';

export default function RetentionScreen() {
  const { user } = useAuth();
  const { reportId } = useLocalSearchParams<{ reportId?: string }>();
  const initial = isReportId(reportId) ? reportId : '';
  return <ModerationFrame title="Retention holds">{user && <ModerationGate key={user.id} userId={user.id} adminOnly>
    {invalidate => <Records key={initial} user={user.id} initial={initial} invalidate={invalidate} />}
  </ModerationGate>}</ModerationFrame>;
}
function Records({ user, initial, invalidate }: { user: string; initial: string; invalidate(): void }) {
  const [kind, setKind] = useState<TargetKind>('case');
  const [id, setId] = useState(initial);
  const [opened, setOpened] = useState(initial);
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {opened ? <RecordHolds key={kind + opened} user={user} kind={kind} id={opened} invalidate={invalidate}
        close={() => setOpened('')} /> : <>
        <Text style={styles.body}>Choose the record to protect from scheduled expiry.</Text>
        <View style={styles.row}>{(Object.keys(retentionTargets) as TargetKind[]).map(k =>
          <ModerationButton key={k} title={retentionTargets[k]} primary={kind === k} onPress={() => setKind(k)} />)}</View>
        <Text style={styles.subheading}>Record ID</Text>
        <TextInput accessibilityLabel="Record ID" autoCapitalize="none" autoCorrect={false} value={id} onChangeText={setId}
          style={[styles.input, { minHeight: 48 }]} />
        <ModerationButton title="View holds" primary disabled={!isReportId(id.trim())} onPress={() => setOpened(id.trim().toLowerCase())} />
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
function RecordHolds({ user, kind, id, invalidate, close }: {
  user: string; kind: TargetKind; id: string; invalidate(): void; close(): void;
}) {
  const [rows, setRows] = useState<Hold[] | null>(null);
  const [form, setForm] = useState<Omit<HoldChange, 'reason' | 'through'> | null>(null);
  const [through, setThrough] = useState('');
  const invalidDate = Boolean(through) && !validHoldDate(through);
  const [reason, setReason] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const running = useRef(false);
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const next = await loadHolds(user, kind, id);
      if (alive.current) setRows(next);
    } catch (cause) {
      if (!alive.current) return;
      setRows(null);
      if (moderationAccessLost(cause)) invalidate();
      else setError(moderationCode(cause) === 'PT404' ? 'Record unavailable. Check the record ID.' : 'Couldn’t load hold history.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, [user, kind, id, invalidate]);
  useEffect(() => {
    alive.current = true; void refresh();
    return () => { alive.current = false; };
  }, [refresh]);
  function edit(next: Omit<HoldChange, 'reason' | 'through'> | null) {
    setForm(next); setReason(''); setThrough(''); setUncertain(false); setError(''); setFeedback('');
  }
  async function save() {
    if (!form || running.current || invalidDate || decisionValidation(reason)) return;
    running.current = true; setBusy(true); setError('');
    try {
      await changeHold(user, kind, id, { ...form, reason, through });
    } catch (cause) {
      if (!alive.current) return;
      running.current = false; setBusy(false);
      if (moderationAccessLost(cause)) { invalidate(); return; }
      const code = moderationCode(cause);
      if (code === 'PT409' || code === 'PT404') {
        edit(null); await refresh(); if (alive.current) setFeedback('The record changed. Check its latest history.');
      } else if (code === '22023') setError('Check the reason and try again.');
      else { setUncertain(true); setError('Couldn’t confirm the change. Retry to check the same action.'); }
      return;
    }
    if (!alive.current) return;
    running.current = false; edit(null); setRows(null);
    setFeedback(form.action === 'place' ? 'Hold placed.' : 'Hold released.');
    await refresh();
  }
  return <>
    <Text style={styles.heading}>{retentionTargets[kind]}</Text>
    <Text selectable style={styles.small}>{id}</Text>
    {feedback ? <Text accessibilityLiveRegion="polite" style={styles.body}>{feedback}</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    {busy && <Text accessibilityLiveRegion="polite" style={styles.body}>Updating hold history…</Text>}
    {rows && <>
      {rows.length === 0 && <Text style={styles.body}>No holds recorded.</Text>}
      {!busy && !form && rows.some(h => !h.released_at) &&
        <HeldDeletionEvidence user={user} kind={kind} id={id} invalidate={invalidate} />}
      {rows.map(h => <View key={h.id} style={styles.card}>
        <Text style={styles.subheading}>{h.released_at ? 'Released hold' : 'Active hold'}</Text>
        <Text style={styles.value}>{h.reason}</Text>
        {h.through_date && <Text style={styles.small}>Keep evidence through {h.through_date} (UTC).</Text>}
        <Text selectable style={styles.small}>Placed by {h.placed_by === user ? 'you' : h.placed_by} on {new Date(h.placed_at).toLocaleString()}</Text>
        {h.released_at && <>
          <Text style={styles.value}>{h.release_reason}</Text>
          <Text selectable style={styles.small}>Released by {h.released_by === user ? 'you' : h.released_by} on {new Date(h.released_at).toLocaleString()}</Text>
        </>}
        {!h.released_at && !form && <ModerationButton title="Release this hold" disabled={busy}
          onPress={() => edit({ action: 'release', holdId: h.id })} />}
        {form?.action === 'release' && form.holdId === h.id && <Text style={styles.small}>Selected for release</Text>}
      </View>)}
      {!form && <ModerationButton title="Place a hold" primary disabled={busy}
        onPress={() => edit({ action: 'place', holdId: globalThis.crypto.randomUUID() })} />}
    </>}
    {form ? <View style={styles.card}>
      <Text style={styles.subheading}>{form.action === 'place' ? 'Why is a hold needed?' : 'Why can this hold be released?'}</Text>
      {form.action === 'release' && <Text style={styles.body}>{rows?.find(h => h.id === form.holdId)?.reason}</Text>}
      <TextInput accessibilityLabel="Reason" multiline maxLength={2000} editable={!busy && !uncertain}
        style={styles.input} value={reason} onChangeText={setReason} placeholder="Reason (at least 10 characters)" />
      {form.action === 'place' && <>
        <Text style={styles.body}>For an open access request, keep a separate hold until the request is resolved.</Text>
        <Text style={styles.subheading}>Keep through date (optional, UTC)</Text>
        <TextInput accessibilityLabel="Keep through date" value={through} onChangeText={setThrough}
          placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} maxLength={10}
          editable={!busy && !uncertain} style={[styles.input, { minHeight: 48 }]} />
        {invalidDate && through.length === 10 && <Text style={styles.error}>Enter a valid date in YYYY-MM-DD format.</Text>}
      </>}
      <ModerationButton primary title={uncertain ? 'Retry same action' : form.action === 'place' ? 'Confirm hold' : 'Confirm release'}
        disabled={busy || invalidDate || Boolean(decisionValidation(reason))} onPress={() => { void save(); }} />
      <ModerationButton title={uncertain ? 'Check history' : 'Cancel'} disabled={busy}
        onPress={() => { edit(null); if (uncertain) void refresh(); }} />
    </View> : <>
      <ModerationButton title="Refresh history" disabled={busy} onPress={() => { void refresh(); }} />
      <ModerationButton title="Choose another record" disabled={busy} onPress={close} />
    </>}
  </>;
}
