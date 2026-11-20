import { useAuth } from '@/context/AuthContext';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ModerationButton, ModerationFrame, ModerationGate, moderationStyles as styles, targetLabel, triageLabel } from '../../components/ModerationShell';
import { decisionValidation, getModerationReport, moderationAccessLost, TRIAGE_STATUSES } from '../../lib/moderation';
import type { ModerationReport, TriageStatus } from '../../lib/moderation';
import { createModerationDecision } from '../../lib/moderationDecision';
import type { DecisionState } from '../../lib/moderationDecision';
import { isReportId, REPORT_REASONS } from '../../lib/safetyReports';
import ModerationActions from '../../components/ModerationActions';

export default function ModerationReportScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [revision, setRevision] = useState(0);
  return <ModerationFrame title="Review report">{user && typeof id === 'string' && isReportId(id)
    ? <ModerationGate key={`${user.id}:${id}`} userId={user.id}>{invalidate =>
      <ReportDetail key={`${user.id}:${id}:${revision}`} userId={user.id} reportId={id} invalidate={invalidate}
        reload={() => setRevision(value => value + 1)} />}</ModerationGate>
    : <View style={styles.center}><Text style={styles.body}>This report link is unavailable.</Text></View>}
  </ModerationFrame>;
}
function ReportDetail({ userId, reportId, invalidate, reload }: { userId: string; reportId: string; invalidate(): void; reload(): void }) {
  const [model, setModel] = useState<ReturnType<typeof createModerationDecision> | null>(null);
  const [decision, setDecision] = useState<DecisionState>({ ready: false, busy: false, pending: null,
    receipt: null, conflict: false, accessLost: false, error: '' });
  const [report, setReport] = useState<ModerationReport | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<TriageStatus>('reviewing');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [actionFrozen, setActionFrozen] = useState(true);
  useEffect(() => {
    let active = true;
    // Each effect setup owns its model, including React's development remount.
    // A disposed model must never be reused by the next setup.
    const next = createModerationDecision(userId, reportId);
    setModel(next); setDecision(next.getState());
    const unsubscribe = next.subscribe(() => { if (active) setDecision(next.getState()); });
    void next.restore();
    void getModerationReport(userId, reportId).then(value => {
      if (!active) return;
      setReport(value); setStatus(value.triage_status === 'reviewing' ? 'escalated' : 'reviewing');
    }).catch(cause => {
      if (!active) return;
      setReport(null);
      if (moderationAccessLost(cause)) invalidate();
      else setError('Unable to load this report. Check your connection and retry.');
    });
    return () => { active = false; unsubscribe(); next.dispose(); };
  }, [userId, reportId, invalidate]);
  useEffect(() => { if (decision.accessLost) invalidate(); }, [decision.accessLost, invalidate]);
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text><ModerationButton title="Reload report" onPress={reload} /></View>;
  if (!report || !model) return <View style={styles.center}><ActivityIndicator color="#9B1C31" /><Text style={styles.body}>Loading private report…</Text></View>;
  const decisionFrozen = Boolean(decision.pending || decision.receipt || decision.busy || !decision.ready);
  const frozen = actionFrozen || decisionFrozen;
  const valid = !decisionValidation(note) && status !== report.triage_status;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.notice}>
        <Text style={styles.subheading}>Private staff review</Text>
        <Text style={styles.body}>Keep evidence private. Escalate for admin action; each action needs confirmation.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{targetLabel(report.target_type)} report</Text>
        <Text style={styles.body}>{REPORT_REASONS.find(reason => reason.value === report.reason)?.label}</Text>
        <Text style={styles.small}>#{report.report_id.slice(0, 8)}</Text>
        <Text style={styles.small}>{new Date(report.created_at).toLocaleString()}</Text>
        <Text style={styles.subheading}>{triageLabel(report.triage_status)}</Text>
        <Text style={styles.small}>Version {report.triage_version}</Text>
        <Text style={styles.subheading}>Report details</Text>
        <Text style={styles.value}>{report.details || 'No additional details submitted.'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.subheading}>Submitted evidence</Text>
        <Text style={styles.small}>Evidence saved with the report. The original may have changed.</Text>
        {report.evidence.map(field => <View key={field.label} style={{ gap: 4 }}>
          <Text style={styles.small}>{field.label}</Text><Text style={styles.value}>{field.value || 'Not provided'}</Text>
        </View>)}
        {!report.evidence.length ? <Text style={styles.body}>No evidence snapshot available.</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.subheading}>Decision history</Text>
        {!report.history.length ? <Text style={styles.body}>No decisions recorded yet.</Text> : report.history.map(item =>
          <View key={item.decision_id} style={{ gap: 6 }}>
            <Text style={styles.subheading}>{triageLabel(item.from_status)} → {triageLabel(item.to_status)}</Text>
            <Text style={styles.small}>Version {item.version} by {item.is_mine ? 'you' : 'a staff reviewer'}</Text>
            <Text style={styles.small}>{new Date(item.created_at).toLocaleString()}</Text>
            <Text style={styles.value}>{item.note}</Text>
          </View>)}
      </View>
      <View style={styles.card}>
        <Text style={styles.subheading}>{decision.receipt ? 'Decision recorded' : 'Record a decision'}</Text>
        {decision.receipt ? <>
          <Text accessibilityLiveRegion="polite" style={styles.body}>{triageLabel(decision.receipt.triage_status)} (version {decision.receipt.triage_version}). Reload to see the latest report and history.</Text>
          <ModerationButton title="Reload report" onPress={reload} />
        </> : <>
          {decision.pending ? <View style={styles.notice}>
            <Text style={styles.subheading}>Saved decision awaiting confirmation</Text>
            <Text style={styles.body}>{triageLabel(decision.pending.status)}</Text>
            <Text style={styles.small}>Based on version {decision.pending.expectedVersion}</Text>
            <Text style={styles.value}>{decision.pending.note}</Text>
            <Text style={styles.small}>Retry uses the same decision. It cannot create a duplicate.</Text>
          </View> : <>
            <View style={styles.row}>{TRIAGE_STATUSES.filter(value => value !== report.triage_status).map(value =>
              <Pressable key={value} accessibilityRole="button" disabled={frozen} accessibilityState={{ disabled: frozen, selected: status === value }}
                style={[styles.button, status === value && styles.selected]} onPress={() => { setStatus(value); setConfirming(false); }}>
                <Text style={styles.buttonText}>{triageLabel(value)}</Text>
              </Pressable>)}</View>
            <Text style={styles.body}>Reason for decision</Text>
            <TextInput accessibilityLabel="Reason for decision" multiline maxLength={4000} editable={!frozen} value={note}
              style={styles.input} onChangeText={value => { setNote(Array.from(value).slice(0, 2000).join('')); setConfirming(false); }}
              placeholder="Explain the decision for other reviewers" placeholderTextColor="#635C5C" />
            <Text style={styles.small}>{Array.from(note.trim()).length}/2,000 (at least 10 characters). Unsubmitted notes are cleared when you leave.</Text>
          </>}
          {!decision.ready ? <ModerationButton title="Retry saved decision loading" disabled={decision.busy} onPress={() => { void model.restore(); }} />
            : decision.conflict ? <ModerationButton title="Review latest version" disabled={decision.busy}
              onPress={() => { void model.clearConflict().then(cleared => { if (cleared) reload(); }); }} />
              : decision.pending ? <ModerationButton title={decision.busy ? 'Confirming decision…' : 'Retry saved decision'} primary disabled={decision.busy}
                onPress={() => { void model.submit(); }} />
                : confirming ? <View style={styles.notice}>
                  <Text style={styles.body}>Record this report as {status}? This explanation will be kept in its decision history.</Text>
                  <ModerationButton title="Confirm decision" primary disabled={frozen || !valid} onPress={() => {
                    void model.submit({ expectedVersion: report.triage_version, status, note }); setConfirming(false);
                  }} />
                  <ModerationButton title="Keep editing" disabled={frozen} onPress={() => setConfirming(false)} />
                </View> : <ModerationButton title="Record decision" primary disabled={frozen || !valid} onPress={() => setConfirming(true)} />}
        </>}
        {decision.error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{decision.error}</Text> : null}
      </View>
      <ModerationActions userId={userId} reportId={reportId} expectedVersion={report.triage_version} disabled={decisionFrozen} invalidate={invalidate}
        reload={reload} onFreeze={setActionFrozen} />
    </ScrollView>
  </KeyboardAvoidingView>;
}
