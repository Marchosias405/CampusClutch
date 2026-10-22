import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../../../components/ScreenHeader';
import { useAuth } from '../../../context/AuthContext';
import { GROUP_MESSAGING_ENABLED } from '../../../lib/messagingFeatures';
import { loadFormerGroupPage } from '../../../lib/groupConversations';
import type { ConversationCursor, GroupConversationSummary } from '../../../types/messaging';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#736B6B', border: '#ECE3E3', pink: '#FBECEC' };

export default function PastGroupsRoute() {
  if (!GROUP_MESSAGING_ENABLED) return <Redirect href="/(tabs)/messages" />;
  return <PastGroupsScreen />;
}

function PastGroupsScreen() {
  const { user } = useAuth();
  return user ? <AccountHistory key={user.id} userId={user.id.toLowerCase()} /> : null;
}

function AccountHistory({ userId }: { userId: string }) {
  const router = useRouter();
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const pageBusy = useRef(false);
  const cursorRef = useRef<ConversationCursor | null>(null);
  const hasMoreRef = useRef(false);
  const [items, setItems] = useState<GroupConversationSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (append = false) => {
    if (!focused.current || !foreground.current || pageBusy.current || (append && !hasMoreRef.current)) return;
    pageBusy.current = true;
    const ticket = ++generation.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const page = await loadFormerGroupPage(userId, { limit: 20, before: append ? cursorRef.current : null });
      if (!focused.current || !foreground.current || ticket !== generation.current) return;
      const groups = page.items.filter((item): item is GroupConversationSummary => item.type === 'group' && item.my_membership_status !== 'active');
      setItems(previous => {
        const unique = new Map((append ? previous : []).map(item => [item.id, item])); groups.forEach(item => unique.set(item.id, item)); return [...unique.values()];
      });
      cursorRef.current = page.nextCursor; hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore); setLoaded(true);
    } catch {
      if (focused.current && foreground.current && ticket === generation.current) setError('Unable to load past groups. Check your connection and try again.');
    } finally {
      if (ticket === generation.current) pageBusy.current = false;
      if (focused.current && foreground.current && ticket === generation.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    focused.current = true; foreground.current = AppState.currentState === 'active'; if (foreground.current) void load();
    return () => { focused.current = false; ++generation.current; pageBusy.current = false; };
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) { ++generation.current; pageBusy.current = false; setLoading(false); setLoadingMore(false); }
      else if (focused.current) void load();
    });
    return () => subscription.remove();
  }, [load]);
  return <View style={styles.screen}>
    <ScreenHeader><Pressable accessibilityRole="button" accessibilityLabel="Back to messages" style={styles.back}
      onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/messages')}>
      <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerTitle}>Past groups</Text>
    </Pressable></ScreenHeader>
    <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading && loaded} tintColor={COLORS.primary} onRefresh={() => { void load(); }} />}
      ListHeaderComponent={error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading past groups" accessibilityState={{ disabled: loading }}
          disabled={loading} style={[styles.button, loading && styles.disabled]} onPress={() => { void load(); }}><Text style={styles.buttonText}>Retry</Text></Pressable></View> : null}
      ListEmptyComponent={!loaded && loading ? <ActivityIndicator color={COLORS.primary} style={styles.loading} />
        : loaded ? <View style={styles.empty}><Ionicons name="archive-outline" size={48} color={COLORS.muted} /><Text style={styles.emptyTitle}>No past groups</Text>
          <Text style={styles.muted}>Groups you leave or are removed from will appear here with only your permitted history.</Text></View> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open read-only history for ${item.group_title}`} style={styles.row}
        onPress={() => router.push({ pathname: '/messages/[id]', params: { id: item.id } })}>
        <View style={styles.icon}><Ionicons name="people" size={23} color={COLORS.primary} /></View>
        <View style={styles.body}><Text style={styles.name}>{item.group_title}</Text><Text style={styles.course}>{item.group_course_code} · Read-only history</Text>
          <Text numberOfLines={2} style={styles.muted}>{item.last_message_body || 'No messages from your membership period'}</Text></View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
      </Pressable>}
      ListFooterComponent={hasMore ? <Pressable accessibilityRole="button" accessibilityLabel="Load more past groups"
        accessibilityState={{ disabled: loading || loadingMore, busy: loadingMore }} disabled={loading || loadingMore}
        style={[styles.button, (loading || loadingMore) && styles.disabled]} onPress={() => { void load(true); }}>
        {loadingMore ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.buttonText}>Load more groups</Text>}</Pressable> : null} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, back: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 }, headerTitle: { color: 'white', fontSize: 20, fontWeight: '900' },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 }, notice: { gap: 10, marginBottom: 14 }, error: { color: COLORS.primary, lineHeight: 21 }, loading: { marginTop: 60 },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 }, emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  muted: { color: COLORS.muted, lineHeight: 20 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: COLORS.border },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, body: { flex: 1, gap: 4 }, name: { color: COLORS.text, fontSize: 17, fontWeight: '900' }, course: { color: COLORS.primary, fontSize: 13, fontWeight: '800' },
  button: { minHeight: 44, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 14 }, buttonText: { color: COLORS.primary, fontWeight: '800' }, disabled: { opacity: 0.5 },
});
