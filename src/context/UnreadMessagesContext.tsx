import { usePathname } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { loadUnreadMessageCount } from '../lib/messages';
import { createMessagesRealtime, type MessageChangeListener } from '../lib/messagesRealtime';
import { connectAccountMessages } from '../lib/messagesRealtimeTransport';
import { createUnreadMessages } from '../lib/unreadMessages';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';

type Value = {
  unreadCount: number;
  refreshUnread: () => Promise<void>;
  subscribeMessages: (listener: MessageChangeListener) => () => void;
};
const UnreadMessagesContext = createContext<Value | undefined>(undefined);

export function UnreadMessagesProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const { profile, isProfileComplete } = useProfile();
  const userId = user?.id;
  const pathname = usePathname();
  // New account = new store and a zero badge on the very first render.
  const model = useMemo(() => createUnreadMessages(() => userId ? loadUnreadMessageCount(userId) : Promise.resolve(0)), [userId]);
  const token = session?.access_token;
  const realtime = useMemo(() => createMessagesRealtime(
    userId && token ? connectAccountMessages(userId, token) : () => () => {}, model.refresh,
  ), [userId, token, model]);
  const unreadCount = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const enabled = !!userId && profile?.id === userId && isProfileComplete;

  useEffect(() => {
    const updateActivity = (next: string) => {
      const active = enabled && next === 'active';
      model.setActive(active);
      realtime.setActive(active);
    };
    updateActivity(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateActivity);
    return () => { subscription.remove(); realtime.setActive(false); model.setActive(false); };
  }, [enabled, model, realtime]);
  useEffect(() => { void model.refresh(); }, [model, pathname]);

  const value = useMemo(() => ({ unreadCount: enabled ? unreadCount : 0, refreshUnread: model.refresh, subscribeMessages: realtime.subscribe }), [enabled, unreadCount, model, realtime]);
  return <UnreadMessagesContext.Provider value={value}>{children}</UnreadMessagesContext.Provider>;
}

export function useUnreadMessages() {
  const value = useContext(UnreadMessagesContext);
  if (!value) throw new Error('useUnreadMessages must be used inside UnreadMessagesProvider');
  return value;
}
