import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { createStudentBlockModel } from '../lib/studentBlocks';
import type { StudentBlockState } from '../lib/studentBlocks';
import { actionButton, actionButtonText } from '../constants/actionStyles';

type Props = {
  userId: string; profileId: string; displayName?: string;
  onState?: (state: StudentBlockState | null) => void;
  onChanged?: (state: StudentBlockState) => void;
};
export default function BlockStudentControl({ userId, profileId, displayName, onState, onChanged }: Props) {
  const model = useMemo(() => createStudentBlockModel({ userId, profileId }), [userId, profileId]);
  const [state, setState] = useState(model.getState);
  const [confirmation, setConfirmation] = useState<{ blocked: boolean; revision: string } | null>(null);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const callbacks = useRef({ onState, onChanged });
  callbacks.current = { onState, onChanged };

  useEffect(() => {
    const publish = () => {
      const next = model.getState();
      setState(next);
      callbacks.current.onState?.(next.data);
    };
    const unsubscribe = model.subscribe(publish);
    publish();
    return () => { unsubscribe(); model.dispose(); };
  }, [model]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    ++generation.current;
    model.setActive(foreground.current);
    void model.refresh();
    return () => {
      focused.current = false; ++generation.current;
      model.setActive(false); setConfirmation(null);
      callbacks.current.onState?.(null);
    };
  }, [model]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      ++generation.current;
      model.setActive(focused.current && foreground.current);
      setConfirmation(null);
      if (focused.current && foreground.current) void model.refresh();
      else callbacks.current.onState?.(null);
    });
    return () => subscription.remove();
  }, [model]);

  const perform = async (retry = false) => {
    const current = model.getState();
    if (!focused.current || !foreground.current || current.busy || current.loading) return;
    if (!retry && (!confirmation || current.pending || !current.data
      || confirmation.revision !== current.data.revision)) { setConfirmation(null); return; }
    const ticket = generation.current;
    const action = retry ? model.retry() : model.change(confirmation!.blocked);
    setConfirmation(null);
    await action;
    const result = model.getState();
    if (focused.current && foreground.current && generation.current === ticket && !result.pending && result.data && !result.error) {
      callbacks.current.onChanged?.(result.data);
    }
  };
  const unavailable = !state.restored || state.loading || state.busy;
  const ownBlocked = state.data?.blocked_by_me;
  return <View style={styles.container}>
    {(state.loading || state.busy) && <View style={styles.loading}>
      <ActivityIndicator color={PRIMARY} />
      <Text style={styles.body}>{state.busy ? 'Saving block setting…' : 'Loading block setting…'}</Text>
    </View>}
    {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {state.pending ? <View style={styles.panel}>
      <Text style={styles.body}>Your {state.pending.blocked ? 'block' : 'unblock'} is unconfirmed. Retry safely with the saved change.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry saved block change" style={styles.button}
        disabled={unavailable} accessibilityState={{ disabled: unavailable, busy: state.busy }} onPress={() => void perform(true)}>
        <Text style={styles.buttonText}>Retry saved change</Text>
      </Pressable>
    </View> : confirmation ? <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>{confirmation.blocked ? 'Block' : 'Unblock'} {displayName || 'this student'}?</Text>
      <Text style={styles.body}>{confirmation.blocked
        ? 'Stop new messages and offers between you. Existing jobs and reserved points stay unchanged.'
        : 'Allow new messages and offers if both accounts permit contact. Past messages are kept.'}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.button} disabled={unavailable}
          accessibilityState={{ disabled: unavailable }} onPress={() => setConfirmation(null)}>
          <Text style={styles.buttonText}>Keep current setting</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={[styles.button, styles.primary]} disabled={unavailable}
          accessibilityState={{ disabled: unavailable }} onPress={() => void perform()}>
          <Text style={styles.primaryText}>{confirmation.blocked ? 'Confirm block' : 'Confirm unblock'}</Text>
        </Pressable>
      </View>
    </View> : state.data && !state.loading ? <>
      {ownBlocked ? <Text style={styles.body}>You blocked this student. Existing jobs and points remain unchanged.</Text>
        : state.data.interaction_blocked ? <Text style={styles.body}>New contact with this student is unavailable.</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={ownBlocked ? 'Unblock student' : 'Block student'}
        style={styles.button} disabled={unavailable} accessibilityState={{ disabled: unavailable }}
        onPress={() => {
          const current = model.getState();
          if (!focused.current || !foreground.current || current.busy || current.loading || current.pending || !current.data) return;
          setConfirmation({ blocked: !current.data.blocked_by_me, revision: current.data.revision });
        }}>
        <Text style={styles.buttonText}>{ownBlocked ? 'Unblock student' : 'Block student'}</Text>
      </Pressable>
    </> : null}
    {!state.loading && !state.busy && (!state.data || state.restoreFailed) && <Pressable
      accessibilityRole="button" accessibilityLabel="Retry loading block setting" style={styles.button}
      onPress={() => { if (focused.current && foreground.current) void model.refresh(); }}>
      <Text style={styles.buttonText}>Retry loading block setting</Text>
    </Pressable>}
  </View>;
}
const PRIMARY = '#9B1C31';
const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  body: { color: '#635C5C', fontSize: 15, lineHeight: 22, flexShrink: 1 },
  error: { color: PRIMARY, fontSize: 15, lineHeight: 22 },
  panel: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: '#FBECEC' },
  heading: { color: '#2B2525', fontSize: 18, fontWeight: '800' },
  actions: { gap: 10 },
  button: actionButton,
  buttonText: actionButtonText,
  primary: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  primaryText: { ...actionButtonText, color: '#FFFFFF' },
});
