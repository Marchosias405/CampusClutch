import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { ModerationButton, ModerationFrame, ModerationGate, moderationStyles as styles } from '../../components/ModerationShell';
import { decisionValidation, moderationAccessLost } from '../../lib/moderation';
import { createDirectAction, directChoices, getDirectContext, isDirectTarget } from '../../lib/directModeration';
import type { DirectContext, DirectTarget } from '../../lib/directModeration';
import { enforcementLabel } from '../../lib/moderationEnforcement';
import type { EnforcementKind } from '../../lib/moderationEnforcement';
import type { EnforcementState } from '../../lib/moderationEnforcementDraft';
import { isReportId } from '../../lib/safetyReports';

export default function DirectAdminRoute() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  if (!user) return null;
  const target = params.targetType; const id = params.targetId;
  return <ModerationFrame title="Admin action">
    {!isDirectTarget(target) || !isReportId(id) ? <Text style={styles.error}>Open a student, request or review to take an action.</Text>
      : <ModerationGate key={user.id} userId={user.id} adminOnly>{invalidate =>
        <DirectAction key={`${user.id}:${target}:${id}`} userId={user.id} target={target} id={id!} invalidate={invalidate} />
      }</ModerationGate>}
  </ModerationFrame>;
}

export function DirectAction({ userId, target, id, invalidate }: { userId: string; target: DirectTarget; id: string; invalidate(): void }) {
  const [revision, setRevision] = useState(0);
  const [context, setContext] = useState<DirectContext | null>(null);
  const [error, setError] = useState('');
  const [model, setModel] = useState<ReturnType<typeof createDirectAction> | null>(null);
  const [state, setState] = useState<EnforcementState | null>(null);
  const [kind, setKind] = useState<EnforcementKind>(directChoices(target)[0]);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let active = true;
    const next = createDirectAction(userId, target, id);
    setModel(next); setState(next.getState()); setContext(null); setError(''); setConfirming(false);
    const unsubscribe = next.subscribe(() => { if (active) setState(next.getState()); });
    void next.restore();
    void getDirectContext(userId, target, id).then(value => { if (active) setContext(value); }).catch(cause => {
      if (!active) return;
      // A removal may already have committed. Keep the saved action visible so
      // its receipt can be reconciled even when the target is no longer listed.
      if (moderationAccessLost(cause) && !next.getState().pending) setError('This content or admin access is unavailable.');
      else setError('Unable to load this item. Retry when connected.');
    });
    return () => { active = false; unsubscribe(); next.dispose(); };
  }, [userId, target, id, revision]);
  useEffect(() => { if (state?.accessLost) invalidate(); }, [state?.accessLost, invalidate]);
  const reload = () => setRevision(value => value + 1);
  const frozen = !state?.ready || state.busy || Boolean(state.pending || state.receipt);
  const effect = kind === 'remove_request' ? 'Hide this request and close any active assignment. Reserved points are released; completed payments stay unchanged.'
    : kind === 'remove_review' ? 'Hide this review and remove it from course statistics. The student can publish a revised review.'
      : kind === 'suspend_7_days' ? 'Block app access for 7 days. Existing jobs and points stay unchanged.'
        : `Add one formal warning.${(context?.warningCount ?? 0) % 3 === 2 ? ' This third warning also suspends access for 7 days.' : ''}`;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {state?.receipt ? <View style={styles.notice}>
        <Text accessibilityLiveRegion="polite" style={styles.heading}>Action recorded</Text>
        <Text style={styles.body}>The student has been notified with your explanation.</Text>
        {state.receipt.automatic_suspension && <Text style={styles.body}>The third warning also suspended access for 7 days.</Text>}
      </View> : state?.pending && model ? <View style={styles.card}>
        <Text style={styles.heading}>Confirm saved action</Text>
        <Text style={styles.subheading}>{enforcementLabel(state.pending.kind)}</Text>
        <Text style={styles.value}>{state.pending.reason}</Text>
        <Text style={styles.body}>Retry checks the same action without applying it twice.</Text>
        {state.conflict ? <><Text style={styles.body}>The item changed or this action was already taken. Reload before choosing another action.</Text>
          <ModerationButton title="Review latest item" disabled={state.busy} onPress={() => { void model.clearConflict().then(cleared => { if (cleared) reload(); }); }} /></>
          : <ModerationButton title={state.busy ? 'Confirming…' : 'Retry saved action'} primary disabled={state.busy} onPress={() => { void model.submit(); }} />}
      </View> : error ? <View style={styles.notice}><Text style={styles.error}>{error}</Text><ModerationButton title="Reload item" onPress={reload} /></View>
        : !context || !model || !state ? <ActivityIndicator color="#9B1C31" /> : <>
          <View style={styles.card}>
            <Text style={styles.heading}>{context.label}</Text>
            {context.evidence.map(field => <View key={field.label}><Text style={styles.small}>{field.label}</Text><Text style={styles.value}>{field.value}</Text></View>)}
            <Text style={styles.small}>{context.warningCount % 3}/3 warnings in this cycle. Every third warning triggers a 7-day suspension.</Text>
            {context.suspendedUntil && <Text style={styles.small}>Suspended until {new Date(context.suspendedUntil).toLocaleString()}.</Text>}
          </View>
          <View style={styles.card}>
            <Text style={styles.subheading}>Choose an action</Text>
            {directChoices(target).map(choice => <ModerationButton key={choice} title={enforcementLabel(choice)} primary={choice === kind}
              disabled={frozen} onPress={() => { setKind(choice); setConfirming(false); }} />)}
            <Text style={styles.body}>Explanation for the student</Text>
            <TextInput accessibilityLabel="Explanation for the student" multiline value={reason} editable={!frozen} style={styles.input}
              placeholder="Briefly explain why this action is needed." placeholderTextColor="#635C5C"
              onChangeText={value => { setReason(Array.from(value).slice(0, 2000).join('')); setConfirming(false); }} />
            <Text style={styles.small}>At least 10 characters. Keep private reports and staff notes out.</Text>
            {confirming ? <View style={styles.notice}>
              <Text style={styles.subheading}>{enforcementLabel(kind)}</Text><Text style={styles.body}>{effect}</Text>
              <Text style={styles.value}>{reason.trim()}</Text>
              <ModerationButton title="Confirm action" primary disabled={frozen || Boolean(decisionValidation(reason))} onPress={() => {
                void model.submit({ kind, reason, expectedVersion: 0, reviewUpdatedAt: context.updatedAt }); setConfirming(false);
              }} />
              <ModerationButton title="Keep editing" disabled={frozen} onPress={() => setConfirming(false)} />
            </View> : <ModerationButton title="Review action" primary disabled={frozen || Boolean(decisionValidation(reason))} onPress={() => setConfirming(true)} />}
          </View>
        </>}
      {state && !state.ready && model && <ModerationButton title="Retry saved action loading" disabled={state.busy} onPress={() => { void model.restore(); }} />}
      {!!state?.error && !state.conflict && <Text style={styles.error}>{state.error}</Text>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
