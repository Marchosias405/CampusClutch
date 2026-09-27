import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import { useAuth } from '../../context/AuthContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import { createConversationInbox } from '../../lib/conversationInbox';
import { loadConversationPage } from '../../lib/messages';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#736B6B', border: '#ECE3E3', pink: '#FBECEC' };

export default function MessagesInboxScreen() {
  const { user } = useAuth();
  return user ? <AccountInbox key={user.id} userId={user.id} /> : null;
}

function AccountInbox({ userId }: { userId: string }) {
  const router = useRouter();
  const { unreadCount, refreshUnread } = useUnreadMessages();
  const model = useMemo(() => createConversationInbox(async before => {
    const page = await loadConversationPage(userId, { before });
    void refreshUnread();
    return page;
  }), [userId, refreshUnread]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const focused = useRef(false);
  const [search, setSearch] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const previousUnreadCount = useRef(unreadCount);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    model.setActive(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    return () => { focused.current = false; model.setActive(false); };
  }, [model]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => model.setActive(focused.current && next === 'active'));
    return () => subscription.remove();
  }, [model]);
  useEffect(() => {
    if (previousUnreadCount.current === unreadCount || state.loading) return;
    previousUnreadCount.current = unreadCount;
    // The tab also polls while this screen is open. Refresh its rows when that
    // total changes, waiting for any current page load rather than dropping it.
    void model.refresh();
  }, [model, unreadCount, state.loading]);

  const query = search.trim().toLocaleLowerCase();
  const visible = state.items.filter(item => (!unreadOnly || item.unread_count > 0)
    && (!query || `${item.other_display_name ?? ''} ${item.last_message_body ?? ''}`.toLocaleLowerCase().includes(query)));
  const findClassmates = () => router.push('/(tabs)/courses');
  const emptyText = state.items.length ? 'No conversations match this view.' : 'No conversations yet. Message a classmate, contact a request’s poster, or reply to a helper from their offer.';

  return <View style={styles.screen}>
    <ScreenHeader>
      <Text style={styles.title}>Messages</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Find classmates to message" style={styles.headerButton} onPress={findClassmates}>
        <Ionicons name="create-outline" size={24} color="white" />
      </Pressable>
    </ScreenHeader>
    <FlatList
      data={visible}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={state.loading && state.loaded} onRefresh={() => { void model.refresh(); }} tintColor={COLORS.primary} />}
      ListHeaderComponent={<>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={COLORS.muted} />
          <TextInput accessibilityLabel="Search loaded conversations" value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={COLORS.muted} style={styles.searchInput} autoCorrect={false} returnKeyType="search" />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear conversation search" style={styles.clear} onPress={() => setSearch('')}><Ionicons name="close-circle" size={20} color={COLORS.muted} /></Pressable>}
        </View>
        <View style={styles.filters}>
          {[false, true].map(unread => <Pressable key={String(unread)} accessibilityRole="button" accessibilityState={{ selected: unreadOnly === unread }} onPress={() => setUnreadOnly(unread)} style={[styles.filter, unreadOnly === unread && styles.selected]}>
            <Text style={[styles.filterText, unreadOnly === unread && styles.selectedText]}>{unread ? 'Unread' : 'All'}</Text>
          </Pressable>)}
          <Pressable accessibilityRole="button" disabled={state.loading} accessibilityState={{ disabled: state.loading }} style={[styles.refresh, state.loading && styles.disabled]} onPress={() => { void model.refresh(); }}>
            <Text style={styles.filterText}>{state.loading ? 'Refreshing…' : 'Refresh'}</Text>
          </Pressable>
        </View>
        {!!state.error && <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
          {state.loaded && <Text style={styles.muted}>Showing the last loaded conversations.</Text>}
          <Pressable accessibilityRole="button" disabled={state.loading} style={styles.button} onPress={() => { void model.refresh(); }}><Text style={styles.filterText}>Retry</Text></Pressable>
        </View>}
        {state.loading && !state.loaded && <ActivityIndicator color={COLORS.primary} accessibilityLabel="Loading conversations" style={styles.loading} />}
      </>}
      ListEmptyComponent={state.loaded && !state.error ? <View style={styles.notice}>
        <Text style={styles.muted}>{emptyText}</Text>
        {!state.items.length && <Pressable accessibilityRole="button" style={styles.button} onPress={findClassmates}><Text style={styles.filterText}>Find classmates</Text></Pressable>}
      </View> : null}
      renderItem={({ item }) => {
        const name = item.other_display_name || 'CampusClutch member';
        const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        const unread = item.unread_count > 0;
        return <Pressable accessibilityRole="button" accessibilityLabel={`${name}${unread ? `, ${item.unread_count} unread messages` : ''}`} style={styles.row} onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}>
          <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>
          <View style={styles.body}>
            <View style={styles.topRow}>
              <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>{name}</Text>
              <Text style={styles.time}>{new Date(item.last_activity_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
            </View>
            <Text style={[styles.preview, unread && styles.bold]} numberOfLines={2}>{item.last_message_body || 'Say hello'}</Text>
            {item.status === 'closed' && <Text style={styles.muted}>Read-only conversation</Text>}
          </View>
          {unread && <View style={styles.unread}><Text style={styles.unreadText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text></View>}
        </Pressable>;
      }}
      ListFooterComponent={state.cursor ? <View style={styles.footer}>
        {(!!query || unreadOnly) && <Text style={styles.muted}>Load more to include older conversations in this view.</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: state.loading }} disabled={state.loading} style={[styles.button, state.loading && styles.disabled]} onPress={() => { void model.refresh(true); }}><Text style={styles.filterText}>{state.loading ? 'Loading…' : 'Load more conversations'}</Text></Pressable>
      </View> : null}
    />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, title: { color: 'white', fontWeight: '900', fontSize: 20 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 36 }, search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F0F0', borderRadius: 13, paddingLeft: 14 },
  searchInput: { flex: 1, minHeight: 48, color: COLORS.text, fontSize: 15 }, clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginVertical: 18 },
  filter: { minHeight: 44, paddingHorizontal: 18, borderRadius: 24, borderWidth: 1, borderColor: COLORS.primary, justifyContent: 'center' },
  selected: { backgroundColor: COLORS.primary }, filterText: { color: COLORS.primary, fontWeight: '700', fontSize: 14 }, selectedText: { color: 'white' },
  refresh: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', marginLeft: 'auto' }, disabled: { opacity: 0.5 },
  notice: { gap: 12, marginBottom: 16 }, error: { color: COLORS.primary, lineHeight: 22 }, muted: { color: COLORS.muted, fontSize: 14, lineHeight: 21 },
  button: { minHeight: 44, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' }, loading: { marginVertical: 20 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, initials: { color: COLORS.primary, fontWeight: '800', fontSize: 17 },
  body: { flex: 1 }, topRow: { flexDirection: 'row', gap: 8, marginBottom: 6, alignItems: 'center' }, name: { flex: 1, color: COLORS.text, fontSize: 16, fontWeight: '600' },
  bold: { fontWeight: '800' }, time: { color: COLORS.muted, fontSize: 12 }, preview: { color: COLORS.muted, fontSize: 14, lineHeight: 20 },
  unread: { minWidth: 24, padding: 5, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: 'center' }, unreadText: { color: 'white', fontSize: 11, fontWeight: '800' },
  footer: { gap: 12, marginTop: 20 },
});
