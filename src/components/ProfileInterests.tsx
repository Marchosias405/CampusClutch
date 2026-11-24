import { LoadingSkeleton, LoadingNotice } from '@/components/LoadingState';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getProfileInterests } from '@/lib/profiles';
import type { Interest } from '@/types';

// The caller keys this card by account so old selections never flash for another account.
export default function ProfileInterests({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError(false);
    getProfileInterests(profileId).then(items => { if (active) { setInterests(items); setLoadedFor(profileId); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // The retry counter deliberately restarts this focus-scoped read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, retry]));

  const loaded = loadedFor === profileId;
  return <View style={styles.card}>
    <View style={styles.headingRow}>
      <Text accessibilityRole="header" style={styles.title}>Interests</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit your interests" onPress={() => router.push('/profile/settings')}
        style={styles.button}><Text style={styles.action}>Edit</Text></Pressable>
    </View>
    {loading && !error && (loaded ? <LoadingNotice label="Refreshing interests" /> : <LoadingSkeleton variant="interests" label="Loading your interests" />)}
    {error ? <>
      <Text accessibilityLiveRegion="polite" style={styles.hint}>Unable to load your interests.</Text>
      <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.button}>
        <Text style={styles.action}>Retry interests</Text>
      </Pressable>
    </> : loaded && (interests.length ? <View style={styles.tags}>{interests.map(item => <View key={item.id} style={styles.tag}>
      <Text style={styles.tagText}>{item.displayName}</Text>
    </View>)}</View> : <Text style={styles.hint}>Add a few favorites to help classmates get to know you.</Text>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 18, borderWidth: 1, borderColor: '#E8DDDF', borderRadius: 20, marginBottom: 18, gap: 10 },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#2B2525', fontSize: 18, fontWeight: '800', flexShrink: 1 },
  button: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  action: { color: '#9B1C31', fontSize: 15, fontWeight: '700' },
  hint: { color: '#746B6E', fontSize: 14, lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#F7E7EA', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9, maxWidth: '100%' },
  tagText: { color: '#9B1C31', fontWeight: '600', fontSize: 14 },
});
