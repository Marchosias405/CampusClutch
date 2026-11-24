export const NOTIFICATION_EVENT_TYPES = [
  'offer_created', 'offer_accepted', 'offer_rejected', 'offer_withdrawn',
  'another_helper_selected', 'request_cancelled', 'request_expired',
  'request_reopened', 'request_completed', 'message_received', 'account_warning', 'appeal_decided',
] as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];
export type NotificationNavigationKey = 'request_details' | 'conversation' | 'account_notice';
export type NotificationItem = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  event_type: NotificationEventType;
  title: string;
  body: string;
  request_id: string | null;
  offer_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  navigation_key: NotificationNavigationKey;
  read_at: string | null;
  created_at: string;
};
export type NotificationCursor = { createdAt: string; id: string };
export type NotificationPage = {
  /** Newest first, with exact timestamp and UUID keyset boundaries. */
  items: NotificationItem[];
  /** A full page may be followed by an empty final page. */
  hasMore: boolean;
  nextCursor: NotificationCursor | null;
};
