import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import BlockStudentControl from '../../components/BlockStudentControl';
import { useAuth } from '../../context/AuthContext';
import { getMyBlockedStudents } from '../../lib/studentBlocks';
import type { BlockedStudent } from '../../lib/studentBlocks';

export default function BlockedStudentsScreen() {
  const { user } = useAuth();
  return user ? <BlockedStudents key={user.id} userId={user.id} /> : null;
}
function BlockedStudents({ userId }: { userId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<BlockedStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const offset = useRef(0);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const epoch = useRef(0);
  const fetching = useRef(false);
  const retryMore = useRef(false);
  const load = useCallback(async (more = false) => {
    if (!focused.current || !foreground.current || fetching.current) return;
    const ticket = ++epoch.current;
    const start = more ? offset.current : 0;
    fetching.current = true;
    retryMore.current = more;
    setLoading(true); setError('');
    try {
      const rows = await getMyBlockedStudents(userId, start);
      if (ticket !== epoch.current || !focused.current || !foreground.current) return;
      setItems(previous => more
        ? [...previous, ...rows.filter(row => !previous.some(item => item.profile_id === row.profile_id))] : rows);
      offset.current = start + rows.length;
      setHasMore(rows.length === 20);
    } catch {
      if (ticket === epoch.current && focused.current && foreground.current) {
        setError('Unable to load blocked students. Check your connection and retry.');
      }
    } finally {
      if (ticket === epoch.current) { fetching.current = false; setLoading(false); }
    }
  }, [userId]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    return () => { focused.current = false; ++epoch.current; fetching.current = false; };
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      ++epoch.current; fetching.current = false;
      if (focused.current && foreground.current) void load();
    });
    return () => subscription.remove();
  }, [load]);
  return <View style={styles.page}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back from blocked students" style={styles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </Pressable>
      <Text style={styles.header}>Blocked students</Text>
    </ScreenHeader>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 20) }]}>
      <Text style={styles.body}>Blocking stops new messages and offers between you. Jobs and points stay unchanged.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh blocked students" style={styles.button}
        disabled={loading} accessibilityState={{ disabled: loading, busy: loading }} onPress={() => void load()}>
        <Text style={styles.buttonText}>Refresh</Text>
      </Pressable>
      {items.map(item => <View key={item.profile_id} style={styles.card}>
        <Text accessibilityRole="header" style={styles.name}>{item.display_name || 'Student'}</Text>
        <BlockStudentControl userId={userId} profileId={item.profile_id} displayName={item.display_name}
          onChanged={() => { void load(); }} />
      </View>)}
      {loading && <View style={styles.loading}><ActivityIndicator color={PRIMARY} /><Text style={styles.body}>Loading blocked students…</Text></View>}
      {!!error && <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" style={styles.button} disabled={loading}
          onPress={() => void load(retryMore.current)}><Text style={styles.buttonText}>Retry loading blocked students</Text></Pressable>
      </View>}
      {!loading && !error && !items.length && <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.name}>No blocked students</Text>
        <Text style={styles.body}>Students you block from their profile will appear here.</Text>
      </View>}
      {!error && hasMore && <Pressable accessibilityRole="button" style={styles.button} disabled={loading}
        accessibilityState={{ disabled: loading }} onPress={() => void load(true)}>
        <Text style={styles.buttonText}>Load more blocked students</Text>
      </Pressable>}
    </ScrollView>
  </View>;
}
const PRIMARY = '#9B1C31';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FFFFFF' },
  back: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  header: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  content: { padding: 20, gap: 16 },
  body: { fontSize: 15, color: '#635C5C', lineHeight: 22 },
  name: { fontSize: 20, fontWeight: '800', color: '#2B2525' },
  card: { borderWidth: 1, borderColor: '#EFE1E1', borderRadius: 18, padding: 18, gap: 12 },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: PRIMARY, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  loading: { gap: 12, alignItems: 'center' },
  error: { color: PRIMARY, fontSize: 15, lineHeight: 22 },
});
