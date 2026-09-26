/** Postgres bigint cursors stay decimal strings, including beyond JS's safe integer range. */
export type MessageSequence = string;

export type ConversationSummary = {
  id: string;
  type: 'direct';
  status: 'active' | 'closed' | 'removed';
  other_profile_id: string;
  other_display_name: string | null;
  last_message_body: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  last_message_sequence: MessageSequence;
  last_read_sequence: MessageSequence;
  unread_count: number;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
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
