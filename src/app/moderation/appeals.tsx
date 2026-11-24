import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { actionLabel, appealStatusLabel, getAppeal, listAppeals } from '../../lib/moderationAppeals';
import type { AppealCursor, AppealDetail, AppealStatus, AppealSummary } from '../../lib/moderationAppeals';
import { moderationAccessLost } from '../../lib/moderation';
import AppealEditor from '../../components/AppealEditor';
import { ModerationButton, ModerationFrame, ModerationGate, moderationStyles as styles } from '../../components/ModerationShell';

export default function AppealQueueScreen() {
  const { user } = useAuth();
  return <ModerationFrame title="Review appeals">{user && <ModerationGate key={user.id} userId={user.id} adminOnly>
    {invalidate => <AppealQueue userId={user.id} invalidate={invalidate} />}
  </ModerationGate>}</ModerationFrame>;
}
function AppealQueue({ userId, invalidate }: { userId: string; invalidate(): void }) {
  const router = useRouter();
  const [rows,setRows] = useState<AppealSummary[]>([]), [filter,setFilter] = useState<AppealStatus>('pending');
  const [cursor,setCursor] = useState<AppealCursor>(), [detail,setDetail] = useState<AppealDetail>();
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const sequence = useRef(0), running = useRef(false);
  const load = useCallback(async (next?: AppealCursor, id?: string) => {
    if (running.current) return;
    running.current = true; const ticket = ++sequence.current; setBusy(true); setError('');
    if (!next) { setRows([]); setCursor(undefined); setDetail(undefined); }
    try {
      const data = id ? await getAppeal(userId,id) : await listAppeals(userId,filter,next);
      if (ticket !== sequence.current) return;
      if (Array.isArray(data)) {
        setRows(old => Array.from(new Map((next ? [...old,...data] : data).map(row => [row.id,row])).values()));
        setCursor(data.length === 20 ? data[data.length-1] : undefined);
      } else setDetail(data);
    } catch (cause) {
      if (ticket !== sequence.current) return;
      setRows([]); setDetail(undefined); setCursor(undefined);
      if (moderationAccessLost(cause)) setError('Appeals are available only to eligible admin accounts.');
      else setError('Unable to load appeals. Check your connection and retry.');
    } finally { if (ticket === sequence.current) { running.current = false; setBusy(false); } }
  }, [userId,filter]);
  const cancelLoad = useCallback(() => { ++sequence.current; running.current = false; }, []);
  useEffect(() => { void load(); return cancelLoad; }, [load,cancelLoad]);
  const refresh = useCallback(() => { void load(undefined,detail?.id); },[load,detail?.id]);
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>{detail ? actionLabel(detail.kind) : 'Student appeals'}</Text>
    <Text style={styles.body}>Any assigned admin may review an appeal, including its original issuer. Decisions and evidence access are recorded. Reports involving your own account remain excluded.</Text>
    {detail ? <>
      <ModerationButton title="Back to appeals" onPress={() => { void load(); }} disabled={busy} />
      <Text style={styles.subheading}>{appealStatusLabel(detail.status)}</Text>
      <Text style={styles.small}>Original action: {new Date(detail.action_created_at).toLocaleString()}</Text>
      {detail.original_admin && <Text style={styles.small}>Issued by you</Text>}
      <Text style={styles.value}>{detail.action_reason}</Text>
      <Text style={styles.subheading}>Student explanation</Text>
      <Text style={styles.value}>{detail.explanation}</Text>
      <ModerationButton title="View original report and evidence" onPress={() => router.push(`/moderation/${detail.report_id}` as any)} />
      {detail.status === 'pending' ? <AppealEditor key={detail.id} userId={userId} targetId={detail.id} kind="resolve"
        expectedVersion={detail.version} onDone={refresh} onAccessLost={invalidate} /> : <>
        <Text style={styles.subheading}>Admin response</Text><Text style={styles.value}>{detail.decision_reason}</Text>
        <Text style={styles.body}>{detail.effect}</Text>
      </>}
    </> : <>
      <View style={styles.row}>{(['pending','upheld','overturned'] as const).map(value => <ModerationButton key={value}
        title={value === 'pending' ? 'Pending' : value === 'upheld' ? 'Upheld' : 'Overturned'} primary={filter === value} disabled={busy}
        onPress={() => setFilter(value)} />)}</View>
      {rows.map(row => <View key={row.id} style={styles.card}>
        <Text style={styles.subheading}>{actionLabel(row.kind)}</Text><Text style={styles.small}>{new Date(row.created_at).toLocaleString()}</Text>
        <ModerationButton title={`Review appeal ${row.id.slice(0,8)}`} disabled={busy} onPress={() => { void load(undefined,row.id); }} />
      </View>)}
      {!busy && !error && !rows.length && <Text style={styles.body}>No {filter} appeals available to your account.</Text>}
      {cursor && <ModerationButton title="Load older appeals" disabled={busy} onPress={() => { void load(cursor); }} />}
    </>}
    {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {busy && <ActivityIndicator color="#9B1C31" />}
    <ModerationButton title="Refresh appeals" onPress={refresh} disabled={busy} />
  </ScrollView>;
}
