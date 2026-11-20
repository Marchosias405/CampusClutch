import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenHeader from '../../components/ScreenHeader';
import { actionButton, actionButtonText } from '../../constants/actionStyles';
import { useAuth } from '../../context/AuthContext';
import { getProfileById } from '../../lib/profiles';
import { loadRequest } from '../../lib/requests';
import { createReportDraftModel } from '../../lib/reportDraft';
import { getSafetyReportTarget, isReportTargetType, REPORT_REASONS, validateReportFields } from '../../lib/safetyReports';
import { getStudentBlockState } from '../../lib/studentBlocks';
import type { ReportTargetType } from '../../lib/safetyReports';

const PRIMARY = '#9B1C31';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TargetState = { status: 'loading' | 'ready' | 'unavailable' | 'error'; label: string };
const TARGET_LABELS: Record<ReportTargetType, string> = {
  student: 'Student', request: 'Request', message: 'Message', course_review: 'Course review',
};
const REPORT_HEADINGS: Record<ReportTargetType, string> = {
  student: 'Report student', request: 'Report request', message: 'Report message', course_review: 'Report review',
};

function ReportHeader({ title }: { title: string }) {
  const router = useRouter();
  return <ScreenHeader>
    <Pressable accessibilityRole="button" accessibilityLabel="Back from report"
      style={styles.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
      <Ionicons name="arrow-back" size={24} color="white" />
    </Pressable>
    <Text style={styles.headerTitle}>{title}</Text>
  </ScreenHeader>;
}

export default function ReportScreen() {
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  const { user } = useAuth();
  const targetType = typeof params.targetType === 'string' ? params.targetType : '';
  const targetId = typeof params.targetId === 'string' ? params.targetId.toLowerCase() : '';
  if (!user || !isReportTargetType(targetType) || !UUID.test(targetId)
    || (targetType === 'student' && targetId === user.id.toLowerCase())) {
    return <View style={styles.page}>
      <ReportHeader title="Report a concern" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Report unavailable</Text>
        <Text style={styles.body}>Open another student&apos;s profile, request, direct message, or course review to report a concern.</Text>
      </ScrollView>
    </View>;
  }
  return <ReportForm key={`${user.id}:${targetType}:${targetId}`} userId={user.id}
    targetType={targetType} targetId={targetId} />;
}

function ReportForm({ userId, targetType, targetId }: {
  userId: string; targetType: ReportTargetType; targetId: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const model = useMemo(() => createReportDraftModel({ userId, targetType, targetId }),
    [userId, targetType, targetId]);
  const [state, setState] = useState(model.getState);
  const [target, setTarget] = useState<TargetState>({ status: 'loading', label: '' });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const targetAvailable = useRef(false);
  const targetEpoch = useRef(0);

  const loadTarget = useCallback(async () => {
    if (!focused.current || !foreground.current) return;
    const epoch = ++targetEpoch.current;
    targetAvailable.current = false;
    setTarget({ status: 'loading', label: '' });
    try {
      let label = '';
      if (targetType === 'student') {
        const profile = await getProfileById(targetId);
        if (profile && profile.id.toLowerCase() !== userId.toLowerCase()) {
          label = profile.displayName || 'Student';
        } else {
          // The server only returns block state for an authorized student relationship.
          // A block hides discovery details without removing the ability to report harm.
          const block = await getStudentBlockState(userId, targetId);
          if (block.interaction_blocked) label = 'Student';
        }
      } else if (targetType === 'request') {
        const request = await loadRequest(targetId);
        if (request?.ownerId && request.ownerId.toLowerCase() !== userId.toLowerCase()) label = request.title;
      } else {
        const item = await getSafetyReportTarget(userId, targetType, targetId);
        label = item.target_label;
      }
      if (epoch !== targetEpoch.current || !focused.current || !foreground.current) return;
      targetAvailable.current = !!label;
      setTarget({ status: label ? 'ready' : 'unavailable', label });
    } catch (error) {
      if (epoch === targetEpoch.current && focused.current && foreground.current) {
        const unavailable = error && typeof error === 'object' && 'code' in error && error.code === '42501';
        setTarget({ status: unavailable ? 'unavailable' : 'error', label: '' });
      }
    }
  }, [targetId, targetType, userId]);

  useEffect(() => {
    const unsubscribe = model.subscribe(() => setState(model.getState()));
    setState(model.getState());
    return () => { unsubscribe(); model.dispose(); };
  }, [model]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    model.setActive(foreground.current);
    setState(model.getState());
    void model.restore();
    void loadTarget();
    return () => {
      focused.current = false;
      targetAvailable.current = false;
      ++targetEpoch.current;
      model.setActive(false);
    };
  }, [loadTarget, model]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      model.setActive(focused.current && foreground.current);
      if (focused.current && foreground.current) {
        setState(model.getState());
        void model.restore();
        void loadTarget();
      } else {
        targetAvailable.current = false;
        ++targetEpoch.current;
      }
    });
    return () => subscription.remove();
  }, [loadTarget, model]);

  const pending = !!state.pending;
  const valid = !validateReportFields(state.reason, state.details);
  const locked = state.busy || pending || !state.restored || !!state.receipt;
  const canSubmit = state.restored && !state.busy && !state.receipt
    && (pending || (valid && target.status === 'ready'));
  const heading = REPORT_HEADINGS[targetType];

  const submit = () => {
    if (!canSubmit || !focused.current || !foreground.current
      || (!state.pending && !targetAvailable.current)) return;
    Keyboard.dismiss();
    setConfirmDiscard(false);
    void model.submit();
  };

  return <View style={styles.page}>
    <ReportHeader title={heading} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(28, insets.bottom + 20) }]}>
        {state.receipt ? <View style={styles.card}>
          <Ionicons name="checkmark-circle-outline" size={40} color={PRIMARY} />
          <Text accessibilityRole="header" style={styles.heading}>Report received</Text>
          <Text style={styles.body}>Report sent to moderators. Other students cannot see it.</Text>
          <Pressable accessibilityRole="button" style={styles.primaryButton}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View> : <>
          <Text accessibilityRole="header" style={styles.heading}>Share a concern</Text>
          {target.label ? <View style={styles.targetCard}>
            <Text style={styles.label}>{TARGET_LABELS[targetType]}</Text>
            <Text style={styles.targetName}>{target.label}</Text>
          </View> : null}
          <Text style={styles.body}>Only authorized moderators can see your report.</Text>
          <Text style={styles.body}>For immediate danger, contact emergency services.</Text>

          {target.status === 'loading' && !pending && <View style={styles.notice}>
            <ActivityIndicator color={PRIMARY} /><Text style={styles.body}>Loading report details…</Text>
          </View>}
          {(target.status === 'unavailable' || target.status === 'error') && !pending && <View style={styles.notice}>
            <Text accessibilityRole="alert" style={styles.error}>{target.status === 'error'
              ? 'Unable to load this item. Check your connection and try again.'
              : 'This item is not available to your account. Return to the original item and try again.'}</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => void loadTarget()}>
              <Text style={styles.secondaryText}>Retry loading report details</Text>
            </Pressable>
          </View>}

          {!state.restored && !state.restoreFailed && <View style={styles.notice}>
            <ActivityIndicator color={PRIMARY} /><Text style={styles.body}>Restoring saved report…</Text>
          </View>}

          <Text style={styles.label}>Reason</Text>
          <View style={styles.reasons}>
            {REPORT_REASONS.map(({ value, label }) => <Pressable key={value} accessibilityRole="radio"
              accessibilityLabel={label} aria-checked={state.reason === value}
              accessibilityState={{ checked: state.reason === value, disabled: locked }}
              disabled={locked} onPress={() => model.setReason(value)}
              style={[styles.reason, state.reason === value && styles.reasonSelected, locked && styles.disabled]}>
              <Text style={[styles.reasonText, state.reason === value && styles.reasonTextSelected]}>{label}</Text>
            </Pressable>)}
          </View>

          <Text style={styles.label}>{state.reason === 'other' ? 'What happened?' : 'What happened? (optional)'}</Text>
          <Text style={styles.body}>Describe the concern. Leave out passwords, payment details and unrelated private information.</Text>
          {/* Native maxLength counts UTF-16 units; the model enforces 2,000 Unicode characters. */}
          <TextInput accessibilityLabel="Report details" placeholder="Describe your concern" placeholderTextColor="#635C5C"
            multiline textAlignVertical="top" maxLength={4000} editable={!locked} value={state.details}
            onChangeText={model.setDetails} style={styles.detailsInput} />
          <Text style={styles.count}>{Array.from(state.details).length.toLocaleString()} / 2,000{state.reason === 'other' ? ' (at least 10 characters)' : ''}</Text>

          {!!state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
          {pending && <View style={styles.notice}>
            <Text style={styles.body}>Your report is unconfirmed. Retrying won’t send it twice.</Text>
          </View>}
          {state.restoreFailed && <Pressable accessibilityRole="button" style={styles.secondaryButton}
            disabled={state.busy} accessibilityState={{ disabled: state.busy }} onPress={() => void model.restore()}>
            <Text style={styles.secondaryText}>Retry restoring saved report</Text>
          </Pressable>}

          {(pending || state.restoreFailed) && !confirmDiscard && <Pressable accessibilityRole="button"
            style={styles.secondaryButton} disabled={state.busy} accessibilityState={{ disabled: state.busy }}
            onPress={() => setConfirmDiscard(true)}>
            <Text style={styles.secondaryText}>Discard saved attempt</Text>
          </Pressable>}
          {confirmDiscard && <View style={styles.notice}>
            <Text accessibilityRole="header" style={styles.label}>Discard this saved attempt?</Text>
            <Text style={styles.body}>Remove the saved attempt from this device? A report already received by moderators will stay.</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} disabled={state.busy}
              accessibilityState={{ disabled: state.busy }} onPress={() => setConfirmDiscard(false)}>
              <Text style={styles.secondaryText}>Keep saved attempt</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} disabled={state.busy}
              accessibilityState={{ disabled: state.busy }} onPress={() => {
                if (!focused.current || !foreground.current) return;
                setConfirmDiscard(false);
                void model.discard();
              }}>
              <Text style={styles.secondaryText}>Confirm discard</Text>
            </Pressable>
          </View>}

          <Pressable accessibilityRole="button" accessibilityLabel={pending ? 'Retry report' : 'Submit report'}
            accessibilityState={{ disabled: !canSubmit, busy: state.busy }} disabled={!canSubmit}
            onPress={submit} style={[styles.primaryButton, !canSubmit && styles.disabled]}>
            {state.busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{pending ? 'Retry report' : 'Submit report'}</Text>}
          </Pressable>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' }, flex: { flex: 1 },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  headerTitle: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  content: { padding: 20, gap: 16 }, card: { gap: 18 },
  heading: { color: '#2B2525', fontSize: 24, fontWeight: '800' },
  body: { color: '#635C5C', fontSize: 15, lineHeight: 22 },
  label: { color: '#2B2525', fontSize: 16, fontWeight: '800' },
  targetCard: { borderWidth: 1, borderColor: '#EFE1E1', borderRadius: 18, padding: 16, gap: 8 },
  targetName: { color: '#2B2525', fontSize: 20, fontWeight: '700' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reason: { minHeight: 48, maxWidth: '100%', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1,
    borderColor: '#D8C2C2', borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  reasonSelected: { borderColor: PRIMARY, backgroundColor: '#FBECEC' },
  reasonText: { color: '#635C5C', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  reasonTextSelected: { color: PRIMARY },
  detailsInput: { minHeight: 150, padding: 16, borderWidth: 1, borderColor: '#D8C2C2', borderRadius: 18,
    color: '#2B2525', fontSize: 16, backgroundColor: '#FAF7F7' },
  count: { color: '#635C5C', fontSize: 13, textAlign: 'right' },
  notice: { backgroundColor: '#FBECEC', borderRadius: 18, padding: 16, gap: 12 },
  error: { color: PRIMARY, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  primaryButton: { ...actionButton, backgroundColor: PRIMARY, borderColor: PRIMARY },
  primaryText: { ...actionButtonText, color: '#FFFFFF' },
  secondaryButton: actionButton,
  secondaryText: actionButtonText,
  disabled: { opacity: 0.55 },
});
