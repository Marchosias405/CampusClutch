import { LoadingSkeleton, LoadingNotice } from '@/components/LoadingState';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { pointsError, readWallet, type PointsWallet } from '../lib/points';
import ProfileActionRow from './ProfileActionRow';
import DetailsDisclosure from './DetailsDisclosure';

const labels = { starter_grant: 'Welcome points', balance_restored: 'Restored balance', request_sent: 'Paid for completed help', request_received: 'Earned for completed help' };

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
    {loading && !error && (visible ? <LoadingNotice label="Refreshing points" /> : <LoadingSkeleton variant="points" label="Loading your points" />)}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {visible && <>
      <Text style={styles.balance}>{visible.available} available</Text>
      <View style={styles.balanceDetails}>
        <View style={styles.balanceDetail} accessible accessibilityLabel={`${visible.reserved} reserved points`}>
          <Text style={styles.detailValue}>{visible.reserved}</Text>
          <Text style={styles.text}>Reserved</Text>
        </View>
        <View style={styles.balanceDetail} accessible accessibilityLabel={`${visible.balance} total points`}>
          <Text style={styles.detailValue}>{visible.balance}</Text>
          <Text style={styles.text}>Total points</Text>
        </View>
      </View>
      <Text style={styles.heading}>Recent activity</Text>
      {visible.history.map(entry => <View key={entry.id} style={styles.row}>
        <View style={styles.activity}>
          <Text style={styles.label}>{labels[entry.kind]}</Text>
          <Text style={styles.text}>{new Date(entry.created_at).toLocaleString()}</Text>
        </View>
        <Text style={[styles.amount, entry.amount > 0 && styles.positive]}>{entry.amount > 0 ? '+' : ''}{entry.amount}</Text>
      </View>)}
      {visible.history.length >= 20 && <Text style={styles.text}>Latest 20 transactions.</Text>}
    </>}
    <DetailsDisclosure title="How points work">
      <Text style={styles.text}>Earn points by helping students. Accepted requests reserve the poster’s points. The helper is paid when the poster confirms completion.</Text>
      <Text style={styles.text}>Reopening or cancelling releases reserved points.</Text>
      <Text style={styles.text}>Each verified email gets 100 welcome points once. If you delete your account, verify the same email again to restore your remaining points.</Text>
    </DetailsDisclosure>
    <ProfileActionRow label={loading ? 'Refreshing…' : 'Refresh points'} icon="refresh-outline"
      busy={loading} disabled={loading} chevron={false} onPress={() => { void refresh(); }} />
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 14, padding: 20, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 20, marginBottom: 20 },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' }, balance: { fontSize: 30, fontWeight: '800', color: '#9B1C31' },
  balanceDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  balanceDetail: { flex: 1, minWidth: 100, gap: 2 },
  detailValue: { fontSize: 18, fontWeight: '700', color: '#2B2525' },
  text: { color: '#635C5C', fontSize: 14, lineHeight: 21 }, error: { color: '#9B1C31', lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#ECE3E3', paddingBottom: 12 },
  activity: { flexGrow: 1, flexShrink: 1, flexBasis: 150 }, label: { fontWeight: '700', color: '#2B2525', fontSize: 15 }, amount: { fontSize: 18, fontWeight: '800', color: '#9B1C31' }, positive: { color: '#287741' },
});
