import { usePathname } from 'expo-router';
import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { loadUnreadMessageCount } from '../lib/messages';
import { createUnreadMessages } from '../lib/unreadMessages';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';

type Value = { unreadCount: number; refreshUnread: () => Promise<void> };
const UnreadMessagesContext = createContext<Value | undefined>(undefined);

export function UnreadMessagesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { profile, isProfileComplete } = useProfile();
  const userId = user?.id;
  const pathname = usePathname();
  // New account = new store and a zero badge on the very first render.
  const model = useMemo(() => createUnreadMessages(() => userId ? loadUnreadMessageCount(userId) : Promise.resolve(0)), [userId]);
  const unreadCount = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const enabled = !!userId && profile?.id === userId && isProfileComplete;

  useEffect(() => {
    model.setActive(enabled && AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', next => model.setActive(enabled && next === 'active'));
    // Until realtime subscriptions are introduced, update the tab while another
    // screen is open too. The store suppresses network calls in the background.
    const timer = enabled ? setInterval(() => { void model.refresh(); }, 30000) : undefined;
    return () => { subscription.remove(); clearInterval(timer); model.setActive(false); };
  }, [enabled, model]);
  useEffect(() => { void model.refresh(); }, [model, pathname]);

  const value = useMemo(() => ({ unreadCount: enabled ? unreadCount : 0, refreshUnread: model.refresh }), [enabled, unreadCount, model]);
  return <UnreadMessagesContext.Provider value={value}>{children}</UnreadMessagesContext.Provider>;
}

export function useUnreadMessages() {
  const value = useContext(UnreadMessagesContext);
  if (!value) throw new Error('useUnreadMessages must be used inside UnreadMessagesProvider');
  return value;
}
