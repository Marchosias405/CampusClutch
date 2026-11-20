import { LoadingSkeleton } from '@/components/LoadingState';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import { useAuth } from '../../context/AuthContext';
import { useUnreadMessages } from '../../context/UnreadMessagesContext';
import { env } from '../../lib/env';
import { getConversationThreadPresentation, getMessageSenderLabel } from '../../lib/groupMessagingUi';
import { loadConversationSummary, loadMessagePage, loadMessageReadReceipts, markConversationRead, messagingError, sendMessage } from '../../lib/messages';
import { compareSequences, createMessageThread, isConversationId } from '../../lib/messageThread';
import { GROUP_MESSAGING_ENABLED } from '../../lib/messagingFeatures';
import type { ConversationMessage, ConversationSummary } from '../../types/messaging';

const PRIMARY = '#9B1C31';

function canReportMessage(message: ConversationMessage, summary: ConversationSummary | null, userId: string, conversationId: string) {
  return summary?.type === 'direct' && summary.id === conversationId
    && message.conversation_id === conversationId && isConversationId(message.id)
    && isConversationId(message.sender_id) && message.sender_id.toLowerCase() !== userId.toLowerCase();
}

export default function ChatScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const routeId = typeof id === 'string' ? id.toLowerCase() : '';
  if (!user || !isConversationId(routeId)) return <Unavailable signedOut={!user} />;
  // Never render a previous account or route's snapshot while effects catch up.
  return <MessageThread key={`${user.id}:${routeId}`} userId={user.id} conversationId={routeId} />;
}

function Unavailable({ signedOut }: { signedOut: boolean }) {
  const router = useRouter();
  return <View style={styles.screen}>
    <ScreenHeader><Pressable accessibilityRole="button" accessibilityLabel="Back to messages" onPress={() => router.replace('/(tabs)/messages')} style={styles.back}>
      <Ionicons name="arrow-back" size={24} color="white" /><Text style={styles.headerName}>Messages</Text>
    </Pressable></ScreenHeader>
    <View style={styles.empty}><Text style={styles.emptyTitle}>{signedOut ? 'Sign in to read messages' : 'Conversation unavailable'}</Text>
      <Text style={styles.description}>{signedOut ? 'Your messages are available only to your signed-in account.' : 'Open a conversation from Messages, a classmate, a student profile, or a request. Old sample chats are no longer available.'}</Text>
    </View>
  </View>;
}

function MessageThread({ userId, conversationId }: { userId: string; conversationId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUnread, subscribeMessages } = useUnreadMessages();
  const model = useMemo(() => createMessageThread(userId, conversationId, {
    namespace: env.supabaseUrl, storage: AsyncStorage, randomUUID: () => globalThis.crypto.randomUUID(),
    loadSummary: loadConversationSummary, loadPage: loadMessagePage,
    loadReadReceipts: loadMessageReadReceipts,
    send: sendMessage, markRead: async (actorId, chatId, sequence) => {
      const result = await markConversationRead(actorId, chatId, sequence);
      void refreshUnread();
      return result;
    }, errorText: messagingError,
  }), [userId, conversationId, refreshUnread]);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => subscribeMessages(changedId => {
    if (changedId === null || changedId === conversationId) model.invalidate();
  }), [conversationId, model, subscribeMessages]);
  const listRef = useRef<FlatList<ConversationMessage>>(null);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const [active, setActive] = useState(false);
  const visibleSequence = useRef<string | null>(null);
  const atBottom = useRef(true);
  const previousNewest = useRef<string | undefined>(undefined);
  const revealNewestAfterLayout = useRef<string | undefined>(undefined);
  const [newMessages, setNewMessages] = useState(false);
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60, minimumViewTime: 500 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ConversationMessage>[] }) => {
    const sequences = viewableItems.filter(item => item.isViewable && item.item.sender_id !== userId).map(item => item.item.sequence);
    visibleSequence.current = sequences.sort((a, b) => compareSequences(b, a))[0] ?? null;
    if (visibleSequence.current) void model.observe(visibleSequence.current);
  }).current;

  const updateActivity = useCallback(() => {
    const value = focused.current && foreground.current;
    setActive(value); model.setActive(value);
  }, [model]);
  useFocusEffect(useCallback(() => {
    focused.current = true; foreground.current = AppState.currentState === 'active'; updateActivity();
    return () => { focused.current = false; updateActivity(); };
  }, [updateActivity]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => { foreground.current = next === 'active'; updateActivity(); });
    return () => { subscription.remove(); model.setActive(false); };
  }, [model, updateActivity]);
  useEffect(() => {
    if (active && visibleSequence.current) void model.observe(visibleSequence.current);
  }, [active, model, state.messages]);
  useLayoutEffect(() => {
    const newest = state.messages[0];
    if (newest && previousNewest.current && newest.id !== previousNewest.current) {
      if (newest.sender_id === userId || atBottom.current) {
        revealNewestAfterLayout.current = newest.id;
        setNewMessages(false);
      } else {
        revealNewestAfterLayout.current = undefined;
        setNewMessages(true);
      }
    }
    previousNewest.current = newest?.id;
  }, [state.messages, userId]);

  const presentation = state.summary ? getConversationThreadPresentation(state.summary) : null;
  const name = presentation?.title ?? 'Conversation';
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const closed = !!presentation?.isReadOnly;
  const canSend = active && state.restored && !!state.summary && !state.sending
    && (!!state.pending || (!closed && !!state.draft.trim()));
  const subtitle = presentation?.subtitle ?? 'Conversation';
  const peerId = state.summary?.type === 'direct' && !state.summary.other_profile_deleted && state.summary.id === conversationId
    && isConversationId(state.summary.other_profile_id)
    && state.summary.other_profile_id.toLowerCase() !== userId.toLowerCase()
    ? state.summary.other_profile_id : null;
  const openPeerProfile = () => {
    const current = model.getSnapshot().summary;
    if (!focused.current || !foreground.current || !peerId
      || current?.type !== 'direct' || current.id !== conversationId
      || current.other_profile_id !== peerId || current.other_profile_deleted) return;
    router.push({ pathname: '/students/[id]', params: { id: peerId } });
  };
  const openMessageReport = (messageId: string) => {
    if (!focused.current || !foreground.current) return;
    const current = model.getSnapshot();
    const message = current.messages.find(row => row.id === messageId);
    if (!message || !canReportMessage(message, current.summary, userId, conversationId)) return;
    router.push({ pathname: '/safety/report', params: { targetType: 'message', targetId: message.id } });
  };
  const identity = <>
    <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>
    <View style={styles.headerTitle}><Text style={styles.headerName} numberOfLines={2}>{name}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {peerId && <Text style={styles.subtitle}>View profile</Text>}</View>
  </>;
  const count = Array.from(state.pending?.body ?? state.draft.trim()).length;
  const send = () => { if (canSend) void model.send(); };
  const discard = () => Alert.alert('Discard this saved attempt?',
    'The message may already have been delivered. Discarding removes this draft and its retry ID from this device; it does not delete a sent message. Refresh or retry first to check its status.', [
      { text: 'Keep message', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { if (focused.current && foreground.current) void model.discardPending(); } },
    ]);

  // Also gate the shared route: an old conversation link must not reopen a
  // group while its dedicated screens are deferred.
  if (!GROUP_MESSAGING_ENABLED && state.summary?.type === 'group') return <Unavailable signedOut={false} />;

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to messages" hitSlop={10} style={styles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/messages')}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </Pressable>
      {peerId ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`}
        accessibilityHint="Opens this student's profile" accessibilityState={{ disabled: !active }}
        disabled={!active} style={styles.headerIdentity} onPress={openPeerProfile}>
        {identity}
      </Pressable> : <View style={styles.headerIdentity}>{identity}</View>}
      {presentation?.canOpenGroupDetails && <Pressable accessibilityRole="button" accessibilityLabel="View group details"
        hitSlop={10} style={styles.refresh} onPress={() => router.push({ pathname: '/messages/groups/[id]', params: { id: conversationId } })}>
        <Ionicons name="people-outline" size={23} color="white" />
      </Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh conversation" accessibilityState={{ disabled: !active || state.loading || state.loadingOlder }}
        disabled={!active || state.loading || state.loadingOlder} hitSlop={10} style={styles.refresh} onPress={() => { void model.refresh(); }}>
        {state.loading ? <ActivityIndicator color="white" /> : <Ionicons name="refresh" size={23} color="white" />}
      </Pressable>
    </ScreenHeader>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      {!!(state.error || state.readError || state.receiptError || state.storageError || state.sendError || state.pending || (state.summary && closed)) &&
        <ScrollView style={styles.feedback} keyboardShouldPersistTaps="handled" nestedScrollEnabled
          accessibilityLabel="Message status and recovery">
      {!!state.error && <View style={styles.banner}><Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>
        <Pressable accessibilityRole="button" disabled={state.loading || !active} onPress={() => { void model.refresh(); }}><Text style={styles.link}>Retry loading messages</Text></Pressable></View>}
      {!!state.readError && <Text accessibilityRole="alert" style={styles.note}>{state.readError}</Text>}
      {!!state.receiptError && <Text accessibilityRole="alert" style={styles.note}>{state.receiptError}</Text>}
      {!!state.storageError && <View style={styles.banner}><Text accessibilityRole="alert" style={styles.error}>{state.storageError}</Text>
        <Pressable accessibilityRole="button" disabled={state.sending || !active} onPress={() => { void model.retryStorage(); }}><Text style={styles.link}>Retry draft storage</Text></Pressable></View>}
      {!!state.sendError && <Text accessibilityRole="alert" style={styles.errorBanner}>{state.sendError}</Text>}
      {state.pending && <View style={styles.banner}><Text style={styles.note}>{state.sending ? 'Sending…' : 'This message is not confirmed. Retry sends the same saved message once.'}</Text>
        {!state.sending && <Pressable accessibilityRole="button" onPress={discard}><Text style={styles.link}>Discard saved attempt</Text></Pressable>}
      </View>}
      {state.summary && closed && <Text style={styles.note}>{presentation?.readOnlyMessage} Saved attempts can still be checked with Retry.</Text>}
        </ScrollView>}
      <FlatList ref={listRef} style={styles.flex} data={state.messages} inverted keyExtractor={item => item.id}
        extraData={state.readReceipts}
        contentContainerStyle={styles.threadContent} keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        viewabilityConfig={viewabilityConfig} onViewableItemsChanged={onViewableItemsChanged}
        onContentSizeChange={() => {
          const newest = state.messages[0]?.id;
          if (!newest || revealNewestAfterLayout.current !== newest) return;
          revealNewestAfterLayout.current = undefined;
          atBottom.current = true;
          setNewMessages(false);
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }}
        onScroll={event => { atBottom.current = event.nativeEvent.contentOffset.y < 48; if (atBottom.current) setNewMessages(false); }} scrollEventThrottle={100}
        ListEmptyComponent={state.error ? null : state.loading
          ? <LoadingSkeleton variant="conversation" label="Loading messages" />
          : <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{state.summary ? 'No messages yet' : 'Unable to open conversation'}</Text>
            <Text style={styles.description}>{state.summary
              ? closed ? presentation?.readOnlyMessage ?? 'No messages are available in this read-only conversation.' : 'Send a message to start the conversation.'
              : 'Refresh to load this conversation.'}</Text>
          </View>}
        ListFooterComponent={state.hasMore ? <Pressable accessibilityRole="button" disabled={state.loadingOlder || state.loading || !active}
          onPress={() => { void model.loadOlder(); }} style={styles.older}>
          {state.loadingOlder ? <ActivityIndicator color={PRIMARY} /> : <Text style={styles.link}>Load earlier messages</Text>}
        </Pressable> : null}
        renderItem={({ item }) => {
          const mine = item.sender_id === userId;
          const receipt = mine ? state.readReceipts?.[item.id] : undefined;
          return <View style={[styles.bubbleRow, mine ? styles.rowMe : styles.rowThem]}>
            <View style={styles.bubbleColumn}>
              <Text style={[styles.sender, mine && styles.timeRight]}>{state.summary ? getMessageSenderLabel(item, userId, state.summary) : mine ? 'You' : item.sender_display_name}</Text>
              <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleThem]}>
                <Text selectable style={[styles.messageText, mine && styles.textMe]}>{item.body}</Text>
              </View>
              <Text style={[styles.timeLabel, mine && styles.timeRight]}>{mine ? 'Sent ' : ''}{new Date(item.created_at).toLocaleString([], {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}</Text>
              {receipt?.is_read && <Text style={[styles.timeLabel, styles.timeRight]}>
                Read{receipt.read_at ? ` ${new Date(receipt.read_at).toLocaleString([], {
                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}` : ''}
              </Text>}
              {canReportMessage(item, state.summary, userId, conversationId) && <Pressable
                accessibilityRole="button" accessibilityLabel="Report message" testID={`report-message-${item.id}`}
                accessibilityHint="Opens a private report about this message"
                accessibilityState={{ disabled: !active }} disabled={!active}
                style={styles.reportButton} onPress={() => openMessageReport(item.id)}>
                <Text style={styles.reportText}>Report message</Text>
              </Pressable>}
            </View>
          </View>;
        }} />
      {newMessages && <Pressable accessibilityRole="button" style={styles.newMessages} onPress={() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true }); setNewMessages(false);
      }}><Text style={styles.link}>Jump to latest messages</Text></Pressable>}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.inputWrap}><TextInput accessibilityLabel="Message text" value={state.pending?.body ?? state.draft}
          editable={active && state.restored && !!state.summary && !closed && !state.pending && !state.sending}
          onChangeText={model.setDraft} placeholder={state.restored ? 'Message' : 'Restoring draft…'} placeholderTextColor="#635C5C"
          style={styles.input} multiline />
          {count > 3800 && <Text style={count > 4000 ? styles.error : styles.note}>{count.toLocaleString()} / 4,000</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={state.pending ? 'Retry saved message' : 'Send message'} accessibilityState={{ disabled: !canSend, busy: state.sending }}
          style={[styles.sendButton, !canSend && styles.sendDisabled]} onPress={send} disabled={!canSend}>
          {state.sending ? <ActivityIndicator color="white" /> : state.pending ? <Text style={styles.sendText}>Retry</Text> : <Ionicons name="arrow-up" size={22} color="white" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' }, flex: { flex: 1 },
  back: { minWidth: 48, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginRight: 10 },
  headerIdentity: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 34, height: 34, flexShrink: 0, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  initials: { color: 'white', fontSize: 13, fontWeight: '800' }, headerTitle: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  headerName: { fontSize: 16, fontWeight: '800', color: 'white' }, subtitle: { fontSize: 11, color: 'rgba(255,255,255,0.85)' }, refresh: { padding: 8, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  feedback: { maxHeight: '35%', flexGrow: 0, flexShrink: 1 },
  threadContent: { paddingHorizontal: 16, paddingVertical: 12, flexGrow: 1 },
  empty: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { color: '#2B2525', fontWeight: '800', fontSize: 20, textAlign: 'center' },
  description: { color: '#635C5C', textAlign: 'center', lineHeight: 22 },
  bubbleRow: { width: '100%', flexDirection: 'row', marginBottom: 12 }, rowMe: { justifyContent: 'flex-end' }, rowThem: { justifyContent: 'flex-start' },
  bubbleColumn: { maxWidth: '83%' }, bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMe: { backgroundColor: PRIMARY, borderBottomRightRadius: 6 }, bubbleThem: { backgroundColor: '#F1EEEE', borderBottomLeftRadius: 6 },
  messageText: { fontSize: 15, lineHeight: 21, color: '#2B2525' }, textMe: { color: 'white' },
  sender: { color: '#635C5C', fontSize: 11, marginBottom: 4 }, timeLabel: { color: '#635C5C', fontSize: 10, marginTop: 4 }, timeRight: { alignSelf: 'flex-end' },
  reportButton: { minHeight: 48, minWidth: 48, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8 },
  reportText: { color: PRIMARY, fontSize: 12, fontWeight: '700' },
  older: { padding: 16, alignItems: 'center' }, banner: { paddingHorizontal: 16, paddingVertical: 8, gap: 6, backgroundColor: '#FAF7F7' },
  error: { color: '#9B1C31', fontSize: 13, lineHeight: 19 }, errorBanner: { color: '#9B1C31', paddingHorizontal: 16, paddingVertical: 8, fontSize: 13 },
  note: { color: '#635C5C', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 }, link: { color: PRIMARY, fontWeight: '700', paddingVertical: 12, minHeight: 48 },
  newMessages: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAF0F1', padding: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#ECE3E3', backgroundColor: 'white' },
  inputWrap: { flex: 1, minHeight: 48, maxHeight: 150, borderRadius: 21, backgroundColor: '#F2F0F0', paddingHorizontal: 16, paddingVertical: 7 },
  input: { fontSize: 15, maxHeight: 120, color: '#2B2525' },
  sendButton: { minWidth: 48, minHeight: 48, borderRadius: 23, paddingHorizontal: 10, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#D8C2C2' }, sendText: { color: 'white', fontSize: 12, fontWeight: '800' },
});
