import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useModerationAccess } from '../lib/useModerationAccess';
import ProfileActionRow from './ProfileActionRow';

export default function ModerationEntry({ userId }: { userId: string }) {
  const access = useModerationAccess(userId);
  const router = useRouter();
  if (access.status !== 'allowed') return null;
  return <View style={styles.panel}>
    <View style={styles.heading}>
      <Ionicons name="shield-checkmark-outline" size={22} color="#35465B" accessible={false} />
      <Text accessibilityRole="header" style={styles.title}>
        {access.role === 'admin' ? 'Admin tools' : 'Moderation tools'}
      </Text>
    </View>
    <ProfileActionRow label="Review reports" icon="file-tray-full-outline" tone="staff"
      onPress={() => router.push('/moderation' as Href)} />
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginTop: 28, padding: 16, gap: 14, borderRadius: 20,
    backgroundColor: '#F1F4F8', borderWidth: 1, borderColor: '#D4DDE8' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: '#35465B', fontSize: 18, lineHeight: 24, fontWeight: '800' },
});
