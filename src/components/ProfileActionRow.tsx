import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  label: string;
  accessibilityLabel?: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'account' | 'staff';
  chevron?: boolean;
};

/** One alignment and touch target for profile navigation and account actions. */
export default function ProfileActionRow({ label, accessibilityLabel, icon, onPress,
  disabled = false, busy = false, tone = 'account', chevron = true }: Props) {
  const color = tone === 'staff' ? '#35465B' : '#9B1C31';
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy}
    onPress={onPress} style={({ pressed }) => [styles.row, tone === 'staff' && styles.staff,
      pressed && styles.pressed, (disabled || busy) && styles.disabled]}>
    <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name={icon} size={22} color={color} />
    </View>
    <Text style={[styles.label, { color }]}>{label}</Text>
    {busy ? <ActivityIndicator color={color} /> : chevron ?
      <Ionicons name="chevron-forward" size={20} color={color} accessible={false} /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { width: '100%', minHeight: 56, paddingHorizontal: 16, paddingVertical: 15,
    borderWidth: 1, borderColor: '#E8DDDF', borderRadius: 16, backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, textAlign: 'left', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  staff: { borderColor: '#CCD5E0' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.6 },
});
