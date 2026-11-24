import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Text, TextInput, View } from 'react-native';
import { createAppealOperation } from '../lib/appealOperation';
import { decisionValidation } from '../lib/moderation';
import { ModerationButton, moderationStyles as styles } from './ModerationShell';

export default function AppealEditor({ userId, targetId, kind, expectedVersion = 0, onDone, onAccessLost }: {
  userId: string; targetId: string; kind: 'submit' | 'resolve'; expectedVersion?: number; onDone(): void; onAccessLost(): void;
}) {
  const model = useMemo(() => createAppealOperation(userId, targetId, kind), [userId, targetId, kind]);
  const [state, setState] = useState(model.getState());
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<'upheld' | 'overturned'>('upheld');
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(kind === 'resolve');
  useEffect(() => {
    const unsubscribe = model.subscribe(() => setState(model.getState()));
    void model.restore();
    const subscription = AppState.addEventListener('change', value => model.setActive(value === 'active'));
    return () => { unsubscribe(); subscription.remove(); model.dispose(); };
  }, [model]);
  useEffect(() => { if (state.accessLost) onAccessLost(); }, [state.accessLost, onAccessLost]);
  const disabled = !state.ready || state.busy;
  // Restore pending submissions even while the new-appeal form is collapsed.
  if (kind === 'submit' && !editing && !state.pending && !state.receipt) return <View>
    <ModerationButton title="Appeal this decision" disabled={disabled}
      onPress={() => setEditing(true)} />
    {!!state.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.error}</Text>}
    {!state.ready && !state.busy && <ModerationButton title="Retry loading appeal" onPress={() => { void model.restore(); }} />}
  </View>;
  return <View style={styles.notice}>
    <Text style={styles.subheading}>{kind === 'submit' ? 'Appeal this decision' : 'Decide this appeal'}</Text>
    {state.receipt ? <><Text style={styles.body}>{kind === 'submit' ? 'Your appeal was received.' : 'Appeal decision recorded.'}</Text>
      <ModerationButton title="Refresh result" onPress={onDone} /></>
      : state.pending ? <>
        <Text style={styles.body}>Saved {kind === 'submit' ? 'appeal' : 'decision'} awaiting confirmation</Text>
        <Text style={styles.value}>{state.pending.reason}</Text>
        {kind === 'resolve' && <Text style={styles.body}>{state.pending.outcome === 'overturned' ? 'Overturn the original decision' : 'Uphold the original decision'}</Text>}
        {state.conflict ? <ModerationButton title="View recorded result" disabled={disabled} onPress={() => { void model.clearConflict().then(cleared => { if (cleared) onDone(); }); }} />
          : <ModerationButton title={state.busy ? 'Confirming…' : 'Retry saved attempt'} primary disabled={disabled} onPress={() => { void model.submit(); }} />}
      </> : <>
        <Text style={styles.body}>{kind === 'submit'
          ? 'Explain why this decision should change. You can appeal once; the decision stays in effect during review.'
          : 'The student will see your reason. Keep reporter identities and staff notes private.'}</Text>
        {kind === 'resolve' && <View style={styles.row}>
          <ModerationButton title="Uphold" primary={outcome === 'upheld'} disabled={disabled} onPress={() => { setOutcome('upheld'); setConfirming(false); }} />
          <ModerationButton title="Overturn" primary={outcome === 'overturned'} disabled={disabled} onPress={() => { setOutcome('overturned'); setConfirming(false); }} />
        </View>}
        <TextInput accessibilityLabel={kind === 'submit' ? 'Appeal explanation' : 'Appeal decision reason'} multiline style={styles.input}
          editable={!disabled} value={reason} onChangeText={value => { setReason(Array.from(value).slice(0,2000).join('')); setConfirming(false); }} />
        <Text style={styles.small}>{Array.from(reason).length}/2,000 (at least 10 characters)</Text>
        {confirming ? <>
          <Text style={styles.body}>{kind === 'submit' ? 'Send this explanation for admin review?' : outcome === 'upheld'
            ? 'Keep the original action and send this reason to the student?'
            : 'Reverse this action? Other valid sanctions remain. A deleted or replaced review will not be republished.'}</Text>
          <ModerationButton title={kind === 'submit' ? 'Confirm appeal' : 'Confirm appeal decision'} primary disabled={disabled}
            onPress={() => { void model.submit({ expectedVersion, outcome, reason }); }} />
          <ModerationButton title="Keep editing" disabled={disabled} onPress={() => setConfirming(false)} />
        </> : <>
          <ModerationButton title={kind === 'submit' ? 'Review appeal' : 'Review decision'} primary
            disabled={disabled || !!decisionValidation(reason)} onPress={() => setConfirming(true)} />
          {kind === 'submit' && <ModerationButton title="Cancel" disabled={disabled} onPress={() => setEditing(false)} />}
        </>}
      </>}
    {!!state.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.error}</Text>}
    {!state.ready && !state.busy && <ModerationButton title="Retry saved attempt loading" onPress={() => { void model.restore(); }} />}
  </View>;
}
