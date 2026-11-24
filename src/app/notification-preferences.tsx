import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { actionButton, actionButtonText } from '../constants/actionStyles';
import { useAuth } from '../context/AuthContext';
import { androidPushToken } from '../lib/androidPush';
import { loadPushSettings, savePushDevice, savePushPreference } from '../lib/notifications';
import type { PushPreference, PushSettings } from '../lib/notifications';

const labels: [PushPreference, string][] = [
  ['push_enabled', 'Allow push notifications'], ['messages', 'Direct messages'],
  ['offers', 'Offers and decisions'], ['request_updates', 'Request updates'],
];
export default function NotificationPreferences() {
  const { user } = useAuth();
  return user ? <Preferences key={user.id} userId={user.id} /> : null;
}
function Preferences({ userId }: { userId: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const active = useRef(false);
  const locked = useRef(false);
  const run = useCallback(async (action: () => Promise<PushSettings>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); setDenied(false);
    try {
      const result = await action();
      if (active.current) setSettings(result);
    } catch {
      if (active.current) setError('Could not confirm your push settings. Check your connection and retry.');
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }, []);
  const reload = useCallback(() => run(() => loadPushSettings(userId)), [run, userId]);
  useEffect(() => { active.current = true; void reload(); return () => { active.current = false; }; }, [reload]);
  const connect = () => run(async () => {
    if (settings?.registered) return savePushDevice(userId, null);
    const token = await androidPushToken(true);
    if (!active.current) throw new Error('Screen closed');
    if (!token) { setDenied(true); return loadPushSettings(userId); }
    return savePushDevice(userId, token);
  });
  return <View style={styles.page}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/notifications')} style={styles.back} accessibilityLabel="Back">
        <Text style={styles.white}>‹ Back</Text>
      </Pressable><Text style={styles.title}>Push notifications</Text>
    </ScreenHeader>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Alerts outside the app</Text>
      <Text style={styles.body}>Choose push alerts for your account. Updates stay in your bell inbox.</Text>
      {settings && <>
        {labels.map(([key, label]) => <View key={key} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Switch accessibilityLabel={label} value={settings[key]} disabled={busy || (key !== 'push_enabled' && !settings.push_enabled)}
            onValueChange={enabled => void run(() => savePushPreference(userId, key, enabled))}
            trackColor={{ true: '#B96477' }} />
        </View>)}
        {Platform.OS === 'android' && <View style={styles.device}>
          <Text style={styles.heading}>This device</Text>
          <Text style={styles.body}>{settings.registered ? 'Connected for push notifications.' :
            'Connect to get alerts outside the app. Android will ask permission if needed.'}</Text>
          <Pressable accessibilityRole="button" disabled={busy || (!settings.push_enabled && !settings.registered)} onPress={connect} style={styles.actionButton} accessibilityState={{ disabled: busy || (!settings.push_enabled && !settings.registered), busy }}>
            <Text style={styles.action}>{settings.registered ? 'Disconnect this device' : 'Connect this device'}</Text>
          </Pressable>
        </View>}
      </>}
      {busy && <ActivityIndicator color="#9B1C31" />}
      {denied && <View style={styles.device}>
        <Text style={styles.body}>Allow notifications in Android settings, then connect again.</Text>
        <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.actionButton}>
          <Text style={styles.action}>Open Android settings</Text>
        </Pressable>
      </View>}
      {!!error && <View><Text accessibilityRole="alert" style={styles.body}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={reload} style={styles.actionButton} disabled={busy} accessibilityState={{ disabled: busy }}><Text style={styles.action}>Reload settings</Text></Pressable></View>}
    </ScrollView></View>;
}
const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:'white'}, content:{padding:20,gap:14,paddingBottom:48},
  back:{padding:8,minWidth:48,minHeight:48,justifyContent:'center'},white:{color:'white',fontWeight:'700'},title:{color:'white',fontWeight:'800',fontSize:20,flex:1,marginLeft:8},
  heading:{fontSize:20,fontWeight:'800',color:'#2B2525'},body:{fontSize:15,lineHeight:22,color:'#635B5D'},
  row:{minHeight:50,flexDirection:'row',gap:12,alignItems:'center',borderBottomWidth:1,borderColor:'#EFE1E1'},
  label:{flex:1,fontSize:16,color:'#2B2525',fontWeight:'600'},device:{gap:8,marginTop:10},
  actionButton:actionButton,
  action:actionButtonText,
});
