import { usePathname } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createMessagesRealtime, type MessageChangeListener } from '../lib/messagesRealtime';
import { loadUnreadNotificationCount } from '../lib/notifications';
import { connectAccountNotifications } from '../lib/notificationsRealtimeTransport';
import { createUnreadMessages } from '../lib/unreadMessages';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';

type Value = {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  subscribeNotifications: (listener: MessageChangeListener) => () => void;
};
const NotificationsContext = createContext<Value | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user, session, isPasswordRecovery } = useAuth();
  const { profile, isProfileComplete } = useProfile();
  const userId = user?.id;
  const token = session?.access_token;
  const pathname = usePathname();
  // Every account starts with a separate zero count. Late results stay with the old store.
  const model = useMemo(() => createUnreadMessages(() => userId
    ? loadUnreadNotificationCount(userId) : Promise.resolve(0)), [userId]);
  const realtime = useMemo(() => createMessagesRealtime(userId && token
    ? connectAccountNotifications(userId, token) : () => () => {}, model.refresh), [userId, token, model]);
  const count = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const enabled = !!userId && profile?.id === userId && isProfileComplete && !isPasswordRecovery;

  useEffect(() => {
    const updateActivity = (state: string) => {
      const active = enabled && state === 'active';
      model.setActive(active);
      realtime.setActive(active);
    };
    updateActivity(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateActivity);
    return () => { subscription.remove(); realtime.setActive(false); model.setActive(false); };
  }, [enabled, model, realtime]);
  useEffect(() => { void model.refresh(); }, [model, pathname]);

  const value = useMemo(() => ({ unreadCount: enabled ? count : 0,
    refreshUnread: model.refresh, subscribeNotifications: realtime.subscribe }), [enabled, count, model, realtime]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationsProvider');
  return value;
}
