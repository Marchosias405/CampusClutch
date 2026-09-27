import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { loadRequestContact, startRequestContactConversation } from '../lib/requestContacts';

type Props = { requestId: string; profileId: string; role: 'poster' | 'helper'; revision?: string; compact?: boolean };
type Contact = Awaited<ReturnType<typeof loadRequestContact>>;

export default function RequestContact(props: Props) {
  const { user } = useAuth();
  return user && user.id !== props.profileId ? <ContactCard key={`${user.id}:${props.requestId}:${props.profileId}:${props.revision ?? ''}`}
    {...props} userId={user.id} /> : null;
}

function ContactCard({ userId, requestId, profileId, role, compact = false }: Props & { userId: string }) {
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [openError, setOpenError] = useState('');
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const epoch = useRef(0);
  const reading = useRef<object | null>(null);
  const openingOperation = useRef<object | null>(null);

  const load = useCallback(async () => {
    if (!focused.current || !foreground.current || reading.current) return;
    const operation = {};
    const started = epoch.current;
    reading.current = operation; setLoading(true); setError('');
    try {
      const result = await loadRequestContact(userId, requestId, profileId);
      if (focused.current && foreground.current && epoch.current === started) setContact(result);
    } catch {
      if (focused.current && foreground.current && epoch.current === started) {
        setContact(null);
        setError('Unable to load this contact. Check your connection or refresh the request.');
      }
    } finally {
      if (reading.current === operation) { reading.current = null; setLoading(false); }
    }
  }, [userId, requestId, profileId]);

  useFocusEffect(useCallback(() => {
    focused.current = true; foreground.current = AppState.currentState === 'active'; ++epoch.current;
    setContact(null); setOpenError(''); void load();
    return () => {
      focused.current = false; ++epoch.current; reading.current = null;
      openingOperation.current = null; setOpening(false);
    };
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) {
        ++epoch.current; reading.current = null;
        openingOperation.current = null; setOpening(false);
      }
      else if (focused.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const open = async () => {
    if (!focused.current || !foreground.current || reading.current || openingOperation.current || !contact) return;
    const operation = {};
    const started = epoch.current;
    openingOperation.current = operation; setOpening(true); setOpenError('');
    try {
      const conversationId = await startRequestContactConversation(userId, requestId, profileId);
      if (focused.current && foreground.current && epoch.current === started) {
        router.push({ pathname: '/messages/[id]', params: { id: conversationId } });
      }
    } catch {
      if (focused.current && foreground.current && epoch.current === started) setOpenError('Unable to open this chat. Check your connection and try again.');
    } finally {
      if (openingOperation.current === operation) { openingOperation.current = null; setOpening(false); }
    }
  };

  const disabled = loading || opening || !contact;
  return <View style={styles.content}>
    {!compact && <Text style={styles.title}>{role === 'poster' ? 'Request poster' : 'Helper'}</Text>}
    {loading && <ActivityIndicator accessibilityLabel={`Loading ${role} contact`} color="#9B1C31" />}
    {contact && !compact && <>
      <Text style={styles.name}>{contact.displayName}</Text>
      <Text style={styles.description}>{[contact.major, contact.yearOfStudy ? `Year ${contact.yearOfStudy}` : null, contact.campusDisplayName].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.description}>You can ask questions here before offering help.</Text>
    </>}
    {!!error && <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" disabled={loading || opening} style={styles.button} onPress={() => { void load(); }}><Text style={styles.buttonText}>Retry contact</Text></Pressable>
    </>}
    {!!openError && <Text accessibilityRole="alert" style={styles.error}>{openError}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.button, disabled && styles.disabled]}
      onPress={() => { void open(); }}><Text style={styles.buttonText}>{opening ? 'Opening chat…' : role === 'poster' ? 'Message poster' : 'Message helper'}</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 12 }, title: { color: '#2B2525', fontWeight: '800', fontSize: 18 },
  name: { color: '#2B2525', fontWeight: '700', fontSize: 16 }, description: { color: '#635C5C', fontSize: 15, lineHeight: 22 },
  error: { color: '#9B1C31', lineHeight: 22 }, button: { borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, minHeight: 44, padding: 12, alignItems: 'center' },
  buttonText: { color: '#9B1C31', fontWeight: '700', fontSize: 15 }, disabled: { opacity: .45 },
});
