import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { openRequestConversation } from '../lib/messages';
import { loadRequestConversationAssignments } from '../lib/requestConversations';
import type { RequestConversationAssignment } from '../lib/requestConversations';

type Props = { requestId: string; requestRevision: string; disabled?: boolean };
const labels = { reserved: 'Accepted assignment', released: 'Ended assignment', settled: 'Completed assignment' };

export default function RequestConversation({ requestId, requestRevision, disabled = false }: Props) {
  const { user } = useAuth();
  // Reset identity-sensitive state immediately if an account or route changes.
  return user ? <AssignmentChats key={`${user.id}:${requestId}:${requestRevision}`} userId={user.id} requestId={requestId}
    requestRevision={requestRevision} disabled={disabled} /> : null;
}

function AssignmentChats({ userId, requestId, disabled }: Props & { userId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<RequestConversationAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [openingRound, setOpeningRound] = useState<number | null>(null);
  const active = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const epoch = useRef(0);
  const generation = useRef(0);
  const reading = useRef(false);
  const opening = useRef<object | null>(null);
  const nextRound = useRef<number | null>(null);
  const currentDisabled = useRef(disabled);
  currentDisabled.current = disabled;

  const load = useCallback(async (append = false) => {
    if (!active.current || !foreground.current || reading.current || (append && nextRound.current === null)) return;
    reading.current = true;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const page = await loadRequestConversationAssignments(userId, requestId, append ? nextRound.current : null);
      if (!active.current || ticket !== generation.current) return;
      setItems(previous => append
        ? [...previous, ...page.items.filter(row => !previous.some(old => old.offer_round === row.offer_round))]
        : page.items);
      setLoaded(true); setHasMore(page.hasMore); nextRound.current = page.nextRound; setError('');
    } catch {
      if (active.current && ticket === generation.current) setError('Unable to load assignment chats. Check your connection and refresh.');
    } finally {
      if (ticket === generation.current) { reading.current = false; setLoading(false); }
    }
  }, [userId, requestId]);

  useFocusEffect(useCallback(() => {
    active.current = true; ++epoch.current;
    setItems([]); setLoaded(false); setError(''); setOpenError(''); setHasMore(false); nextRound.current = null;
    void load();
    return () => { active.current = false; ++epoch.current; ++generation.current; reading.current = false; };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (!foreground.current) { ++epoch.current; ++generation.current; reading.current = false; }
      else if (active.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const open = async (assignment: RequestConversationAssignment) => {
    if (!active.current || !foreground.current || opening.current || currentDisabled.current || reading.current
      || (assignment.poster_id !== userId && assignment.helper_id !== userId)) return;
    const operation = {};
    const focus = epoch.current;
    opening.current = operation; setOpeningRound(assignment.offer_round); setOpenError('');
    try {
      const conversationId = await openRequestConversation(userId, requestId, assignment.offer_round);
      if (active.current && foreground.current && epoch.current === focus) {
        router.push({ pathname: '/messages/[id]', params: { id: conversationId } });
      }
    } catch {
      if (active.current && foreground.current && epoch.current === focus) setOpenError('Unable to open this chat. Check your connection and try again.');
    } finally {
      if (opening.current === operation) {
        opening.current = null;
        setOpeningRound(null);
      }
    }
  };

  if (loaded && !items.length && !loading && !error) return null;
  const blocked = Boolean(disabled || loading || openingRound !== null);
  return <View style={styles.section}>
    <Text style={styles.heading}>Assignment chats</Text>
    {!!items.length && <Text style={styles.text}>Each chat is shared with that assignment’s poster and helper, and stays available after it ends.</Text>}
    {loading && <ActivityIndicator accessibilityLabel="Loading assignment chats" color="#9B1C31" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!openError && <Text accessibilityRole="alert" style={styles.error}>{openError}</Text>}
    {(loaded || !!error) && <Pressable accessibilityRole="button" style={styles.secondary} disabled={blocked}
      onPress={() => { void load(); }}><Text style={styles.secondaryText}>Refresh chats</Text></Pressable>}
    {items.map(assignment => <View key={assignment.offer_round} style={styles.card}>
      <Text style={styles.title}>{labels[assignment.status]} · Round {assignment.offer_round}</Text>
      <Pressable accessibilityRole="button" disabled={blocked} style={[styles.primary, blocked && styles.disabled]}
        onPress={() => { void open(assignment); }}>
        <Text style={styles.primaryText}>{openingRound === assignment.offer_round ? 'Opening chat…'
          : assignment.poster_id === userId ? 'Message helper' : 'Message poster'}</Text>
      </Pressable>
    </View>)}
    {hasMore && <Pressable accessibilityRole="button" style={styles.secondary} disabled={blocked}
      onPress={() => { void load(true); }}><Text style={styles.secondaryText}>Load older assignments</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 24, gap: 12 },
  heading: { color: '#2B2525', fontSize: 20, fontWeight: '800' },
  text: { color: '#8C8585', fontSize: 14, lineHeight: 21 },
  error: { color: '#9B1C31', fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 14, padding: 14, gap: 12 },
  title: { color: '#2B2525', fontSize: 15, fontWeight: '700' },
  primary: { backgroundColor: '#9B1C31', padding: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.5 },
  secondary: { borderWidth: 1, borderColor: '#E8CDCD', padding: 12, borderRadius: 12, alignItems: 'center' },
  secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 14 },
});
