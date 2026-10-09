import type { CourseClassmate } from '../types/course';
import type {
  ConversationMessage,
  ConversationSummary,
  GroupConversationSummary,
  GroupManagementMemberSummary,
  GroupMemberRole,
  GroupPendingInvitation,
} from '../types/messaging';

const GROUP_CAPACITY = 20;
const MAX_INITIAL_INVITEES = GROUP_CAPACITY - 1;

export type ConversationInboxPresentation = {
  title: string;
  subtitle: string;
  preview: string;
  searchText: string;
  avatarKind: 'person' | 'group';
  isReadOnly: boolean;
};

export type ConversationThreadPresentation = {
  title: string;
  subtitle: string;
  isReadOnly: boolean;
  canCompose: boolean;
  canOpenGroupDetails: boolean;
  visibleMemberCount: number | null;
  readOnlyMessage: string | null;
};

export type GroupManagementPermissions = {
  canRename: boolean;
  canInvite: boolean;
  canRevokeInvitations: boolean;
  canChangeRoles: boolean;
  canTransferOwnership: boolean;
  canLeave: boolean;
};

export type GroupMemberActions = {
  canRemove: boolean;
  canChangeRole: boolean;
  canTransferOwnership: boolean;
};

export type GroupInviteOptions = {
  candidates: CourseClassmate[];
  remainingSlots: number;
  isFull: boolean;
};

export type GroupCreationValidation = {
  isValid: boolean;
  normalizedTitle: string;
  normalizedInviteeIds: string[];
  titleError: string | null;
  inviteesError: string | null;
};

function displayName(value: string | null | undefined): string {
  return value?.trim() || 'CampusClutch member';
}

function memberWord(count: number): string {
  return count === 1 ? 'member' : 'members';
}

export function isGroupReadOnly(summary: GroupConversationSummary): boolean {
  return summary.status !== 'active'
    || summary.my_membership_status !== 'active'
    || !summary.can_send;
}

export function getConversationInboxPresentation(
  summary: ConversationSummary,
): ConversationInboxPresentation {
  const preview = summary.last_message_body?.trim() || 'No messages yet';

  if (summary.type === 'direct') {
    const title = displayName(summary.other_display_name);
    const isReadOnly = summary.status !== 'active';
    const subtitle = isReadOnly ? 'Read-only conversation' : 'Direct message';
    return {
      title,
      subtitle,
      preview,
      searchText: `${title} ${subtitle} ${preview}`.toLocaleLowerCase(),
      avatarKind: 'person',
      isReadOnly,
    };
  }

  const isReadOnly = isGroupReadOnly(summary);
  const formerMember = summary.my_membership_status !== 'active';
  // A former member's summary deliberately avoids presenting the current roster size.
  const subtitle = formerMember
    ? `${summary.group_course_code} · Read-only group history`
    : `${summary.group_course_code} · ${summary.active_member_count} ${memberWord(summary.active_member_count)}${isReadOnly ? ' · Read-only' : ''}`;
  return {
    title: summary.group_title,
    subtitle,
    preview,
    searchText: `${summary.group_title} ${summary.group_course_code} ${subtitle} ${preview}`.toLocaleLowerCase(),
    avatarKind: 'group',
    isReadOnly,
  };
}

export function conversationMatchesSearch(
  summary: ConversationSummary,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized
    || getConversationInboxPresentation(summary).searchText.includes(normalized);
}

export function getConversationThreadPresentation(
  summary: ConversationSummary,
): ConversationThreadPresentation {
  if (summary.type === 'direct') {
    const isReadOnly = summary.status !== 'active';
    return {
      title: displayName(summary.other_display_name),
      subtitle: isReadOnly ? 'Closed conversation' : 'Direct messages',
      isReadOnly,
      canCompose: !isReadOnly,
      canOpenGroupDetails: false,
      visibleMemberCount: null,
      readOnlyMessage: isReadOnly
        ? 'This conversation is closed to new messages.'
        : null,
    };
  }

  const formerMember = summary.my_membership_status !== 'active';
  const isReadOnly = isGroupReadOnly(summary);
  return {
    title: summary.group_title,
    subtitle: formerMember
      ? `${summary.group_course_code} · Read-only group history`
      : `${summary.group_course_code} · ${summary.active_member_count} ${memberWord(summary.active_member_count)}${isReadOnly ? ' · Read-only' : ''}`,
    isReadOnly,
    canCompose: !isReadOnly,
    canOpenGroupDetails: !formerMember && summary.status === 'active',
    // Current roster size is intentionally not part of a former member's presentation.
    visibleMemberCount: formerMember ? null : summary.active_member_count,
    readOnlyMessage: formerMember
      ? 'You can read messages from your membership period, but not the current roster or later group activity.'
      : isReadOnly
        ? 'This group is unavailable for new messages.'
        : null,
  };
}

export function getMessageSenderLabel(
  message: ConversationMessage,
  currentUserId: string,
  summary: ConversationSummary,
): string {
  if (message.sender_id.toLowerCase() === currentUserId.toLowerCase()) return 'You';
  if (summary.type === 'group') return displayName(message.sender_display_name);
  return displayName(summary.other_display_name ?? message.sender_display_name);
}

export function getGroupManagementPermissions(
  role: GroupMemberRole,
  isActiveMember = true,
): GroupManagementPermissions {
  if (!isActiveMember) {
    return {
      canRename: false,
      canInvite: false,
      canRevokeInvitations: false,
      canChangeRoles: false,
      canTransferOwnership: false,
      canLeave: false,
    };
  }

  const manager = role === 'owner' || role === 'administrator';
  return {
    canRename: manager,
    canInvite: manager,
    canRevokeInvitations: manager,
    canChangeRoles: role === 'owner',
    canTransferOwnership: role === 'owner',
    canLeave: role !== 'owner',
  };
}

export function getGroupMemberActions(
  viewerId: string,
  viewerRole: GroupMemberRole,
  target: Pick<GroupManagementMemberSummary, 'profile_id' | 'role'>,
  isActiveMember = true,
): GroupMemberActions {
  const self = viewerId.toLowerCase() === target.profile_id.toLowerCase();
  if (!isActiveMember || self) {
    return { canRemove: false, canChangeRole: false, canTransferOwnership: false };
  }

  const owner = viewerRole === 'owner';
  const administrator = viewerRole === 'administrator';
  return {
    canRemove: target.role !== 'owner'
      && (owner || (administrator && target.role === 'member')),
    canChangeRole: owner && target.role !== 'owner',
    canTransferOwnership: owner && target.role !== 'owner',
  };
}

export function getGroupInviteOptions(
  classmates: CourseClassmate[],
  members: readonly Pick<GroupManagementMemberSummary, 'profile_id'>[],
  pendingInvitations: readonly Pick<GroupPendingInvitation, 'invitee_profile_id'>[],
  viewerId: string,
): GroupInviteOptions {
  const excluded = new Set([
    viewerId.toLowerCase(),
    ...members.map(item => item.profile_id.toLowerCase()),
    ...pendingInvitations.map(item => item.invitee_profile_id.toLowerCase()),
  ]);
  const seen = new Set<string>();
  const candidates = classmates.filter(classmate => {
    const id = classmate.profileId.toLowerCase();
    if (!id || excluded.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const remainingSlots = Math.max(
    0,
    GROUP_CAPACITY - members.length - pendingInvitations.length,
  );
  return {
    candidates: remainingSlots > 0 ? candidates : [],
    remainingSlots,
    isFull: remainingSlots === 0,
  };
}

export function validateGroupCreation(
  title: string,
  inviteeIds: string[],
  viewerId: string,
): GroupCreationValidation {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedInviteeIds = Array.isArray(inviteeIds)
    ? inviteeIds.map(value => typeof value === 'string' ? value.trim().toLowerCase() : '')
    : [];

  let titleError: string | null = null;
  if (!normalizedTitle) titleError = 'Enter a group title.';
  else if (Array.from(normalizedTitle).length > 80) {
    titleError = 'Use a group title of 1–80 characters.';
  }

  let inviteesError: string | null = null;
  if (normalizedInviteeIds.length < 1) {
    inviteesError = 'Choose at least one classmate.';
  } else if (normalizedInviteeIds.length > MAX_INITIAL_INVITEES) {
    inviteesError = 'Choose no more than 19 classmates.';
  } else if (
    normalizedInviteeIds.some(id => !id)
    || normalizedInviteeIds.includes(viewerId.trim().toLowerCase())
    || new Set(normalizedInviteeIds).size !== normalizedInviteeIds.length
  ) {
    inviteesError = 'Choose each classmate once and do not include yourself.';
  }

  return {
    isValid: titleError === null && inviteesError === null,
    normalizedTitle,
    normalizedInviteeIds,
    titleError,
    inviteesError,
  };
}
