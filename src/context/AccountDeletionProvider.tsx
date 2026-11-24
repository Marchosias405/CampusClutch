import ProfileActionRow from '../components/ProfileActionRow';
import { LoadingState, LoadingNotice } from '@/components/LoadingState';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from './AuthContext';
import { ModerationButton, moderationStyles as styles } from '../components/ModerationShell';
import { clearDeletedAccountDrafts, clearDeletionReceipt, confirmAccountDeletion, finishAccountDeletion, readDeletionReceipt } from '../lib/accountDeletion';
import type { DeletionReceipt } from '../lib/accountDeletion';

const Context = createContext<() => void>(() => undefined);
export function DeleteAccountButton({ variant = 'default' }: { variant?: 'default' | 'profile' } = {}) {
  const open = useContext(Context);
  if (variant === 'profile') return <ProfileActionRow label="Delete account" icon="trash-outline" onPress={open} />;
  return <ModerationButton title="Delete account" onPress={open} />;
}
export function AccountDeletionProvider({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [recovery, setRecovery] = useState<'unavailable' | 'retry' | null>(null);
  const running = useRef(false);
  const confirmationInput = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const load = async () => {
    setError('');
    try { setReceipt(await readDeletionReceipt()); setLoaded(true); setError(''); }
    catch { setError('Unable to load your saved account deletion. Please retry.'); }
  };
  useEffect(() => { void load(); }, []);
  async function finish(value: DeletionReceipt) {
    const status = await finishAccountDeletion(value);
    if (status === 'complete') {
      // Clear only this account's local drafts, and sign out before the next
      // student can use the app. Keep the receipt if local cleanup fails.
      await clearDeletedAccountDrafts(value.userId);
      if (user?.id === value.userId) { const failed = await signOut(); if (failed) throw failed; }
      await clearDeletionReceipt(); setReceipt(null); setDone(true); setOpen(true); setRecovery(null);
    } else if (status === 'unconfirmed') {
      setRecovery('unavailable'); setConfirmation('');
    } else { setError('Cleanup is in progress. You can close the app and check again later.'); }
  }
  async function forgetUnavailableReceipt() {
    if (running.current || recovery !== 'unavailable') return;
    running.current = true; setBusy(true); setError('');
    try {
      await clearDeletionReceipt();
      setReceipt(null); setRecovery(null); setConfirmation(''); setOpen(false);
    } catch { setError('Unable to remove the saved receipt. Please try again.'); }
    finally { running.current = false; setBusy(false); }
  }
  async function run(confirm: boolean) {
    if (running.current) return;
    Keyboard.dismiss();
    running.current = true; setBusy(true); setError('');
    try {
      let value = receipt;
      if (!confirm) setRecovery(null);
      if (confirm) {
        if (!user?.email || confirmation !== 'DELETE' || !password) throw new Error('Enter your password and type DELETE.');
        value = await confirmAccountDeletion(user.id, user.email, password, receipt,
          saved => { setReceipt(saved); setRecovery(null); }, () => { setReceipt(null); setRecovery(null); });
      }
      if (value) await finish(value);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to finish deletion. Please retry.'); }
    finally { setPassword(''); running.current = false; setBusy(false); }
  }
  const showing = open || receipt || !loaded;
  return <Context.Provider value={() => { Keyboard.dismiss(); setOpen(true); setDone(false); setError(''); setConfirmation(''); setPassword(''); }}>
    {showing ? <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }, !loaded && { flexGrow: 1, justifyContent: 'center' }]}>
        {loaded && <Text accessibilityRole="header" style={styles.heading}>{done ? 'Account deleted' : recovery === 'unavailable' ? 'Deletion status unavailable' : receipt ? 'Finishing account deletion' : 'Delete your account?'}</Text>}
        {!loaded ? error ? <>
          <Text accessibilityRole="header" style={styles.heading}>Unable to open CampusClutch</Text>
          <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>
          <ModerationButton title="Retry" onPress={() => { void load(); }} />
        </> : <LoadingState title="Opening CampusClutch" /> : done ? <>
          <Text style={styles.body}>Your account and photo have been removed. Past messages remain as “Deleted student”.</Text>
          <ModerationButton title="Return to sign in" primary onPress={() => { setOpen(false); setDone(false); }} />
        </> : <>
          {!receipt && <>
            <Text style={styles.body}>This permanently removes your profile, photo, courses and reviews. Open requests are cancelled and unaccepted offers are withdrawn.</Text>
            <Text style={styles.body}>Your past messages stay in other students’ inboxes as “Deleted student”. Shared job history and private safety records are kept.</Text>
            <View style={styles.notice}><Text style={styles.value}>Your remaining points are saved. Verify the same email when you return to restore them. You won’t get another 100 welcome points.</Text></View>
            <Text style={styles.body}>Finish or cancel any accepted jobs first. Admins must arrange a handover.</Text>
          </>}
          {receipt && (recovery === 'unavailable' ? <>
            <Text style={styles.body}>This receipt may have expired, or your original request may not have reached us. Receipts expire 90 days after cleanup finishes.</Text>
            <Text style={styles.body}>You can check again or remove the receipt from this device. Any accepted deletion will continue.</Text>
          </> : <Text style={styles.body}>Your receipt is saved on this device. You can check it while cleanup is pending and for 90 days after it finishes.</Text>)}
          {(!receipt || recovery === 'retry') && <>
            <Text style={styles.subheading}>Confirm it’s you</Text>
            <Text style={styles.body}>{user?.email ?? 'Sign in to the account that started this deletion.'}</Text>
            <TextInput accessibilityLabel="Account password" placeholder="Password" placeholderTextColor="#635C5C" secureTextEntry
              autoCapitalize="none" autoCorrect={false} returnKeyType="next" submitBehavior="submit"
              onSubmitEditing={() => confirmationInput.current?.focus()} value={password} onChangeText={setPassword} editable={!busy}
              style={[styles.input, { minHeight: 52, textAlignVertical: 'center' }]} />
            <Text style={styles.body}>Type DELETE to confirm.</Text>
            <TextInput ref={confirmationInput} accessibilityLabel="Type DELETE to confirm" placeholder="DELETE" placeholderTextColor="#635C5C" autoCapitalize="characters" autoCorrect={false}
              returnKeyType="done" onSubmitEditing={Keyboard.dismiss}
              value={confirmation} onChangeText={setConfirmation} editable={!busy} style={[styles.input, { minHeight: 52, textAlignVertical: 'center' }]} />
            <ModerationButton title="Permanently delete account" primary disabled={busy || confirmation !== 'DELETE' || !password || !user?.email}
              onPress={() => { void run(true); }} />
          </>}
          {receipt && <ModerationButton title="Check deletion status" disabled={busy} onPress={() => { void run(false); }} />}
          {receipt && recovery === 'unavailable' && <>
            {user?.id === receipt.userId && <ModerationButton title="Retry confirmation" disabled={busy} onPress={() => { setError(''); setRecovery('retry'); }} />}
            <ModerationButton title="Remove saved receipt" disabled={busy} onPress={() => { void forgetUnavailableReceipt(); }} />
          </>}
          {!receipt && <ModerationButton title="Keep my account" disabled={busy} onPress={() => { Keyboard.dismiss(); setPassword(''); setConfirmation(''); setOpen(false); setError(''); }} />}
          {busy && <LoadingNotice label={receipt ? 'Checking deletion status' : 'Deleting account'} />}
        </>}
        {loaded && !!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
      </ScrollView>
    </KeyboardAvoidingView> : children}
  </Context.Provider>;
}
