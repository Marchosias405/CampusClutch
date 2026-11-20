import { LoadingState } from '@/components/LoadingState';
import { MotionPressable as Pressable } from '@/components/motion';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from './ScreenHeader';
import { actionButton, actionButtonText } from '../constants/actionStyles';
import { useModerationAccess } from '../lib/useModerationAccess';

export const triageLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const targetLabel = (value: string) => value === 'course_review' ? 'Course review' : triageLabel(value);
export function ModerationButton({ title, onPress, disabled = false, primary = false }: {
  title: string; onPress(): void; disabled?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[moderationStyles.button, primary && moderationStyles.primary, disabled && { opacity: 0.5 }]}>
    <Text style={[moderationStyles.buttonText, primary && { color: '#FFFFFF' }]}>{title}</Text>
  </Pressable>;
}
export function ModerationFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return <View style={[moderationStyles.screen, { paddingBottom: insets.bottom }]}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={moderationStyles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')}>
        <Text style={moderationStyles.backText}>‹ Back</Text>
      </Pressable>
      <Text style={moderationStyles.header}>{title}</Text>
    </ScreenHeader>
    {children}
  </View>;
}
export function ModerationGate({ userId, children, adminOnly = false }: { userId: string; adminOnly?: boolean; children(invalidate: () => void): React.ReactNode }) {
  const access = useModerationAccess(userId);
  if (access.status === 'allowed' && (!adminOnly || access.role === 'admin')) return <>{children(access.invalidate)}</>;
  return <View style={moderationStyles.center}>
    {access.status === 'checking' ? <LoadingState title="Checking moderation access" />
      : access.status === 'hidden' ? null : <>
        <Text style={moderationStyles.heading}>{(access.status === 'denied' || (adminOnly && access.role === 'moderator')) ? 'Moderation access required' : 'Unable to verify access'}</Text>
        <Text style={moderationStyles.body}>{(access.status === 'denied' || (adminOnly && access.role === 'moderator'))
          ? adminOnly ? 'Only assigned admins can take this action.' : 'Only assigned staff can review reports.'
          : 'Check your connection and retry. Your unconfirmed decision is saved.'}</Text>
        <ModerationButton title="Retry access" onPress={access.retry} />
      </>}
  </View>;
}
export const moderationStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { color: '#FFFFFF', fontSize: 21, fontWeight: '800', flex: 1, marginLeft: 12 },
  back: { minWidth: 48, minHeight: 48, justifyContent: 'center' },
  backText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  content: { padding: 20, gap: 16, paddingBottom: 32 },
  card: { borderWidth: 1, borderColor: '#E6DCDC', borderRadius: 20, padding: 18, gap: 12 },
  heading: { color: '#2B2525', fontSize: 23, fontWeight: '800' },
  subheading: { color: '#2B2525', fontSize: 18, fontWeight: '800' },
  body: { color: '#635C5C', fontSize: 16, lineHeight: 24 },
  small: { color: '#635C5C', fontSize: 14, lineHeight: 21 },
  value: { color: '#2B2525', fontSize: 16, lineHeight: 24 },
  error: { color: '#9B1C31', fontSize: 16, lineHeight: 24 },
  notice: { backgroundColor: '#FBECEE', borderRadius: 16, padding: 16, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: actionButton,
  primary: { backgroundColor: '#9B1C31', borderColor: '#9B1C31' },
  buttonText: actionButtonText,
  selected: { borderColor: '#9B1C31', backgroundColor: '#FBECEE' },
  input: { borderWidth: 1, borderColor: '#D7BFC3', backgroundColor: '#FBF8F8', borderRadius: 16,
    minHeight: 140, padding: 14, color: '#2B2525', fontSize: 16, textAlignVertical: 'top' },
});
