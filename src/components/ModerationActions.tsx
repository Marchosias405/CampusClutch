import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import { decisionValidation, moderationAccessLost } from '../lib/moderation';
import { ENFORCEMENT_ACTIONS, enforcementLabel, getEnforcementContext } from '../lib/moderationEnforcement';
import type { EnforcementContext, EnforcementKind } from '../lib/moderationEnforcement';
import { createModerationEnforcement } from '../lib/moderationEnforcementDraft';
import type { EnforcementState } from '../lib/moderationEnforcementDraft';
import { ModerationButton, moderationStyles as styles } from './ModerationShell';

export default function ModerationActions({ userId, reportId, expectedVersion, disabled, invalidate, reload, onFreeze }: {
  userId: string; reportId: string; expectedVersion: number; disabled: boolean; invalidate(): void; reload(): void; onFreeze(value: boolean): void;
}) {
  const [context, setContext] = useState<EnforcementContext | null>(null);
  const [error, setError] = useState('');
  const [model, setModel] = useState<ReturnType<typeof createModerationEnforcement> | null>(null);
  const [state, setState] = useState<EnforcementState | null>(null);
  const [kind, setKind] = useState<EnforcementKind>('warn');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let active = true;
    const next = createModerationEnforcement(userId, reportId);
    setModel(next); setState(next.getState());
    const unsubscribe = next.subscribe(() => { if (active) setState(next.getState()); });
    void next.restore();
    void getEnforcementContext(userId, reportId).then(value => { if (active) setContext(value); }).catch(cause => {
      if (!active) return;
      if (moderationAccessLost(cause)) invalidate();
      else setError('Unable to load admin actions. Reload this report to retry.');
    });
    return () => { active = false; unsubscribe(); next.dispose(); };
  }, [userId, reportId, invalidate]);
  useEffect(() => { if (state?.accessLost) invalidate(); }, [state?.accessLost, invalidate]);
  useEffect(() => { onFreeze(!state?.ready || Boolean(state?.pending || state?.busy || state?.receipt)); }, [state, onFreeze]);
  if (error) return <View style={styles.card}><Text style={styles.error}>{error}</Text><ModerationButton title="Reload report" onPress={reload} /></View>;
  if (!context || !state || !model) return <ActivityIndicator color="#9B1C31" />;
  if (context.version !== expectedVersion && !state.pending && !state.receipt) return <View style={styles.card}>
    <Text style={styles.body}>This report changed while loading. Reload to review the latest version before an admin action.</Text>
    <ModerationButton title="Reload report" onPress={reload} />
  </View>;
  const frozen = disabled || state.busy || !state.ready || Boolean(state.pending || state.receipt);
  const choices = ENFORCEMENT_ACTIONS.filter(value => value !== 'remove_request' && !context.actions.some(item => item.kind === value)
    && (value !== 'remove_review' || (context.current_review && !context.review_removed)));
  return <View style={styles.card}>
    <Text style={styles.heading}>Admin actions</Text>
    {context.current_review && !context.review_removed && <Text style={styles.body}>Hide an unreliable review to remove it from the course page and statistics. Report evidence is kept.</Text>}
    <Text style={styles.body}>{context.warning_count} formal warnings in total</Text>
    <Text style={styles.body}>{context.warning_count % 3}/3 warnings this cycle</Text>
    <Text style={styles.small}>Every third warning triggers a 7-day suspension. Jobs and points are kept.</Text>
    {context.suspended_until ? <Text style={styles.body}>Suspension expiry: {new Date(context.suspended_until).toLocaleString()}</Text> : null}
    {context.review_removed ? <Text style={styles.body}>Review hidden from the course page and statistics. The student may publish a revision; original evidence is kept.</Text> : null}
    {context.current_review && !context.review_removed ? <View style={styles.notice}>
      <Text style={styles.subheading}>Current review</Text>
      <Text style={styles.small}>This is the latest version, which may differ from the submitted evidence. Review it before removal.</Text>
      <Text style={styles.body}>Difficulty: {context.current_review.difficulty}/5</Text>
      <Text style={styles.body}>Workload: {context.current_review.workload}/5</Text>
      <Text style={styles.body}>Grade: {context.current_review.grade ?? 'Not provided'}</Text>
      <Text style={styles.value}>{context.current_review.comment}</Text>
      {!!context.current_review.tips && <Text style={styles.value}>Study tips: {context.current_review.tips}</Text>}
      {!!context.current_review.instructor && <Text style={styles.value}>Instructor: {context.current_review.instructor}</Text>}
    </View> : null}
    {context.actions.map(action => <View key={action.id} style={styles.notice}>
      <Text style={styles.subheading}>{enforcementLabel(action.kind)}</Text>
      <Text style={styles.small}>{new Date(action.created_at).toLocaleString()}</Text>
      {action.revoked_at && <Text style={styles.subheading}>Overturned on appeal</Text>}
      <Text style={styles.value}>{action.reason}</Text>
      {action.automatic_suspension && <Text style={styles.body}>Third warning: automatic 7-day suspension.</Text>}
    </View>)}
    {state.receipt ? <>
      <Text accessibilityLiveRegion="polite" style={styles.body}>Action recorded.{state.receipt.automatic_suspension ? ' The third warning also suspended this account for 7 days.' : ''}</Text>
      <ModerationButton title="Reload report" onPress={reload} />
    </> : state.pending ? <View style={styles.notice}>
      <Text style={styles.subheading}>Saved action awaiting confirmation</Text>
      <Text style={styles.body}>{enforcementLabel(state.pending.kind)}</Text><Text style={styles.value}>{state.pending.reason}</Text>
      <Text style={styles.small}>Retry uses the same action, including after restarting the app.</Text>
      {state.conflict ? <ModerationButton title="Review latest report" disabled={state.busy} onPress={() => { void model.clearConflict().then(cleared => { if (cleared) reload(); }); }} />
        : <ModerationButton title={state.busy ? 'Confirming action…' : 'Retry saved action'} primary disabled={state.busy || disabled} onPress={() => { void model.submit(); }} />}
    </View> : !context.can_act ? <Text style={styles.body}>{context.is_admin
      ? 'Actions are available for escalated reports about an existing student account. Staff accounts require owner review.'
      : 'Only an assigned admin can issue warnings, suspend accounts, or remove reviews.'}</Text> : <>
      <View style={styles.row}>{choices.map(value => <ModerationButton key={value} title={enforcementLabel(value)}
        primary={kind === value} disabled={frozen} onPress={() => { setKind(value); setConfirming(false); }} />)}</View>
      {choices.length ? <>
        <Text style={styles.body}>Reason shown to the affected student</Text>
        <Text style={styles.small}>Explain the rule and action. Keep reporter identities and staff notes private.</Text>
        <TextInput accessibilityLabel="Reason for admin action" value={reason} multiline editable={!frozen} style={styles.input}
          onChangeText={value => { setReason(Array.from(value).slice(0, 2000).join('')); setConfirming(false); }} />
        {confirming ? <View style={styles.notice}>
          <Text style={styles.subheading}>Confirm: {enforcementLabel(kind)}</Text>
          <Text style={styles.body}>{kind === 'remove_review' ? 'Hide this current review from all students and exclude it from course statistics. Keep its private evidence. The student may publish a revised review.'
            : kind === 'suspend_7_days' ? 'Block this student’s app access for 7 days, including sessions already signed in.'
              : `Issue one formal warning.${context.warning_count % 3 === 2 ? ' This is the third warning and will also suspend app access for 7 days.' : ''}`}</Text>
          <ModerationButton title="Confirm admin action" primary disabled={frozen || Boolean(decisionValidation(reason)) || !choices.includes(kind)} onPress={() => {
            void model.submit({ expectedVersion: context.version, kind, reason,
              reviewUpdatedAt: kind === 'remove_review' ? context.review_updated_at : null }); setConfirming(false);
          }} />
          <ModerationButton title="Keep editing action" disabled={frozen} onPress={() => setConfirming(false)} />
        </View> : <ModerationButton title="Review admin action" primary disabled={frozen || Boolean(decisionValidation(reason)) || !choices.includes(kind)} onPress={() => setConfirming(true)} />}
      </> : <Text style={styles.body}>Available actions for this report are already recorded.</Text>}
    </>}
    {!state.ready && <ModerationButton title="Retry saved action loading" disabled={state.busy} onPress={() => { void model.restore(); }} />}
    {!!state.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.error}</Text>}
  </View>;
}
