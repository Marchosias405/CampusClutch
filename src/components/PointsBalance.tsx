import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { pointsError, readWallet, type PointsWallet } from '../lib/points';

const labels = { starter_grant: 'Welcome points', request_sent: 'Paid for completed help', request_received: 'Earned for completed help' };

export default function PointsBalance() {
  const { user } = useAuth();
  const userId = user?.id;
  const [wallet, setWallet] = useState<PointsWallet | null>(null);
  const [loadedFor, setLoadedFor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const currentUser = useRef(userId);
  currentUser.current = userId;

  const refresh = useCallback(async () => {
    if (!userId || busy.current) return;
    const ticket = ++generation.current;
    busy.current = true; setLoading(true);
    try {
      const result = await readWallet(userId);
      if (active.current && ticket === generation.current && currentUser.current === userId) {
        setWallet(result); setLoadedFor(userId); setError('');
      }
    } catch (failure) {
      if (active.current && ticket === generation.current && currentUser.current === userId) setError(pointsError(failure));
    } finally {
      if (ticket === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { active.current = false; busy.current = false; ++generation.current; clearInterval(timer); };
  }, [refresh]));

  const visible = loadedFor === userId && !error ? wallet : null;
  return <View style={styles.card}>
    <Text style={styles.heading}>Your points</Text>
    {loading && <ActivityIndicator color="#9B1C31" />}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible && <>
      <Text style={styles.balance}>{visible.available} available</Text>
      <Text style={styles.text}>{visible.reserved} reserved · {visible.balance} total points</Text>
      <Text style={styles.text}>Reserved points are held for accepted requests. They transfer to the helper when you confirm completion, or become available again if you reopen.</Text>
      <Text style={styles.heading}>Recent points activity</Text>
      {visible.history.map(entry => <View key={entry.id} style={styles.row}>
        <View style={styles.activity}>
          <Text style={styles.label}>{labels[entry.kind]}</Text>
          <Text style={styles.text}>{new Date(entry.created_at).toLocaleString()}</Text>
        </View>
        <Text style={[styles.amount, entry.amount > 0 && styles.positive]}>{entry.amount > 0 ? '+' : ''}{entry.amount}</Text>
      </View>)}
      <Text style={styles.text}>Showing your latest 20 transactions. Reservations are included in the totals above.</Text>
    </>}
    <Text style={styles.text}>Every account receives 100 welcome points once. Earn more by helping other students. Creator-made quests are planned for later.</Text>
    <Pressable accessibilityRole="button" disabled={loading} style={styles.button} onPress={() => { void refresh(); }}>
      <Text style={styles.buttonText}>{loading ? 'Refreshing…' : 'Refresh points'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 14, padding: 20, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 20, marginBottom: 20 },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' }, balance: { fontSize: 30, fontWeight: '800', color: '#9B1C31' },
  text: { color: '#635C5C', fontSize: 14, lineHeight: 21 }, error: { color: '#9B1C31', lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#ECE3E3', paddingBottom: 12 },
  activity: { flex: 1 }, label: { fontWeight: '700', color: '#2B2525', fontSize: 15 }, amount: { fontSize: 18, fontWeight: '800', color: '#9B1C31' }, positive: { color: '#287741' },
  button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' }, buttonText: { color: '#9B1C31', fontSize: 15, fontWeight: '700' },
});
