import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { DevicePushToken, NotificationResponse } from 'expo-notifications';
import { androidPushToken } from './androidPush';
import { loadPushSettings, openPushNotification, refreshPushDevice } from './notifications';

export function useAndroidPush(userId?: string) {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS !== 'android' || !userId) return;
    const account = userId;
    let active = true;
    const subscriptions: { remove(): void }[] = [];
    const seen = new Set<string>();
    async function refresh(deviceToken?: DevicePushToken) {
      try {
        const settings = await loadPushSettings(account);
        if (!active || !settings.registered || !settings.push_enabled) return;
        const token = await androidPushToken(false, deviceToken);
        if (active && token) await refreshPushDevice(account, token);
      } catch { /* Offline refresh retries on foreground. */ }
    }
    async function start() {
      const notifications = await import('expo-notifications');
      if (!active) return;
      const open = async (response: NotificationResponse | null) => {
        const id = response?.notification.request.content.data?.notificationId;
        if (!active || typeof id !== 'string' || seen.has(id)) return;
        seen.add(id);
        if (notifications.getLastNotificationResponse()?.notification.request.identifier === response?.notification.request.identifier) {
          notifications.clearLastNotificationResponse();
        }
        try {
          const target = await openPushNotification(account, id);
          if (active) router.push(target ?? '/notifications');
        } catch { if (active) router.push('/notifications'); }
      };
      subscriptions.push(notifications.addNotificationResponseReceivedListener(response => { void open(response); }));
      subscriptions.push(notifications.addPushTokenListener(token => { void refresh(token); }));
      subscriptions.push(AppState.addEventListener('change', state => { if (state === 'active') void refresh(); }));
      void open(notifications.getLastNotificationResponse());
      void refresh();
    }
    void start().catch(() => { /* Development clients may predate the native module. */ });
    return () => { active = false; for (const subscription of subscriptions) subscription.remove(); };
  }, [router, userId]);
}
