import { LoadingSkeleton } from '@/components/LoadingState';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { createNotificationInbox } from '../lib/notificationInbox';
import { getNotificationTarget } from '../lib/notifications';
import type { NotificationItem } from '../types/notifications';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#635C5C', border: '#ECE3E3', pink: '#FBECEC' };

export default function NotificationsScreen() {
  const { user } = useAuth();
  return user ? <AccountNotifications key={user.id} userId={user.id} /> : null;
}

function AccountNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUnread, subscribeNotifications } = useNotifications();
  const model = useMemo(() => createNotificationInbox(userId), [userId]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const navigationTicket = useRef(0);
  const opening = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState === 'active';
    model.setActive(foreground.current);
    void refreshUnread();
    return () => {
      focused.current = false;
      ++navigationTicket.current;
      opening.current = false;
      setOpeningId(null);
      model.setActive(false);
    };
  }, [model, refreshUnread]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      model.setActive(focused.current && foreground.current);
      if (!foreground.current) { ++navigationTicket.current; opening.current = false; setOpeningId(null); }
    });
    return () => subscription.remove();
  }, [model]);
  useEffect(() => subscribeNotifications(() => { void model.invalidate(); }), [model, subscribeNotifications]);

  const refresh = () => {
    setNavigationError(null);
    void model.refresh();
    void refreshUnread();
  };
  const openNotification = async (item: NotificationItem) => {
    if (opening.current || !focused.current || !foreground.current) return;
    const target = getNotificationTarget(item);
    opening.current = true;
    setOpeningId(item.id);
    setNavigationError(null);
    const ticket = ++navigationTicket.current;
    // A failed read update remains visible and retryable. Do not silently claim it saved.
    const confirmed = await model.markRead(item.id);
    if (ticket !== navigationTicket.current || !focused.current || !foreground.current) return;
    opening.current = false;
    setOpeningId(null);
    void refreshUnread();
    if (confirmed && target) router.push(target);
    else if (confirmed) setNavigationError('This notification was marked read. Its related item is no longer available.');
  };
  const markAllRead = async () => {
    await model.markAllRead();
    void refreshUnread();
  };
  const busy = state.markingAllRead || state.mutatingIds.length > 0;

  return <View style={styles.screen}>
    <ScreenHeader>
      <View style={styles.heading}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Push notification settings" style={styles.headerButton}
        onPress={() => router.push('/notification-preferences')}>
        <Ionicons name="settings-outline" size={23} color="white" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh notifications" style={styles.headerButton}
        disabled={state.loading || state.refreshing} accessibilityState={{ disabled: state.loading || state.refreshing }} onPress={refresh}>
        <Ionicons name="refresh" size={24} color="white" />
      </Pressable>
    </ScreenHeader>
    <FlatList
      data={state.items} keyExtractor={item => item.id}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={refresh} tintColor={COLORS.primary} />}
      ListHeaderComponent={<>
        <View style={styles.toolbar}>
          <Text accessibilityLiveRegion="polite" style={styles.count}>{state.unreadCount} unread</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications read"
            disabled={!state.loaded || busy || state.unreadCount === 0}
            accessibilityState={{ disabled: !state.loaded || busy || state.unreadCount === 0, busy: state.markingAllRead }}
            style={[styles.textButton, (!state.loaded || busy || state.unreadCount === 0) && styles.disabled]}
            onPress={() => { void markAllRead(); }}>
            <Text style={styles.action}>{state.markingAllRead ? 'Saving…' : 'Mark all read'}</Text>
          </Pressable>
        </View>
        {!!(state.error || navigationError) && <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.error}>{navigationError || state.error}</Text>
          {state.items.length > 0 && <Text style={styles.muted}>Showing your last loaded notifications.</Text>}
          <Pressable accessibilityRole="button" disabled={state.loading || state.refreshing}
            style={styles.retry} onPress={refresh}><Text style={styles.action}>Retry</Text></Pressable>
        </View>}
        {state.loading && !state.loaded && state.items.length === 0 && !state.error && !navigationError && <LoadingSkeleton variant="inbox" label="Loading notifications" rows={4} style={styles.loading} />}
      </>}
      ListEmptyComponent={state.loaded && !state.error ? <View style={styles.empty}>
        <Ionicons name="notifications-outline" size={36} color={COLORS.primary} />
        <Text style={styles.emptyTitle}>You’re all caught up</Text>
        <Text style={styles.emptyBody}>Help offers, request updates, messages and account warnings will appear here.</Text>
      </View> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.body}${item.read_at ? '' : '. Unread'}`}
        disabled={busy || openingId !== null} accessibilityState={{ disabled: busy || openingId !== null, busy: openingId === item.id }}
        style={[styles.row, !item.read_at && styles.unreadRow]}
        onPress={() => { void openNotification(item); }}>
        <View style={styles.icon}>
          <Ionicons name={item.navigation_key === 'account_notice' ? 'alert-circle-outline' : item.navigation_key === 'conversation' ? 'chatbubble-outline' : 'list-outline'} size={22} color={COLORS.primary} />
        </View>
        <View style={styles.body}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.bodyText}>{item.body}</Text>
          <Text style={styles.time}>{new Date(item.created_at.replace(/\.\d+/, fraction => fraction.slice(0, 4))).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
          <Text style={styles.actionHint}>{item.navigation_key === 'account_notice' ? 'View decision & warning count'
            : !getNotificationTarget(item) ? 'No longer available' : item.navigation_key === 'conversation' ? 'Open conversation' : 'View request'}</Text>
        </View>
        {openingId === item.id ? <ActivityIndicator color={COLORS.primary} />
          : !item.read_at ? <View style={styles.unreadDot} /> : <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />}
      </Pressable>}
      ListFooterComponent={state.hasMore ? <Pressable accessibilityRole="button"
        disabled={state.loadingMore || state.refreshing || state.loading || busy}
        style={[styles.loadMore, (state.loadingMore || busy) && styles.disabled]}
        onPress={() => { void model.loadMore(); }}><Text style={styles.action}>{state.loadingMore ? 'Loading…' : 'Load older notifications'}</Text></Pressable> : null}
    />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, heading: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  title: { color: 'white', fontSize: 20, fontWeight: '900', flexShrink: 1 },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  count: { color: COLORS.text, fontSize: 16, fontWeight: '800' }, textButton: { minHeight: 48, paddingHorizontal: 8, justifyContent: 'center' },
  action: { color: COLORS.primary, fontWeight: '800', fontSize: 14 }, disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  unreadRow: { backgroundColor: COLORS.pink }, icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F4E3E5', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 }, rowTitle: { color: COLORS.text, fontWeight: '800', fontSize: 15, lineHeight: 21 },
  bodyText: { color: COLORS.text, fontSize: 14, lineHeight: 21, marginTop: 4 }, time: { color: COLORS.muted, fontSize: 12, marginTop: 7 },
  actionHint: { color: COLORS.primary, fontSize: 12, fontWeight: '700', marginTop: 8 }, unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.primary },
  notice: { gap: 10, marginBottom: 18 }, error: { color: COLORS.primary, lineHeight: 22 }, muted: { color: COLORS.muted, lineHeight: 20 },
  retry: { alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 10 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 40 }, emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800' },
  emptyBody: { color: COLORS.muted, fontSize: 15, lineHeight: 23, textAlign: 'center', maxWidth: 320 },
  loading: { marginVertical: 28 }, loadMore: { alignItems: 'center', justifyContent: 'center', minHeight: 48, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, marginTop: 12 },
});
