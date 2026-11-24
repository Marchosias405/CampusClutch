import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLegalDocuments } from '@/context/LegalDocumentsProvider';
import ProfileActionRow from './ProfileActionRow';

export default function LegalLinks({ variant = 'footer', disabled = false }: {
  variant?: 'footer' | 'profile'; disabled?: boolean;
}) {
  const { open } = useLegalDocuments();
  if (variant === 'profile') return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Privacy & terms</Text>
    <ProfileActionRow label="Privacy Policy" icon="lock-closed-outline" disabled={disabled} onPress={() => open('privacy')} />
    <ProfileActionRow label="Terms" icon="document-text-outline" disabled={disabled} onPress={() => open('terms')} />
  </View>;
  return <View style={styles.links}>
    {(['privacy', 'terms'] as const).map(id => <Pressable key={id} accessibilityRole="button"
      accessibilityLabel={id === 'privacy' ? 'Privacy Policy' : 'Terms'} disabled={disabled}
      accessibilityState={{ disabled }} onPress={() => open(id)}
      style={({ pressed }) => [styles.link, (pressed || disabled) && styles.dimmed]}>
      <Text style={styles.linkText}>{id === 'privacy' ? 'Privacy Policy' : 'Terms'}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 16 },
  link: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  linkText: { color: '#9B1C31', fontSize: 15, lineHeight: 22, fontWeight: '700', textDecorationLine: 'underline' },
  dimmed: { opacity: 0.6 },
  section: { marginTop: 28, gap: 12 },
  heading: { color: '#2B2525', fontSize: 18, lineHeight: 25, fontWeight: '800', marginBottom: 2 },
});
