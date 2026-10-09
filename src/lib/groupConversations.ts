import type {
  GroupInvitationSummary,
  GroupManagementMemberSummary,
  GroupManagementRevision,
  GroupManagementSnapshot,
  GroupMemberRole,
  GroupMemberSummary,
  GroupPendingInvitation,
} from '../types/messaging';
import { MessagingError } from './messages';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REVISION = '9223372036854775807';
const ACCOUNT_CHANGED = 'Your account changed. Reopen this screen before continuing.';
const UNCONFIRMED = 'Unable to confirm the group conversation status. Check your connection and refresh before trying again.';

export type CreateGroupConversationInput = {
  clientCreationId: string;
  courseId: string;
  title: string;
  inviteeIds: string[];
};

export type InviteGroupMemberInput = {
  conversationId: string;
  clientInvitationId: string;
  inviteeId: string;
  expectedManagementRevision: GroupManagementRevision;
};

function invalid(message: string): never {
  throw new MessagingError('INVALID_INPUT', message);
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`Choose a valid ${label}.`);
  return value.toLowerCase();
}

function title(value: unknown): string {
  if (typeof value !== 'string') invalid('Enter a group title.');
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > 80) invalid('Use a group title of 1–80 characters.');
  return normalized;
}

function limit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) invalid('Choose a page size from 1 to 50.');
  return value;
}

function responseText(value: unknown): 'accepted' | 'declined' {
  if (value !== 'accepted' && value !== 'declined') invalid('Choose whether to accept or decline this invitation.');
  return value;
}

function manageableRole(value: unknown): Exclude<GroupMemberRole, 'owner'> {
  if (value !== 'administrator' && value !== 'member') invalid('Choose administrator or member.');
  return value;
}

function safeError(error: unknown): MessagingError {
  if (error instanceof MessagingError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '42501') return new MessagingError(code, 'This group action is unavailable to your account. Refresh and check your membership.');
  if (code === '22023') return new MessagingError(code, 'This group or invitation changed. Refresh before continuing.');
  if (code === '23505') return new MessagingError(code, 'This group action was already submitted. Refresh to check its result.');
  if (code === '55000') return new MessagingError(code, 'This group action is no longer available. Refresh to check the current group state.');
  return new MessagingError('GROUP_UNCONFIRMED', UNCONFIRMED);
}

async function groupSession(expectedUserId: string) {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user.id.toLowerCase() !== expectedUserId || !data.session?.access_token) {
      throw new MessagingError('ACCOUNT_CHANGED', ACCOUNT_CHANGED);
    }
    return data.session;
  } catch (error) {
    throw safeError(error);
  }
}

async function call(userId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  const expectedUserId = uuid(userId, 'account');
  const session = await groupSession(expectedUserId);
  const accessToken = session.access_token;
  let response: { data: unknown; error: unknown } | undefined;
  let failure: unknown;
  try {
    response = await supabase.rpc(name, args).setHeader('Authorization', `Bearer ${accessToken}`);
  } catch (error) {
    failure = error;
  }
  await groupSession(expectedUserId);
  if (!response) throw safeError(failure);
  if (response.error) throw safeError(response.error);
  return response.data;
}

function parse<T>(reader: () => T): T {
  try { return reader(); } catch {
    throw new MessagingError('INVALID_RESPONSE', 'Unable to load this group conversation. Refresh and try again.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw new Error();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error();
  return value;
}

function normalizedTitle(value: unknown): string {
  const result = text(value);
  if (result !== result.trim() || Array.from(result).length > 80) throw new Error();
  return result;
}

function count(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 20) throw new Error();
  return value as number;
}

function membershipPeriod(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid('Refresh the group before changing this membership.');
  }
  return value as number;
}

function managementRevision(value: unknown, forMutation = false): GroupManagementRevision {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)
    || value.length > MAX_REVISION.length
    || (value.length === MAX_REVISION.length && value > MAX_REVISION)
    || (forMutation && value === MAX_REVISION)) {
    invalid('Refresh the group before changing it.');
  }
  return value;
}

function rows(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error();
  return value;
}

function invitation(value: unknown): GroupInvitationSummary {
  const row = record(value);
  if (row.status !== 'pending') throw new Error();
  const createdAt = timestamp(row.created_at);
  return {
    id: uuid(row.id, 'invitation'),
    conversation_id: uuid(row.conversation_id, 'conversation'),
    group_title: normalizedTitle(row.group_title),
    course_id: uuid(row.course_id, 'course'),
    course_code: text(row.course_code),
    course_title: text(row.course_title),
    invited_by_profile_id: uuid(row.invited_by_profile_id, 'profile'),
    invited_by_display_name: text(row.invited_by_display_name),
    active_member_count: count(row.active_member_count, 1),
    status: 'pending',
    created_at: createdAt,
  };
}

function rosterMember(value: unknown): GroupMemberSummary {
  const row = record(value);
  if (!['owner', 'administrator', 'member'].includes(String(row.role))) throw new Error();
  return {
    profile_id: uuid(row.profile_id, 'profile'),
    display_name: text(row.display_name),
    role: row.role as GroupMemberRole,
    joined_at: timestamp(row.joined_at),
  };
}

function managementMember(value: unknown): GroupManagementMemberSummary {
  const row = record(value);
  return {
    ...rosterMember(row),
    membership_period: membershipPeriod(row.membership_period),
  };
}

function pendingInvitation(value: unknown): GroupPendingInvitation {
  const row = record(value);
  return {
    id: uuid(row.id, 'invitation'),
    invitee_profile_id: uuid(row.invitee_profile_id, 'profile'),
    invitee_display_name: text(row.invitee_display_name),
    invited_by_profile_id: uuid(row.invited_by_profile_id, 'profile'),
    invited_by_display_name: text(row.invited_by_display_name),
    created_at: timestamp(row.created_at),
  };
}

function managementSnapshot(value: unknown, conversationId: string): GroupManagementSnapshot {
  const row = record(value);
  const members = rows(row.members, 20).map(managementMember);
  const pending = rows(row.pending_invitations, 19).map(pendingInvitation);
  if (uuid(row.conversation_id, 'conversation') !== conversationId
    || new Set(members.map(item => item.profile_id)).size !== members.length
    || members.filter(item => item.role === 'owner').length !== 1
    || new Set(pending.map(item => item.id)).size !== pending.length
    || new Set(pending.map(item => item.invitee_profile_id)).size !== pending.length
    || pending.some(item => members.some(memberItem => memberItem.profile_id === item.invitee_profile_id))) {
    throw new Error();
  }
  return {
    conversation_id: conversationId,
    title: normalizedTitle(row.title),
    management_revision: managementRevision(row.management_revision),
    members,
    pending_invitations: pending,
  };
}

function exact(value: unknown, expected: string): string {
  if (value !== expected) throw new Error();
  return expected;
}

export async function createGroupConversation(userId: string, input: CreateGroupConversationInput): Promise<string> {
  if (!input || typeof input !== 'object') invalid('Enter group details.');
  const actor = uuid(userId, 'account');
  const invitees = input.inviteeIds;
  if (!Array.isArray(invitees) || invitees.length < 1 || invitees.length > 19) {
    invalid('Choose between 1 and 19 classmates.');
  }
  const normalized = invitees.map(value => uuid(value, 'classmate'));
  if (normalized.includes(actor) || new Set(normalized).size !== normalized.length) {
    invalid('Choose each classmate once and do not include yourself.');
  }
  const data = await call(actor, 'create_group_conversation', {
    p_client_creation_id: uuid(input.clientCreationId, 'group request'),
    p_course_id: uuid(input.courseId, 'course'),
    p_title: title(input.title),
    p_invitee_ids: normalized,
  });
  return parse(() => uuid(data, 'conversation'));
}

export async function loadMyGroupInvitations(userId: string, pageSize = 20): Promise<GroupInvitationSummary[]> {
  const pageLimit = limit(pageSize);
  const data = await call(userId, 'get_my_group_invitations', { p_limit: pageLimit });
  return parse(() => {
    const items = rows(data, pageLimit).map(invitation);
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error();
    return items;
  });
}

export async function respondToGroupInvitation(
  userId: string,
  invitationId: string,
  response: 'accepted' | 'declined',
): Promise<string> {
  const data = await call(userId, 'respond_to_group_invitation', {
    p_invitation_id: uuid(invitationId, 'invitation'),
    p_response: responseText(response),
  });
  return parse(() => uuid(data, 'conversation'));
}

export async function inviteGroupMember(userId: string, input: InviteGroupMemberInput): Promise<string> {
  if (!input || typeof input !== 'object') invalid('Choose a classmate to invite.');
  const actor = uuid(userId, 'account'), invitee = uuid(input.inviteeId, 'classmate');
  if (invitee === actor) invalid('Choose someone else to invite.');
  const data = await call(actor, 'invite_group_member', {
    p_conversation_id: uuid(input.conversationId, 'conversation'),
    p_client_invitation_id: uuid(input.clientInvitationId, 'invitation request'),
    p_invitee_id: invitee,
    p_expected_management_revision: managementRevision(input.expectedManagementRevision, true),
  });
  return parse(() => uuid(data, 'invitation'));
}

export async function revokeGroupInvitation(
  userId: string,
  invitationId: string,
  expectedManagementRevision: GroupManagementRevision,
): Promise<'revoked'> {
  const data = await call(userId, 'revoke_group_invitation', {
    p_invitation_id: uuid(invitationId, 'invitation'),
    p_expected_management_revision: managementRevision(expectedManagementRevision, true),
  });
  return parse(() => exact(data, 'revoked') as 'revoked');
}

export async function loadGroupMembers(userId: string, conversationId: string): Promise<GroupMemberSummary[]> {
  const data = await call(userId, 'get_group_members', { p_conversation_id: uuid(conversationId, 'conversation') });
  return parse(() => {
    const items = rows(data, 20).map(rosterMember);
    if (new Set(items.map(item => item.profile_id)).size !== items.length) throw new Error();
    return items;
  });
}

export async function loadGroupPendingInvitations(userId: string, conversationId: string): Promise<GroupPendingInvitation[]> {
  const data = await call(userId, 'get_group_pending_invitations', { p_conversation_id: uuid(conversationId, 'conversation') });
  return parse(() => {
    const items = rows(data, 19).map(pendingInvitation);
    if (new Set(items.map(item => item.id)).size !== items.length
      || new Set(items.map(item => item.invitee_profile_id)).size !== items.length) throw new Error();
    return items;
  });
}

export async function loadGroupManagementSnapshot(
  userId: string,
  conversationId: string,
): Promise<GroupManagementSnapshot> {
  const id = uuid(conversationId, 'conversation');
  const data = await call(userId, 'get_group_management_snapshot', { p_conversation_id: id });
  return parse(() => managementSnapshot(data, id));
}

export async function leaveGroupConversation(
  userId: string,
  conversationId: string,
  expectedMembershipPeriod: number,
): Promise<'left'> {
  const data = await call(userId, 'leave_group_conversation', {
    p_conversation_id: uuid(conversationId, 'conversation'),
    p_expected_membership_period: membershipPeriod(expectedMembershipPeriod),
  });
  return parse(() => exact(data, 'left') as 'left');
}

export async function removeGroupMember(
  userId: string,
  conversationId: string,
  profileId: string,
  expectedMembershipPeriod: number,
  expectedManagementRevision: GroupManagementRevision,
): Promise<'removed'> {
  const actor = uuid(userId, 'account'), memberId = uuid(profileId, 'member');
  if (actor === memberId) invalid('Leave the group instead of removing yourself.');
  const data = await call(actor, 'remove_group_member', {
    p_conversation_id: uuid(conversationId, 'conversation'),
    p_profile_id: memberId,
    p_expected_membership_period: membershipPeriod(expectedMembershipPeriod),
    p_expected_management_revision: managementRevision(expectedManagementRevision, true),
  });
  return parse(() => exact(data, 'removed') as 'removed');
}

export async function setGroupMemberRole(
  userId: string,
  conversationId: string,
  profileId: string,
  expectedMembershipPeriod: number,
  role: Exclude<GroupMemberRole, 'owner'>,
  expectedManagementRevision: GroupManagementRevision,
): Promise<Exclude<GroupMemberRole, 'owner'>> {
  const actor = uuid(userId, 'account'), memberId = uuid(profileId, 'member'), nextRole = manageableRole(role);
  if (actor === memberId) invalid('Choose another group member.');
  const data = await call(actor, 'set_group_member_role', {
    p_conversation_id: uuid(conversationId, 'conversation'),
    p_profile_id: memberId,
    p_expected_membership_period: membershipPeriod(expectedMembershipPeriod),
    p_role: nextRole,
    p_expected_management_revision: managementRevision(expectedManagementRevision, true),
  });
  return parse(() => exact(data, nextRole) as Exclude<GroupMemberRole, 'owner'>);
}

export async function transferGroupOwnership(
  userId: string,
  conversationId: string,
  newOwnerId: string,
  expectedMembershipPeriod: number,
  expectedManagementRevision: GroupManagementRevision,
): Promise<'transferred'> {
  const actor = uuid(userId, 'account'), ownerId = uuid(newOwnerId, 'new owner');
  if (actor === ownerId) invalid('Choose another group member as owner.');
  const data = await call(actor, 'transfer_group_ownership', {
    p_conversation_id: uuid(conversationId, 'conversation'),
    p_new_owner_id: ownerId,
    p_expected_membership_period: membershipPeriod(expectedMembershipPeriod),
    p_expected_management_revision: managementRevision(expectedManagementRevision, true),
  });
  return parse(() => exact(data, 'transferred') as 'transferred');
}

export async function renameGroupConversation(
  userId: string,
  conversationId: string,
  newTitle: string,
  expectedManagementRevision: GroupManagementRevision,
): Promise<string> {
  const normalized = title(newTitle);
  const data = await call(userId, 'rename_group_conversation', {
    p_conversation_id: uuid(conversationId, 'conversation'), p_title: normalized,
    p_expected_management_revision: managementRevision(expectedManagementRevision, true),
  });
  return parse(() => {
    if (data !== normalized) throw new Error();
    return normalized;
  });
}
