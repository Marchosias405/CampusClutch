import { MotionPressable as Pressable, MotionReveal } from '@/components/motion';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNotifications } from '../context/NotificationsContext';

export default function NotificationBell() {
  const router = useRouter();
  const { unreadCount } = useNotifications();
  return <Pressable accessibilityRole="button"
    accessibilityLabel={`Notifications, ${unreadCount} unread`}
    style={styles.button} onPress={() => router.push('/notifications')}>
    <Ionicons name="notifications-outline" size={23} color="white" />
    {unreadCount > 0 && <MotionReveal style={styles.badge} pointerEvents="none">
      <Text style={styles.count}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
    </MotionReveal>}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 0, right: -3, minWidth: 20, minHeight: 20,
    paddingHorizontal: 4, borderRadius: 11, backgroundColor: 'white', alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderColor: '#9B1C31' },
  count: { color: '#9B1C31', fontSize: 11, fontWeight: '900' },
});
