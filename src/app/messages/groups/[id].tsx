import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenHeader from '../../../components/ScreenHeader';
import { useAuth } from '../../../context/AuthContext';
import {
  leaveGroupConversation, loadGroupManagementSnapshot, loadGroupMembers, removeGroupMember,
  renameGroupConversation, revokeGroupInvitation, setGroupMemberRole, transferGroupOwnership,
} from '../../../lib/groupConversations';
import { loadConversationSummary } from '../../../lib/messages';
import { isConversationId } from '../../../lib/messageThread';
import type { GroupConversationSummary, GroupManagementMemberSummary, GroupManagementSnapshot, GroupMemberSummary } from '../../../types/messaging';

const COLORS = { primary: '#9B1C31', text: '#2B2525', muted: '#736B6B', border: '#ECE3E3', pink: '#FBECEC' };

export default function GroupDetailsScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const conversationId = typeof id === 'string' ? id.toLowerCase() : '';
  if (!user || !isConversationId(conversationId)) return <Unavailable />;
  return <AccountGroupDetails key={`${user.id}:${conversationId}`} userId={user.id.toLowerCase()} conversationId={conversationId} />;
}

function Unavailable() {
  const router = useRouter();
  return <View style={styles.screen}><ScreenHeader><Pressable accessibilityRole="button" accessibilityLabel="Back to messages"
    style={styles.back} onPress={() => router.replace('/(tabs)/messages')}>
    <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerTitle}>Group details</Text>
  </Pressable></ScreenHeader><View style={styles.center}><Text style={styles.stateTitle}>Group unavailable</Text></View></View>;
}

function AccountGroupDetails({ userId, conversationId }: { userId: string; conversationId: string }) {
  const router = useRouter();
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const generation = useRef(0);
  const operation = useRef<object | null>(null);
  const [summary, setSummary] = useState<GroupConversationSummary | null>(null);
  const [members, setMembers] = useState<GroupMemberSummary[]>([]);
  const [snapshot, setSnapshot] = useState<GroupManagementSnapshot | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const active = () => focused.current && foreground.current;

  const load = useCallback(async () => {
    if (!active()) return;
    const ticket = ++generation.current;
    setLoading(true); setError('');
    try {
      let next = await loadConversationSummary(userId, conversationId);
      if (!active() || ticket !== generation.current) return;
      if (next.type !== 'group') throw new Error('not-group');
      let nextMembers: GroupMemberSummary[] = [];
      let nextSnapshot: GroupManagementSnapshot | null = null;
      if (next.my_membership_status === 'active') {
        if (next.my_role === 'owner' || next.my_role === 'administrator') {
          try {
            nextSnapshot = await loadGroupManagementSnapshot(userId, conversationId);
            nextMembers = nextSnapshot.members;
          } catch {
            // A role may have changed between the summary and snapshot. Re-read
            // before deciding whether the ordinary roster is now appropriate.
            next = await loadConversationSummary(userId, conversationId);
            if (next.type !== 'group') throw new Error('not-group');
            if (next.my_membership_status === 'active' && next.my_role === 'member') {
              nextMembers = await loadGroupMembers(userId, conversationId);
            } else if (next.my_membership_status === 'active') {
              throw new Error('manager-snapshot');
            }
          }
        } else nextMembers = await loadGroupMembers(userId, conversationId);
      }
      if (!active() || ticket !== generation.current) return;
      setSummary(next); setMembers(nextMembers); setSnapshot(nextSnapshot);
      setRenameTitle(nextSnapshot?.title ?? next.group_title);
    } catch {
      if (active() && ticket === generation.current) {
        // A failed authorization refresh must not leave a formerly authorized
        // roster or management revision actionable on screen.
        setSummary(null); setMembers([]); setSnapshot(null); setRenameTitle('');
        setError('Unable to load this group. Check your connection and refresh.');
      }
    } finally {
      if (active() && ticket === generation.current) setLoading(false);
    }
  }, [conversationId, userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true; foreground.current = AppState.currentState === 'active'; if (foreground.current) void load();
    return () => { focused.current = false; ++generation.current; operation.current = null; setBusyLabel(''); };
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      foreground.current = next === 'active';
      if (!foreground.current) { ++generation.current; operation.current = null; setBusyLabel(''); setLoading(false); }
      else if (focused.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const mutate = async (label: string, work: () => Promise<unknown>, after?: () => void) => {
    if (!active() || operation.current) return;
    const token = {}; const epoch = generation.current; operation.current = token; setBusyLabel(label); setError('');
    try {
      await work();
      if (!active() || operation.current !== token || generation.current !== epoch) return;
      operation.current = null; setBusyLabel('');
      if (after) after(); else await load();
    } catch {
      if (active() && operation.current === token && generation.current === epoch) {
        operation.current = null; setBusyLabel('');
        setError('Unable to confirm that group change. Refresh to check the current group before trying again.');
      }
    }
  };
  const managerRevision = snapshot?.management_revision;
  const rename = () => {
    if (!managerRevision) return;
    void mutate('Saving title…', () => renameGroupConversation(userId, conversationId, renameTitle, managerRevision));
  };
  const revoke = (invitationId: string, name: string) => {
    if (!managerRevision) return;
    Alert.alert('Revoke invitation?', `${name} will need a new invitation to join.`, [
      { text: 'Keep invitation', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => { void mutate('Revoking invitation…', () => revokeGroupInvitation(userId, invitationId, managerRevision)); } },
    ]);
  };
  const memberMutation = (member: GroupManagementMemberSummary, action: 'remove' | 'administrator' | 'member' | 'owner') => {
    if (!managerRevision) return;
    const labels = { remove: 'Remove member?', administrator: 'Make administrator?', member: 'Make member?', owner: 'Transfer ownership?' } as const;
    const details = action === 'remove' ? `${member.display_name} will keep only the history from their membership period.`
      : action === 'owner' ? `${member.display_name} will become the owner. You will become an administrator.`
        : `${member.display_name}'s group role will change.`;
    Alert.alert(labels[action], details, [
      { text: 'Cancel', style: 'cancel' },
      { text: action === 'owner' ? 'Transfer' : action === 'remove' ? 'Remove' : 'Change role', style: action === 'remove' ? 'destructive' : 'default', onPress: () => {
        const work = action === 'remove'
          ? () => removeGroupMember(userId, conversationId, member.profile_id, member.membership_period, managerRevision)
          : action === 'owner'
            ? () => transferGroupOwnership(userId, conversationId, member.profile_id, member.membership_period, managerRevision)
            : () => setGroupMemberRole(userId, conversationId, member.profile_id, member.membership_period, action, managerRevision);
        void mutate(action === 'remove' ? 'Removing member…' : action === 'owner' ? 'Transferring ownership…' : 'Changing role…', work);
      } },
    ]);
  };
  const leave = () => summary && Alert.alert('Leave this group?', 'You will keep read-only access only to messages from your membership period. Rejoining requires a new invitation.', [
    { text: 'Stay', style: 'cancel' },
    { text: 'Leave', style: 'destructive', onPress: () => { void mutate('Leaving group…',
      () => leaveGroupConversation(userId, conversationId, summary.my_membership_period),
      () => router.replace({ pathname: '/messages/[id]', params: { id: conversationId } })); } },
  ]);

  const manager = summary?.my_role === 'owner' || summary?.my_role === 'administrator';
  const refreshDisabled = !!busyLabel || loading;
  // An ambiguous mutation leaves the management revision uncertain. Keep all
  // further actions locked until one confirmed refresh replaces the snapshot.
  const actionsDisabled = refreshDisabled || !!error;
  const managementMembers = snapshot?.members ?? [];
  const roster = snapshot?.members ?? members;

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to group conversation" style={styles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace({ pathname: '/messages/[id]', params: { id: conversationId } })}>
        <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerTitle}>Group details</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh group details" disabled={refreshDisabled}
        accessibilityState={{ disabled: refreshDisabled, busy: loading }} style={styles.headerButton} onPress={() => { void load(); }}>
        {loading ? <ActivityIndicator color="white" /> : <Ionicons name="refresh" size={22} color="white" />}
      </Pressable>
    </ScreenHeader>
    {loading && !summary ? <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading group…</Text></View>
      : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!!error && <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Pressable accessibilityRole="button" disabled={refreshDisabled} accessibilityState={{ disabled: refreshDisabled }}
            style={[styles.outlineButton, refreshDisabled && styles.disabled]} onPress={() => { void load(); }}><Text style={styles.outlineText}>Refresh group</Text></Pressable></View>}
        {summary && <>
          <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="people" size={30} color={COLORS.primary} /></View>
            <View style={styles.flex}><Text style={styles.groupTitle}>{snapshot?.title ?? summary.group_title}</Text>
              <Text style={styles.course}>{summary.group_course_code} · {summary.my_role === 'administrator' ? 'Administrator' : summary.my_role[0].toUpperCase() + summary.my_role.slice(1)}</Text></View></View>
          {summary.my_membership_status !== 'active' ? <View style={styles.notice}>
            <Text style={styles.stateTitle}>Read-only group history</Text><Text style={styles.muted}>Your visible title and messages are frozen to your membership period. Current membership and later activity remain private.</Text>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.replace({ pathname: '/messages/[id]', params: { id: conversationId } })}><Text style={styles.primaryText}>View my message history</Text></Pressable>
          </View> : <>
            {manager && snapshot && <View style={styles.section}><Text style={styles.sectionTitle}>Group settings</Text>
              <Text style={styles.label}>Group title</Text><View style={styles.renameRow}><TextInput accessibilityLabel="Group title" value={renameTitle} maxLength={80}
                editable={!actionsDisabled} onChangeText={setRenameTitle} style={styles.input} placeholder="Group title" />
                <Pressable accessibilityRole="button" disabled={actionsDisabled || !renameTitle.trim() || renameTitle.trim() === snapshot.title}
                  accessibilityLabel="Save group title" accessibilityState={{ disabled: actionsDisabled || !renameTitle.trim() || renameTitle.trim() === snapshot.title }}
                  style={[styles.compactButton, (actionsDisabled || !renameTitle.trim() || renameTitle.trim() === snapshot.title) && styles.disabled]} onPress={rename}><Text style={styles.primaryText}>Save</Text></Pressable></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Invite classmates to this group" accessibilityState={{ disabled: actionsDisabled }}
                disabled={actionsDisabled} style={[styles.outlineButton, actionsDisabled && styles.disabled]}
                onPress={() => router.push({ pathname: '/messages/groups/invite/[id]', params: { id: conversationId } })}>
                <Text style={styles.outlineText}>Invite classmates</Text></Pressable>
            </View>}
            <View style={styles.section}><Text style={styles.sectionTitle}>Members ({roster.length})</Text>
              {roster.map(member => {
                const managed = managementMembers.find(item => item.profile_id === member.profile_id);
                const mine = member.profile_id === userId;
                const owner = summary.my_role === 'owner';
                const adminCanRemove = summary.my_role === 'administrator' && member.role === 'member' && !mine;
                return <View key={member.profile_id} style={styles.personRow}><Pressable accessibilityRole="button"
                  accessibilityLabel={mine ? `${member.display_name}, your profile` : `View ${member.display_name}'s profile`}
                  accessibilityState={{ disabled: mine }} disabled={mine} style={styles.personMain}
                  onPress={() => !mine && router.push({ pathname: '/students/[id]', params: { id: member.profile_id } })}>
                  <View style={styles.avatar}><Text style={styles.initials}>{member.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</Text></View>
                  <View style={styles.flex}><Text style={styles.personName}>{member.display_name}{mine ? ' (You)' : ''}</Text><Text style={styles.muted}>{member.role === 'administrator' ? 'Administrator' : member.role[0].toUpperCase() + member.role.slice(1)}</Text></View>
                </Pressable>
                  {managed && !mine && (owner || adminCanRemove) && <View style={styles.memberActions}>
                    {owner && managed.role !== 'administrator' && <SmallButton label="Make admin" disabled={actionsDisabled} onPress={() => memberMutation(managed, 'administrator')} />}
                    {owner && managed.role === 'administrator' && <SmallButton label="Make member" disabled={actionsDisabled} onPress={() => memberMutation(managed, 'member')} />}
                    {owner && <SmallButton label="Transfer ownership" disabled={actionsDisabled} onPress={() => memberMutation(managed, 'owner')} />}
                    {(owner || adminCanRemove) && <SmallButton label="Remove" destructive disabled={actionsDisabled} onPress={() => memberMutation(managed, 'remove')} />}
                  </View>}
                </View>;
              })}
            </View>
            {manager && snapshot && <View style={styles.section}><Text style={styles.sectionTitle}>Pending invitations ({snapshot.pending_invitations.length})</Text>
              {!snapshot.pending_invitations.length && <Text style={styles.muted}>No pending invitations.</Text>}
              {snapshot.pending_invitations.map(item => <View key={item.id} style={styles.pendingRow}><View style={styles.flex}>
                <Text style={styles.personName}>{item.invitee_display_name}</Text><Text style={styles.muted}>Invited by {item.invited_by_display_name}</Text></View>
                <SmallButton label="Revoke" destructive disabled={actionsDisabled} onPress={() => revoke(item.id, item.invitee_display_name)} />
              </View>)}
            </View>}
            <View style={styles.section}><Text style={styles.sectionTitle}>Membership</Text>
              {summary.my_role === 'owner' ? <Text style={styles.muted}>Transfer ownership to another active member before leaving this group.</Text>
                : <Pressable accessibilityRole="button" accessibilityLabel="Leave this group" accessibilityState={{ disabled: actionsDisabled }}
                  disabled={actionsDisabled} style={[styles.dangerButton, actionsDisabled && styles.disabled]} onPress={leave}><Text style={styles.dangerText}>Leave group</Text></Pressable>}
            </View>
          </>}
        </>}
        {!!busyLabel && <View style={styles.busy}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>{busyLabel}</Text></View>}
      </ScrollView>}
  </View>;
}

function SmallButton({ label, destructive = false, disabled = false, onPress }: { label: string; destructive?: boolean; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={[styles.smallButton, destructive && styles.smallDanger, disabled && styles.disabled]}>
    <Text style={[styles.smallText, destructive && styles.dangerText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'white' }, flex: { flex: 1 }, back: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 }, headerTitle: { color: 'white', fontSize: 20, fontWeight: '900' }, headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, content: { padding: 20, paddingBottom: 50, gap: 16 },
  notice: { borderRadius: 14, backgroundColor: '#FAF7F7', padding: 14, gap: 10 }, error: { color: COLORS.primary, lineHeight: 21 }, stateTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' }, muted: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }, heroIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, groupTitle: { color: COLORS.text, fontSize: 24, fontWeight: '900' }, course: { color: COLORS.primary, fontWeight: '800', marginTop: 3 },
  section: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, gap: 12 }, sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: '900' }, label: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  renameRow: { flexDirection: 'row', gap: 10, alignItems: 'center' }, input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 13, color: COLORS.text }, compactButton: { minWidth: 70, minHeight: 46, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryButton: { minHeight: 46, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, primaryText: { color: 'white', fontWeight: '900' },
  outlineButton: { minHeight: 46, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, outlineText: { color: COLORS.primary, fontWeight: '900' },
  personRow: { borderBottomWidth: 1, borderColor: COLORS.border, paddingBottom: 12, gap: 10 }, personMain: { flexDirection: 'row', alignItems: 'center', gap: 11 }, avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.pink, alignItems: 'center', justifyContent: 'center' }, initials: { color: COLORS.primary, fontWeight: '900' }, personName: { color: COLORS.text, fontWeight: '800' },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginLeft: 53 }, smallButton: { minHeight: 38, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, smallDanger: { borderColor: COLORS.primary, backgroundColor: '#FFF8F8' }, smallText: { color: COLORS.primary, fontSize: 12, fontWeight: '800' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: COLORS.border }, dangerButton: { minHeight: 46, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, dangerText: { color: COLORS.primary, fontWeight: '900' },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 8 }, disabled: { opacity: 0.5 },
});
