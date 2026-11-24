import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ModerationButton, ModerationFrame, ModerationGate, moderationStyles as styles, targetLabel, triageLabel } from '../../components/ModerationShell';
import { listModerationReports, moderationAccessLost, TRIAGE_STATUSES } from '../../lib/moderation';
import type { ReportCursor, ReportSummary, TriageStatus } from '../../lib/moderation';
import { REPORT_REASONS } from '../../lib/safetyReports';

export default function ModerationQueueScreen() {
  const { user } = useAuth();
  return <ModerationFrame title="Report queue">{user && <ModerationGate key={user.id} userId={user.id}>
    {(invalidate, role) => <ReportQueue userId={user.id} invalidate={invalidate} canReviewAppeals={role === 'admin'} />}
  </ModerationGate>}</ModerationFrame>;
}
function ReportQueue({ userId, invalidate, canReviewAppeals }: { userId: string; invalidate(): void; canReviewAppeals: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<TriageStatus>('new');
  const [rows, setRows] = useState<ReportSummary[]>([]);
  const [cursor, setCursor] = useState<ReportCursor>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (next?: ReportCursor) => {
    const ticket = ++sequence.current;
    pending.current = true;
    setBusy(true); setError('');
    if (!next) { setRows([]); setCursor(undefined); }
    try {
      const page = await listModerationReports(userId, status, next);
      if (ticket !== sequence.current) return;
      setRows(previous => {
        const all = next ? [...previous, ...page] : page;
        return Array.from(new Map(all.map(row => [row.report_id, row])).values());
      });
      const last = page[page.length - 1];
      setCursor(page.length === 20 ? { created_at: last.created_at, report_id: last.report_id } : undefined);
    } catch (cause) {
      if (ticket !== sequence.current) return;
      setRows([]); setCursor(undefined);
      if (moderationAccessLost(cause)) invalidate();
      else setError('Unable to load reports. Check your connection and retry.');
    } finally { if (ticket === sequence.current) { pending.current = false; setBusy(false); } }
  }, [userId, status, invalidate]);
  const cancelLoad = useCallback(() => { ++sequence.current; }, []);
  useEffect(() => { void load(); return cancelLoad; }, [load, cancelLoad]);
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Reports to review</Text>
    {canReviewAppeals && <ModerationButton title="Review appeals" onPress={() => router.push('/moderation/appeals' as Href)} />}
    <Text style={styles.body}>Review submitted reports and record a reason for each status change. Reports involving your own account are excluded.</Text>
    <View style={styles.row}>{TRIAGE_STATUSES.map(value => <Pressable key={value} accessibilityRole="button"
      accessibilityState={{ selected: status === value }} style={[styles.button, status === value && styles.selected]}
      onPress={() => { if (value !== status) { ++sequence.current; setRows([]); setCursor(undefined); setStatus(value); } }}>
      <Text style={styles.buttonText}>{triageLabel(value)}</Text>
    </Pressable>)}</View>
    <ModerationButton title="Refresh reports" disabled={busy} onPress={() => { if (!pending.current) void load(); }} />
    {error ? <View style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
      <ModerationButton title="Retry reports" onPress={() => { if (!pending.current) void load(); }} /></View> : null}
    {rows.map(row => <Pressable key={row.report_id} accessibilityRole="button"
      accessibilityLabel={`Review ${targetLabel(row.target_type).toLowerCase()} report ${row.report_id.slice(0, 8)}`}
      style={styles.card} onPress={() => router.push(`/moderation/${row.report_id}` as Href)}>
      <Text style={styles.subheading}>{targetLabel(row.target_type)}</Text>
      <Text style={styles.body}>{REPORT_REASONS.find(reason => reason.value === row.reason)?.label}</Text>
      <Text style={styles.small}>{new Date(row.created_at).toLocaleString()}</Text>
      <Text style={styles.small}>#{row.report_id.slice(0, 8)}</Text>
      <Text style={styles.small}>Version {row.triage_version}</Text>
      <Text style={styles.buttonText}>Review report ›</Text>
    </Pressable>)}
    {busy ? <ActivityIndicator accessibilityLabel="Loading reports" color="#9B1C31" /> : null}
    {!busy && !error && !rows.length ? <Text style={styles.body}>No {status} reports available to your account.</Text> : null}
    {!busy && cursor ? <ModerationButton title="Load more reports" onPress={() => { if (!pending.current) void load(cursor); }} /> : null}
  </ScrollView>;
}
