import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRequests } from '../context/RequestsContext';
import { offerError, reopenRequest } from '../lib/offers';
import type { CampusRequest } from '../types';

type Props = { request: CampusRequest; disabled?: boolean; onChanged: () => Promise<void> };

function initialDeadline(deadlineAt?: string) {
  const existing = new Date(deadlineAt ?? '');
  const date = existing.getTime() > Date.now() ? existing : new Date();
  if (!(existing.getTime() > Date.now())) date.setDate(date.getDate() + 1);
  date.setHours(23, 59, 59, 999);
  return date;
}

function dateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ReopenRequest({ request, disabled = false, onChanged }: Props) {
  const { user } = useAuth();
  const { invalidate } = useRequests();
  const userId = user?.id;
  const expectedRound = request.offerRound ?? 1;
  const scope = `${userId}:${request.id}:${expectedRound}`;
  const [deadline, setDeadline] = useState(() => initialDeadline(request.deadlineAt));
  const [dateText, setDateText] = useState(() => dateInputValue(initialDeadline(request.deadlineAt)));
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const mutation = useRef(false);
  const current = useRef({ scope, request, disabled, onChanged });
  current.current = { scope, request, disabled, onChanged };

  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []));

  const eligible = request.ownerId === userId && (request.status === 'open' || request.status === 'accepted');
  const pending = saving || disabled;

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    setDeadline(endOfDay); setDateText(dateInputValue(endOfDay)); setError('');
  };

  const perform = async (deadlineIso: string) => {
    const latest = current.current;
    if (!userId || mutation.current || !active.current || latest.scope !== scope || latest.disabled
      || latest.request.ownerId !== userId || !['open', 'accepted'].includes(latest.request.status ?? '')) return;
    mutation.current = true; setSaving(true); setError(''); setNotice('');
    try {
      await reopenRequest(userId, request.id, expectedRound, deadlineIso);
      invalidate();
      if (active.current && current.current.scope === scope) {
        setNotice('Your request is open for new offers. Helpers can offer again.');
        await current.current.onChanged();
      }
    } catch (failure) {
      if (active.current && current.current.scope === scope) setError(offerError(failure));
    } finally {
      mutation.current = false;
      if (active.current && current.current.scope === scope) setSaving(false);
    }
  };

  const confirm = () => {
    if (!eligible || pending || mutation.current) return;
    let selectedDate = new Date(deadline);
    if (Platform.OS === 'web') {
      const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
      if (!parts) { setError('Enter the deadline as YYYY-MM-DD.'); return; }
      selectedDate = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
      if (dateInputValue(selectedDate) !== dateText) { setError('Enter a valid deadline date.'); return; }
    }
    selectedDate.setHours(23, 59, 59, 999);
    if (selectedDate.getTime() <= Date.now()) { setError('Choose today or a future date for the new deadline.'); return; }
    const deadlineIso = selectedDate.toISOString();
    const dateLabel = selectedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    Alert.alert('Reopen for new offers?',
      `Any accepted helper will no longer be selected, and reserved points will return to your available balance. You can both rate the cancelled assignment. All current offers will close. Every helper must offer again. The new deadline is the end of ${dateLabel}.`, [
        { text: 'Keep as is', style: 'cancel' },
        { text: 'Reopen request', style: 'destructive', onPress: () => { void perform(deadlineIso); } },
      ]);
  };

  if (!eligible) return null;
  const earliestDate = new Date();
  earliestDate.setHours(0, 0, 0, 0);

  return <View style={styles.section}>
    <Text style={styles.heading}>Need to choose again?</Text>
    <Text style={styles.text}>Reopening ends any current acceptance and closes the current offers. Every helper, including someone previously declined, must offer again.</Text>
    <Text style={styles.label}>New deadline (end of day)</Text>
    {Platform.OS === 'web' ? (
      <TextInput accessibilityLabel="New deadline in YYYY-MM-DD format" style={styles.dateInput} value={dateText} editable={!pending} onChangeText={value => { setDateText(value); setError(''); }} placeholder="YYYY-MM-DD" maxLength={10} />
    ) : (
      <Pressable accessibilityRole="button" accessibilityLabel="Choose new request deadline" disabled={pending} style={[styles.secondary, pending && styles.disabled]} onPress={() => setShowPicker(true)}>
        <Text style={styles.secondaryText}>{deadline.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
      </Pressable>
    )}
    {Platform.OS !== 'web' && showPicker && !pending && <DateTimePicker value={deadline} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minimumDate={earliestDate} onChange={onDateChange} />}
    {Platform.OS === 'ios' && showPicker && <Pressable accessibilityRole="button" style={styles.secondary} disabled={pending} onPress={() => setShowPicker(false)}><Text style={styles.secondaryText}>Done</Text></Pressable>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!notice && <Text accessibilityRole="alert" style={styles.text}>{notice}</Text>}
    <Pressable accessibilityRole="button" disabled={pending} style={[styles.secondary, pending && styles.disabled]} onPress={confirm}>
      <Text style={styles.secondaryText}>{saving ? 'Reopening…' : 'Reopen for new offers'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 20, padding: 16, borderWidth: 1, borderColor: '#ECE3E3', borderRadius: 18 },
  heading: { fontSize: 18, fontWeight: '800', color: '#2B2525' },
  text: { fontSize: 15, lineHeight: 22, color: '#635C5C' },
  label: { fontSize: 15, fontWeight: '700', color: '#2B2525' },
  secondary: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#9B1C31', borderRadius: 14, alignItems: 'center' },
  secondaryText: { color: '#9B1C31', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  dateInput: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: '#BDB3B3', borderRadius: 12, color: '#2B2525', fontSize: 16 },
  disabled: { opacity: .45 },
  error: { color: '#9B1C31', fontSize: 15, lineHeight: 22 },
});
