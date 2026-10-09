import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useAuth } from '../../../../context/AuthContext';
import { getCourseClassmates } from '../../../../lib/courses';
import { env } from '../../../../lib/env';
import { inviteGroupMember, loadGroupManagementSnapshot } from '../../../../lib/groupConversations';
import { getGroupInviteOptions } from '../../../../lib/groupMessagingUi';
import { loadConversationSummary } from '../../../../lib/messages';
import { isConversationId } from '../../../../lib/messageThread';
import type { CourseClassmate } from '../../../../types/course';
import type { GroupConversationSummary, GroupManagementSnapshot } from '../../../../types/messaging';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#736B6B', border: '#ECE3E3', pink: '#FBECEC' };
type Attempt = { profileId: string; clientInvitationId: string; revision: string };
type SavedAttempt = { version: 1; attempt: Attempt | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^(0|[1-9][0-9]{0,18})$/;
const MAX_REVISION = '9223372036854775807';
const storageQueues = new Map<string, Promise<unknown>>();

function inStorageOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (storageQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  storageQueues.set(key, next);
  void next.finally(() => { if (storageQueues.get(key) === next) storageQueues.delete(key); }).catch(() => undefined);
  return next;
}

function parseSavedAttempt(raw: string | null): Attempt | null {
  if (raw === null) return null;
  const saved = JSON.parse(raw) as Partial<SavedAttempt> | null;
  if (!saved || saved.version !== 1 || (saved.attempt !== null && typeof saved.attempt !== 'object')) throw new Error();
  if (saved.attempt === null) return null;
  const { profileId, clientInvitationId, revision } = saved.attempt;
  if (!UUID.test(profileId) || !UUID.test(clientInvitationId) || !REVISION.test(revision)
    || (revision.length === MAX_REVISION.length && revision > MAX_REVISION)) throw new Error();
  return { profileId: profileId.toLowerCase(), clientInvitationId: clientInvitationId.toLowerCase(), revision };
}

export default function InviteGroupMemberScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = typeof id === 'string' ? id.toLowerCase() : '';
  if (!user || !isConversationId(conversationId)) return null;
  return <AccountInvite key={`${user.id}:${conversationId}`} userId={user.id.toLowerCase()} conversationId={conversationId} />;
}

function AccountInvite({ userId, conversationId }: { userId: string; conversationId: string }) {
  const router = useRouter();
  const storageKey = useMemo(() => `campusclutch:group-invitation-attempt:v1:${encodeURIComponent(env.supabaseUrl)}:${userId}:${conversationId}`,
    [conversationId, userId]);
  const mounted = useRef(true), focused = useRef(false), foreground = useRef(AppState.currentState === 'active');
  const loadEpoch = useRef(0), actionEpoch = useRef(0), loadBusy = useRef(false), actionBusy = useRef(false);
  const operation = useRef<object | null>(null), attempt = useRef<Attempt | null>(null);
  const [summary, setSummary] = useState<GroupConversationSummary | null>(null);
  const [snapshot, setSnapshot] = useState<GroupManagementSnapshot | null>(null);
  const [classmates, setClassmates] = useState<CourseClassmate[]>([]);
  const [search, setSearch] = useState('');
  const [restored, setRestored] = useState(false);
  const [, setAttemptVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const active = useCallback(() => mounted.current && focused.current && foreground.current, []);

  useEffect(() => () => {
    mounted.current = false;
    loadEpoch.current += 1;
    actionEpoch.current += 1;
  }, []);

  const persistAttempt = useCallback(async (nextAttempt: Attempt | null) => {
    await inStorageOrder(storageKey, async () => {
      await AsyncStorage.setItem(storageKey, JSON.stringify({ version: 1, attempt: nextAttempt } satisfies SavedAttempt));
    });
    if (!mounted.current) return;
    attempt.current = nextAttempt;
    setAttemptVersion(value => value + 1);
    setStorageError('');
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    void inStorageOrder(storageKey, async () => parseSavedAttempt(await AsyncStorage.getItem(storageKey)))
      .then(saved => {
        if (cancelled || !mounted.current) return;
        attempt.current = saved;
        setAttemptVersion(value => value + 1);
        setStorageError('');
        setRestored(true);
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        setStorageError('Unable to restore the saved invitation attempt on this device. Reset it explicitly before inviting anyone.');
        setRestored(true);
      });
    return () => { cancelled = true; };
  }, [storageKey]);

  const load = useCallback(async () => {
    if (!restored || !active() || actionBusy.current || loadBusy.current) return;
    const ticket = ++loadEpoch.current;
    loadBusy.current = true;
    setLoading(true);
    setError('');
    try {
      const nextSummary = await loadConversationSummary(userId, conversationId);
      if (nextSummary.type !== 'group' || nextSummary.my_membership_status !== 'active'
        || (nextSummary.my_role !== 'owner' && nextSummary.my_role !== 'administrator')) throw new Error('not-manager');
      const [nextSnapshot, nextClassmates] = await Promise.all([
        loadGroupManagementSnapshot(userId, conversationId), getCourseClassmates(nextSummary.group_course_id),
      ]);
      if (!active() || ticket !== loadEpoch.current) return;
      const currentAttempt = attempt.current;
      const attemptIsConfirmed = currentAttempt && (
        nextSnapshot.pending_invitations.some(item => item.invitee_profile_id === currentAttempt.profileId)
        || nextSnapshot.members.some(item => item.profile_id === currentAttempt.profileId)
      );
      if (attemptIsConfirmed) {
        try {
          await persistAttempt(null);
        } catch {
          if (active() && ticket === loadEpoch.current) {
            setStorageError('The invitation is confirmed, but its saved retry could not be cleared from this device. Refresh to try clearing it again.');
          }
        }
      }
      if (!active() || ticket !== loadEpoch.current) return;
      setSummary(nextSummary); setSnapshot(nextSnapshot); setClassmates(nextClassmates);
    } catch {
      if (active() && ticket === loadEpoch.current) {
        // Do not leave manager-only data and actions visible after a failed role/membership recheck.
        setSummary(null); setSnapshot(null); setClassmates([]);
        setError('Unable to load eligible classmates. Refresh the group and try again.');
      }
    } finally {
      if (ticket === loadEpoch.current) {
        loadBusy.current = false;
        if (active()) setLoading(false);
      }
    }
  }, [active, conversationId, persistAttempt, restored, userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState === 'active';
    if (foreground.current && restored) void load();
    return () => {
      focused.current = false;
      loadEpoch.current += 1;
      actionEpoch.current += 1;
      loadBusy.current = false;
      actionBusy.current = false;
      operation.current = null;
      setLoading(false);
      setInvitingId(null);
    };
  }, [load, restored]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) {
        loadEpoch.current += 1;
        actionEpoch.current += 1;
        loadBusy.current = false;
        actionBusy.current = false;
        operation.current = null;
        setInvitingId(null);
        setLoading(false);
      } else if (focused.current && restored) void load();
    });
    return () => subscription.remove();
  }, [load, restored]);

  useEffect(() => {
    if (restored && active()) void load();
  }, [active, load, restored]);

  const options = useMemo(() => snapshot ? getGroupInviteOptions(classmates, snapshot.members, snapshot.pending_invitations, userId)
    : { candidates: [], remainingSlots: 0, isFull: false }, [classmates, snapshot, userId]);
  const query = search.trim().toLocaleLowerCase();
  const savedAttempt = attempt.current;
  const visible = options.candidates.filter(item => savedAttempt
    ? item.profileId === savedAttempt.profileId
    : !query || `${item.displayName} ${item.major ?? ''}`.toLocaleLowerCase().includes(query));

  const discardAttempt = () => Alert.alert('Discard this saved invitation attempt?',
    'The invitation may already have been created. Refresh first if possible. Discarding lets you choose someone else and gives the next invite a new retry identity; it does not revoke an existing invitation.', [
      { text: 'Keep attempt', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => {
        if (!active() || actionBusy.current || loadBusy.current) return;
        actionBusy.current = true;
        setInvitingId(savedAttempt?.profileId ?? null);
        void persistAttempt(null).then(() => {
          if (!active()) return;
          actionBusy.current = false;
          setInvitingId(null);
          setError('');
          void load();
        }).catch(() => {
          if (!active()) return;
          actionBusy.current = false;
          setInvitingId(null);
          setStorageError('Unable to discard the saved invitation attempt. It remains available for an exact retry.');
        });
      } },
    ]);

  const resetUnreadableAttempt = () => Alert.alert('Reset unreadable invitation data?',
    'An earlier invitation may already exist. Resetting only removes the unreadable retry data from this device; it does not revoke an invitation.', [
      { text: 'Keep data', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => {
        if (!active() || actionBusy.current || loadBusy.current) return;
        actionBusy.current = true;
        void persistAttempt(null).then(() => {
          if (!active()) return;
          actionBusy.current = false;
          void load();
        }).catch(() => {
          if (!active()) return;
          actionBusy.current = false;
          setStorageError('Unable to reset the saved invitation data. Try again when device storage is available.');
        });
      } },
    ]);

  const invite = async (classmate: CourseClassmate) => {
    if (!active() || !restored || storageError || operation.current || actionBusy.current || loadBusy.current
      || !summary || !snapshot || options.isFull || error) return;
    const existing = attempt.current;
    if (existing && existing.profileId !== classmate.profileId) return;
    const saved = existing?.profileId === classmate.profileId ? existing : {
      profileId: classmate.profileId, clientInvitationId: globalThis.crypto.randomUUID(), revision: snapshot.management_revision,
    };
    const token = {};
    const epoch = ++actionEpoch.current;
    operation.current = token;
    actionBusy.current = true;
    setInvitingId(classmate.profileId);
    setError('');
    try {
      if (!existing) await persistAttempt(saved);
      if (!active() || operation.current !== token || actionEpoch.current !== epoch) return;
      await inviteGroupMember(userId, { conversationId, inviteeId: classmate.profileId,
        clientInvitationId: saved.clientInvitationId, expectedManagementRevision: saved.revision });
      if (!active() || operation.current !== token || actionEpoch.current !== epoch) return;
      try {
        await persistAttempt(null);
      } catch {
        if (active() && operation.current === token && actionEpoch.current === epoch) {
          setStorageError('The invitation is confirmed, but its saved retry could not be cleared from this device. Refresh to try clearing it again.');
        }
      }
      if (!active() || operation.current !== token || actionEpoch.current !== epoch) return;
      operation.current = null;
      actionBusy.current = false;
      setInvitingId(null);
      await load();
    } catch {
      if (active() && operation.current === token && actionEpoch.current === epoch) {
        operation.current = null;
        actionBusy.current = false;
        setInvitingId(null);
        setError('Unable to confirm this invitation. Refresh to check the group, or retry the same classmate without changing the attempt.');
      }
    }
  };

  const actionDisabled = !restored || loading || !!error || !!storageError || actionBusy.current || loadBusy.current || options.isFull;
  const savedAttemptName = savedAttempt
    ? classmates.find(item => item.profileId === savedAttempt.profileId)?.displayName ?? 'this classmate'
    : null;

  return <View style={styles.screen}>
    <ScreenHeader><Pressable accessibilityRole="button" accessibilityLabel="Back to group details" style={styles.back}
      onPress={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/messages/groups/[id]', params: { id: conversationId } })}>
      <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerTitle}>Invite classmates</Text>
    </Pressable></ScreenHeader>
    <FlatList data={visible} keyExtractor={item => item.profileId} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading && !!snapshot} tintColor={COLORS.primary} onRefresh={() => { void load(); }} />}
      ListHeaderComponent={<View style={styles.headerContent}>
        <Text style={styles.title}>{summary?.group_title ?? 'Course group'}</Text>
        <Text style={styles.muted}>{options.isFull ? 'This group has reached its 20-person active-plus-pending limit.'
          : `${options.remainingSlots} ${options.remainingSlots === 1 ? 'place' : 'places'} available. Invitations require explicit acceptance.`}</Text>
        <View style={styles.search}><Ionicons name="search" size={20} color={COLORS.muted} /><TextInput accessibilityLabel="Search eligible classmates"
          editable={!savedAttempt && !actionBusy.current} value={search} onChangeText={setSearch}
          placeholder={savedAttempt ? 'Saved attempt is locked' : 'Search classmates'} placeholderTextColor={COLORS.muted} style={styles.searchInput} /></View>
        {!!savedAttempt && <View style={styles.notice}><Text style={styles.noticeTitle}>Saved invitation attempt</Text>
          <Text style={styles.muted}>Retrying {savedAttemptName} uses the same saved invitation identity and group revision. Refresh can confirm whether it already succeeded.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Discard saved invitation attempt" accessibilityState={{ disabled: loading || actionBusy.current }}
            disabled={loading || actionBusy.current} style={styles.outlineButton} onPress={discardAttempt}><Text style={styles.outlineText}>Discard saved attempt</Text></Pressable></View>}
        {!!storageError && <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>
          {!savedAttempt && <Pressable accessibilityRole="button" accessibilityLabel="Reset unreadable invitation data"
            accessibilityState={{ disabled: loading || actionBusy.current }} disabled={loading || actionBusy.current}
            style={styles.outlineButton} onPress={resetUnreadableAttempt}><Text style={styles.outlineText}>Reset saved attempt</Text></Pressable>}</View>}
        {!!error && <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh group" accessibilityState={{ disabled: loading || actionBusy.current }}
            disabled={loading || actionBusy.current} style={styles.outlineButton} onPress={() => { void load(); }}><Text style={styles.outlineText}>Refresh group</Text></Pressable></View>}
      </View>}
      ListEmptyComponent={(!restored || loading) && !snapshot ? <ActivityIndicator color={COLORS.primary} style={styles.loading} />
        : <View style={styles.empty}><Ionicons name={options.isFull ? 'people' : 'person-add-outline'} size={46} color={COLORS.muted} />
          <Text style={styles.emptyTitle}>{savedAttempt ? 'Saved classmate is no longer eligible' : options.isFull ? 'Group is full' : query ? 'No classmates match' : 'No classmates available'}</Text>
          <Text style={styles.muted}>{savedAttempt ? 'Refresh to confirm the invitation, or discard the saved attempt before choosing someone else.'
            : options.isFull ? 'Revoke a pending invitation or remove a member before inviting someone else.' : 'Active members, pending invitees, and your account are excluded.'}</Text></View>}
      renderItem={({ item }) => <View style={styles.row}><View style={styles.avatar}><Text style={styles.initials}>{item.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</Text></View>
        <View style={styles.flex}><Text style={styles.name}>{item.displayName}</Text><Text style={styles.muted}>{item.major ?? 'Major not added'}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${savedAttempt?.profileId === item.profileId ? 'Retry invitation to' : 'Invite'} ${item.displayName}`}
          accessibilityState={{ disabled: actionDisabled, busy: invitingId === item.profileId }} disabled={actionDisabled}
          style={[styles.inviteButton, actionDisabled && styles.disabled]} onPress={() => { void invite(item); }}>
          {invitingId === item.profileId ? <ActivityIndicator color="white" /> : <Text style={styles.inviteText}>{attempt.current?.profileId === item.profileId ? 'Retry' : 'Invite'}</Text>}
        </Pressable>
      </View>} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, flex: { flex: 1 }, back: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 }, headerTitle: { color: 'white', fontSize: 20, fontWeight: '900' },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 }, headerContent: { gap: 12, marginBottom: 12 }, title: { color: COLORS.text, fontSize: 24, fontWeight: '900' }, muted: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  search: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#F2F0F0', borderRadius: 13, paddingLeft: 14 }, searchInput: { flex: 1, minHeight: 48, color: COLORS.text }, notice: { gap: 10, backgroundColor: '#FAF7F7', borderRadius: 12, padding: 12 }, error: { color: COLORS.primary, lineHeight: 20 },
  noticeTitle: { color: COLORS.text, fontWeight: '900' },
  outlineButton: { minHeight: 44, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, outlineText: { color: COLORS.primary, fontWeight: '800' },
  loading: { marginTop: 50 }, empty: { minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 }, emptyTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' },
  row: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: COLORS.border }, avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, initials: { color: COLORS.primary, fontWeight: '900' }, name: { color: COLORS.text, fontWeight: '800' },
  inviteButton: { minWidth: 72, minHeight: 42, backgroundColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, inviteText: { color: 'white', fontWeight: '900' }, disabled: { opacity: 0.5 },
});
