import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import ScreenHeader from '../../../components/ScreenHeader';
import { useAuth } from '../../../context/AuthContext';
import { loadGroupInvitationPage, respondToGroupInvitation } from '../../../lib/groupConversations';
import type { GroupInvitationCursor, GroupInvitationSummary } from '../../../types/messaging';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#736B6B', border: '#ECE3E3', pink: '#FBECEC' };

export default function GroupInvitationsScreen() {
  const { user } = useAuth();
  return user ? <AccountInvitations key={user.id} userId={user.id.toLowerCase()} /> : null;
}

function AccountInvitations({ userId }: { userId: string }) {
  const router = useRouter();
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const busy = useRef(false);
  const pageBusy = useRef(false);
  const cursorRef = useRef<GroupInvitationCursor | null>(null);
  const hasMoreRef = useRef(false);
  const [items, setItems] = useState<GroupInvitationSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (append = false) => {
    if (!focused.current || !foreground.current || busy.current || pageBusy.current || (append && !hasMoreRef.current)) return;
    pageBusy.current = true;
    const ticket = ++generation.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const page = await loadGroupInvitationPage(userId, { limit: 20, before: append ? cursorRef.current : null });
      if (!focused.current || !foreground.current || ticket !== generation.current) return;
      setItems(previous => {
        const unique = new Map((append ? previous : []).map(item => [item.id, item]));
        page.items.forEach(item => unique.set(item.id, item));
        return [...unique.values()];
      });
      cursorRef.current = page.nextCursor;
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      setLoaded(true);
    } catch {
      if (focused.current && foreground.current && ticket === generation.current) {
        setError('Unable to load group invitations. Check your connection and try again.');
      }
    } finally {
      if (ticket === generation.current) {
        pageBusy.current = false;
      }
      if (focused.current && foreground.current && ticket === generation.current) {
        setLoading(false); setLoadingMore(false);
      }
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState === 'active';
    if (foreground.current) void load();
    return () => { focused.current = false; ++generation.current; busy.current = false; pageBusy.current = false; };
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) { ++generation.current; busy.current = false; pageBusy.current = false; setLoading(false); setLoadingMore(false); setActingId(null); }
      else if (focused.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const respond = async (item: GroupInvitationSummary, response: 'accepted' | 'declined') => {
    if (!focused.current || !foreground.current || busy.current || pageBusy.current) return;
    busy.current = true;
    const ticket = ++generation.current;
    setActingId(item.id); setError('');
    try {
      const conversationId = await respondToGroupInvitation(userId, item.id, response);
      if (!focused.current || !foreground.current || ticket !== generation.current) return;
      setItems(previous => previous.filter(candidate => candidate.id !== item.id));
      if (response === 'accepted') router.replace({ pathname: '/messages/[id]', params: { id: conversationId } });
    } catch {
      if (focused.current && foreground.current && ticket === generation.current) {
        setError('Unable to confirm that invitation response. Refresh before trying again.');
      }
    } finally {
      if (ticket === generation.current) { busy.current = false; setActingId(null); }
    }
  };
  const decline = (item: GroupInvitationSummary) => Alert.alert('Decline group invitation?',
    `You will need a new invitation to join ${item.group_title} later.`, [
      { text: 'Keep invitation', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => { void respond(item, 'declined'); } },
    ]);
  // A failed response can be an accepted/declined write whose response was
  // lost. Require a confirmed refresh before allowing any different action.
  const actionDisabled = !!actingId || loading || loadingMore || !!error;

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to messages" style={styles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/messages')}>
        <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerTitle}>Group invitations</Text>
      </Pressable>
    </ScreenHeader>
    <FlatList data={items} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading && loaded} tintColor={COLORS.primary} onRefresh={() => { void load(); }} />}
      ListHeaderComponent={error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh group invitations" accessibilityState={{ disabled: loading || !!actingId }}
          disabled={loading || !!actingId} style={[styles.outlineButton, (loading || !!actingId) && styles.disabled]}
          onPress={() => { void load(); }}><Text style={styles.outlineText}>Refresh invitations</Text></Pressable></View> : null}
      ListEmptyComponent={!loaded && loading ? <ActivityIndicator accessibilityLabel="Loading group invitations" color={COLORS.primary} style={styles.loading} />
        : loaded ? <View style={styles.empty}><Ionicons name="mail-open-outline" size={48} color={COLORS.muted} />
          <Text style={styles.emptyTitle}>No pending invitations</Text><Text style={styles.muted}>New course-group invitations will appear here.</Text></View> : null}
      renderItem={({ item }) => <View style={styles.card}>
        <View style={styles.icon}><Ionicons name="people" size={25} color={COLORS.primary} /></View>
        <View style={styles.cardBody}>
          <Text style={styles.groupTitle}>{item.group_title}</Text>
          <Text style={styles.course}>{item.course_code} · {item.course_title}</Text>
          <Text style={styles.muted}>Invited by {item.invited_by_display_name} · {item.active_member_count} active {item.active_member_count === 1 ? 'member' : 'members'}</Text>
          <View style={styles.actions}>
             <Pressable accessibilityRole="button" accessibilityLabel={`Accept invitation to ${item.group_title}`}
               accessibilityState={{ disabled: actionDisabled, busy: actingId === item.id }}
               disabled={actionDisabled} style={[styles.primaryButton, actionDisabled && styles.disabled]}
              onPress={() => { void respond(item, 'accepted'); }}>
              {actingId === item.id ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Accept</Text>}
            </Pressable>
             <Pressable accessibilityRole="button" accessibilityLabel={`Decline invitation to ${item.group_title}`}
               accessibilityState={{ disabled: actionDisabled }} disabled={actionDisabled}
               style={[styles.outlineButton, actionDisabled && styles.disabled]} onPress={() => decline(item)}>
              <Text style={styles.outlineText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      </View>}
      ListFooterComponent={hasMore ? <Pressable accessibilityRole="button" accessibilityLabel="Load more group invitations"
        accessibilityState={{ disabled: loading || loadingMore || !!actingId || !!error, busy: loadingMore }} disabled={loading || loadingMore || !!actingId || !!error}
        style={[styles.outlineButton, styles.more, (loading || loadingMore || !!actingId || !!error) && styles.disabled]} onPress={() => { void load(true); }}>
        {loadingMore ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.outlineText}>Load more invitations</Text>}
      </Pressable> : null} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, back: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  headerTitle: { color: 'white', fontSize: 20, fontWeight: '900' }, content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  notice: { gap: 10, marginBottom: 16 }, error: { color: COLORS.primary, lineHeight: 21 }, loading: { marginTop: 60 },
  empty: { flex: 1, minHeight: 360, alignItems: 'center', justifyContent: 'center', gap: 12 }, emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '900' },
  muted: { color: COLORS.muted, lineHeight: 20 }, card: { flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, marginBottom: 14 },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, cardBody: { flex: 1, gap: 5 },
  groupTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' }, course: { color: COLORS.primary, fontWeight: '800' }, actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primaryButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: 'white', fontWeight: '900' }, outlineButton: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlineText: { color: COLORS.primary, fontWeight: '800' }, disabled: { opacity: 0.5 }, more: { flex: 0, marginTop: 10 },
});
