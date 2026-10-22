/** Postgres bigint cursors stay decimal strings, including beyond JS's safe integer range. */
export type MessageSequence = string;
/** Postgres bigint optimistic-concurrency tokens stay exact decimal strings. */
export type GroupManagementRevision = string;

export type ConversationStatus = 'active' | 'closed' | 'removed';
export type GroupMemberRole = 'owner' | 'administrator' | 'member';
export type GroupMembershipStatus = 'active' | 'left' | 'removed';
export type GroupInvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

type ConversationSummaryBase = {
  id: string;
  status: ConversationStatus;
  last_message_body: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  last_message_sequence: MessageSequence;
  last_read_sequence: MessageSequence;
  unread_count: number;
  created_at: string;
};

export type DirectConversationSummary = ConversationSummaryBase & {
  type: 'direct';
  other_profile_id: string;
  other_display_name: string | null;
};

export type GroupConversationSummary = ConversationSummaryBase & {
  type: 'group';
  other_profile_id: null;
  other_display_name: null;
  group_title: string;
  group_course_id: string;
  group_course_code: string;
  active_member_count: number;
  my_role: GroupMemberRole;
  my_membership_status: GroupMembershipStatus;
  my_membership_period: number;
  management_revision: GroupManagementRevision;
  can_send: boolean;
};

export type ConversationSummary = DirectConversationSummary | GroupConversationSummary;

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_display_name: string;
  client_message_id: string;
  sequence: MessageSequence;
  body: string;
  created_at: string;
};

export type ConversationCursor = { activityAt: string; id: string };
export type ConversationPage = {
  items: ConversationSummary[];
  /** A full page may be followed by an empty page; no unbounded lookahead is requested. */
  hasMore: boolean;
  nextCursor: ConversationCursor | null;
};
export type MessagePage = {
  /** Newest first. Preserve the oldest sequence when fetching earlier history. */
  items: ConversationMessage[];
  hasMore: boolean;
  nextCursor: MessageSequence | null;
};
export type SendMessageInput = {
  conversationId: string;
  /** Generate once per draft submission; retain this ID and body after a failed/ambiguous send. */
  clientMessageId: string;
  body: string;
};

export type GroupInvitationSummary = {
  id: string;
  conversation_id: string;
  group_title: string;
  course_id: string;
  course_code: string;
  course_title: string;
  invited_by_profile_id: string;
  invited_by_display_name: string;
  active_member_count: number;
  status: 'pending';
  created_at: string;
};

export type GroupInvitationCursor = {
  createdAt: string;
  id: string;
};
export type GroupInvitationPage = {
  items: GroupInvitationSummary[];
  /** A full page may be followed by an empty page; no unbounded lookahead is requested. */
  hasMore: boolean;
  nextCursor: GroupInvitationCursor | null;
};

export type GroupMemberSummary = {
  profile_id: string;
  display_name: string;
  role: GroupMemberRole;
  joined_at: string;
};

export type GroupManagementMemberSummary = GroupMemberSummary & {
  /** Manager-only optimistic token for mutations targeting this membership epoch. */
  membership_period: number;
};

export type GroupPendingInvitation = {
  id: string;
  invitee_profile_id: string;
  invitee_display_name: string;
  invited_by_profile_id: string;
  invited_by_display_name: string;
  created_at: string;
};

export type GroupManagementSnapshot = {
  conversation_id: string;
  title: string;
  management_revision: GroupManagementRevision;
  members: GroupManagementMemberSummary[];
  pending_invitations: GroupPendingInvitation[];
};
