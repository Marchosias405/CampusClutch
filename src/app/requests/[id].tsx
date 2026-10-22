import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth } from "../../context/AuthContext";
import { loadRequest, cancelRequest, setRequestArchived, requestError } from "../../lib/requests";
import type { CampusRequest } from "../../types";
import ScreenHeader from "../../components/ScreenHeader";
import RequestOffers from "../../components/RequestOffers";
import ReopenRequest from "../../components/ReopenRequest";
import RequestCompletion from "../../components/RequestCompletion";
import RequestRating from "../../components/RequestRating";
import RequestConversation from "../../components/RequestConversation";
import { useRequests } from "../../context/RequestsContext";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  softPink: "#FBECEC",
  coinGold: "#F4A62A",
};

export default function RequestDetailsScreen() {
  const router = useRouter();
  const { invalidate } = useRequests();
  const { user } = useAuth();
  const { id } = useLocalSearchParams();

  const requestId = Array.isArray(id) ? id[0] : id;

  const [storedRequest, setRequest] = useState<CampusRequest | null>(null);
  const [loadedFor, setLoadedFor] = useState<string>();
  const request = user?.id === loadedFor ? storedRequest : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ownerAction, setOwnerAction] = useState<'cancel' | 'archive' | 'restore' | null>(null);
  const [ratingsRevision, setRatingsRevision] = useState(0);
  const lock = useRef(false);
  const focused = useRef(false);
  const scope = `${user?.id}:${requestId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true); setError('');
    try {
      const row = user && requestId ? await loadRequest(requestId) : null;
      if (ticket === sequence.current) { setLoadedFor(user?.id); setRequest(row); }
    } catch (failure) { if (ticket === sequence.current) setError(requestError(failure)); }
    finally { if (ticket === sequence.current) setLoading(false); }
  }, [requestId, user]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { focused.current = false; clearInterval(timer); ++sequence.current; setRequest(null); };
  }, [refresh]));
  const performOwnerAction = async (action: 'cancel' | 'archive' | 'restore') => {
    if (!user || !request || request.ownerId !== user.id || lock.current || !focused.current || currentScope.current !== scope) return;
    lock.current = true; setOwnerAction(action); setError('');
    try {
      if (action === 'cancel') {
        if (request.status !== 'open' && request.status !== 'accepted') return;
        await cancelRequest(user.id, request.id, request.offerRound ?? 1, request.status);
      } else {
        await setRequestArchived(user.id, request.id, action === 'archive');
      }
      invalidate();
      if (focused.current && currentScope.current === scope) await refresh();
    } catch (failure) {
      if (focused.current && currentScope.current === scope) setError(requestError(failure));
    } finally {
      lock.current = false;
      setOwnerAction(null);
    }
  };
  const handleCancel = () => {
    const accepted = request?.status === 'accepted';
    Alert.alert(accepted ? 'Cancel accepted request?' : 'Cancel request?', accepted
      ? 'This ends the arrangement with your helper and releases reserved points to your available balance. No points will be paid. You can both rate the cancelled assignment. If the work is finished, use Confirm completion instead.'
      : 'It will leave the campus feed and remain in your history.', [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => { void performOwnerAction('cancel'); } },
    ]);
  };
  const handleArchive = () => {
    const restoring = Boolean(request?.ownerArchivedAt);
    Alert.alert(restoring ? 'Restore request?' : 'Archive request?', restoring
      ? 'This puts the request back in your main list. Its status and points history stay the same.'
      : 'This removes it from your main list. You can find and restore it under My requests → Archived. Its history is kept.', [
      { text: 'Keep as is', style: 'cancel' },
      { text: restoring ? 'Restore' : 'Archive', onPress: () => { void performOwnerAction(restoring ? 'restore' : 'archive'); } },
    ]);
  };

  if (!request) {
    return (
      <View style={styles.safeArea}>
        <ScreenHeader>
          <Pressable hitSlop={10} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>

          <Text style={styles.headerTitle}>Request Details</Text>

          <View style={styles.headerSpacer} />
        </ScreenHeader>

        <View style={styles.notFoundContainer}>
          <Text style={styles.notFoundTitle}>{loading ? "Loading request…" : error ? "Unable to load request" : "Request unavailable"}</Text>
          <Text style={styles.notFoundText}>
            {error || "This request may be closed, expired, or unavailable to your account."}
          </Text>

          {!loading && !error && requestId && <ScrollView><RequestOffers key={`${user?.id}:${requestId}`} requestId={requestId} onChanged={refresh} /></ScrollView>}
          {!loading && <Pressable style={styles.backButton} onPress={() => { void refresh(); }}><Text style={styles.backButtonText}>Retry</Text></Pressable>}
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back to Requests</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const formatCreatedAt = (createdAt?: string) => {
    if (!createdAt) {
      return "";
    }

    const createdDate = new Date(createdAt);

    if (Number.isNaN(createdDate.getTime())) {
      return createdAt;
    }

    return createdDate.toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };


  const hasAdditionalDetails = Boolean(
    request.campus ||
      request.roomLocation ||
      request.pickupLocation ||
      request.dropoffLocation ||
      request.eventName ||
      request.eventTask ||
      request.courseOrSubject ||
      request.studyTopic ||
      request.itemSize ||
      request.status ||
      request.createdAt
  );


  return (
    <View style={styles.safeArea}>
      <ScreenHeader>
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </Pressable>

        <Text style={styles.headerTitle}>Request Details</Text>

        <View style={styles.headerSpacer} />
      </ScreenHeader>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} />}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{request.category}</Text>
            </View>

            {request.isUrgent && (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentText}>URGENT</Text>
              </View>
            )}
          </View>

          <Text style={styles.title}>{request.title}</Text>

          <Text style={styles.description}>{request.description}</Text>



          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Ionicons
                name="location-sharp"
                size={18}
                color={COLORS.primary}
              />
              <Text style={styles.infoText}>{request.location}</Text>
            </View>

            <View style={styles.infoRow}>
              <Ionicons
                name="time-outline"
                size={18}
                color={COLORS.primary}
              />
              <Text style={styles.infoText}>{request.timeLabel}</Text>
            </View>

            <View style={styles.infoRow}>
              <Ionicons
                name="ellipse"
                size={18}
                color={COLORS.coinGold}
              />
              <Text style={styles.infoText}>{request.points} points</Text>
            </View>
          </View>

          {hasAdditionalDetails && (
            <View style={styles.additionalDetailsSection}>
              <Text style={styles.additionalDetailsTitle}>
                Additional Details
              </Text>

              {request.campus && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Campus</Text>
                  <Text style={styles.detailValue}>{request.campus}</Text>
                </View>
              )}

              {request.roomLocation && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Room/Location</Text>
                  <Text style={styles.detailValue}>
                    {request.roomLocation}
                  </Text>
                </View>
              )}

              {request.pickupLocation && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Pickup Location</Text>
                  <Text style={styles.detailValue}>
                    {request.pickupLocation}
                  </Text>
                </View>
              )}

              {request.dropoffLocation && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>
                    {request.category === "PICKUP"
                      ? "Destination"
                      : "Drop-off Location"}
                  </Text>

                  <Text style={styles.detailValue}>
                    {request.dropoffLocation}
                  </Text>
                </View>
              )}

              {request.eventName && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Event Name</Text>
                  <Text style={styles.detailValue}>
                    {request.eventName}
                  </Text>
                </View>
              )}

              {request.eventTask && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Help Needed</Text>
                  <Text style={styles.detailValue}>
                    {request.eventTask}
                  </Text>
                </View>
              )}

              {request.courseOrSubject && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Course/Subject</Text>
                  <Text style={styles.detailValue}>
                    {request.courseOrSubject}
                  </Text>
                </View>
              )}

              {request.studyTopic && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Study Topic</Text>
                  <Text style={styles.detailValue}>
                    {request.studyTopic}
                  </Text>
                </View>
              )}

              {request.itemSize && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Item/Task Size</Text>
                  <Text style={styles.detailValue}>
                    {request.itemSize}
                  </Text>
                </View>
              )}

              {request.status && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <Text style={styles.statusValue}>
                    {request.status.charAt(0).toUpperCase() +
                      request.status.slice(1)}
                  </Text>
                </View>
              )}

              {request.createdAt && (
                <View style={[styles.detailRow, styles.lastDetailRow]}>
                  <Text style={styles.detailLabel}>Posted</Text>
                  <Text style={styles.detailValue}>
                    {formatCreatedAt(request.createdAt)}
                  </Text>
                </View>
              )}
            </View>
          )}














          {!!error && <Text accessibilityRole="alert" style={styles.notFoundText}>{error}</Text>}
          {request.ownerId === user?.id && (request.status === 'open' || request.status === 'accepted') && <View style={styles.ownerActions}>
            {request.status === 'open' && <Pressable accessibilityRole="button" style={styles.offerButton} disabled={loading || !!ownerAction} onPress={() => router.push({ pathname: '/requests/create', params: { edit: request.id } })}>
              <Text style={styles.offerButtonText}>Edit Request</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" style={[styles.backButton, styles.cancelButton]} disabled={loading || !!ownerAction} onPress={handleCancel}>
              <Text style={styles.backButtonText}>{ownerAction === 'cancel' ? 'Cancelling…' : 'Cancel Request'}</Text>
            </Pressable>
          </View>}
          {request.ownerId === user?.id && ['expired', 'cancelled', 'completed'].includes(request.status ?? '') && <View style={styles.ownerActions}>
            <Text style={styles.acceptedNotice}>{request.ownerArchivedAt ? 'Archived. You can restore this request to your main list without reopening it.' : 'This request is closed. Archive it to remove it from your main list and keep its history.'}</Text>
            <Pressable accessibilityRole="button" style={[styles.backButton, styles.cancelButton]} disabled={loading || !!ownerAction} onPress={handleArchive}>
              <Text style={styles.backButtonText}>{ownerAction === 'archive' ? 'Archiving…' : ownerAction === 'restore' ? 'Restoring…' : request.ownerArchivedAt ? 'Restore Request' : 'Archive Request'}</Text>
            </Pressable>
          </View>}
          {request.ownerId === user?.id && request.status === 'accepted' && <Text style={styles.acceptedNotice}>
            Accepted requests remain in My requests; your helper can find this in My offers.
          </Text>}
          <ReopenRequest key={`reopen:${user?.id}:${request.id}:${request.offerRound ?? 1}`} request={request} disabled={loading || !!ownerAction} onChanged={refresh} />
          {(request.status === 'accepted' || request.status === 'completed') && <RequestCompletion key={`completion:${user?.id}:${request.id}:${request.offerRound ?? 1}`} request={request} disabled={loading || !!ownerAction} onChanged={refresh} />}
          <RequestRating key={`rating:${user?.id}:${request.id}`} requestId={request.id} requestRevision={`${request.offerRound ?? 1}:${request.status}`} disabled={loading || !!ownerAction} onChanged={async () => { setRatingsRevision(value => value + 1); }} />
          <RequestConversation requestId={request.id} requestRevision={`${request.offerRound ?? 1}:${request.status}`} disabled={loading || !!ownerAction} />
          <RequestOffers key={`offers:${user?.id}:${requestId}:${request.offerRound ?? 1}`} request={request} requestId={requestId} ratingsRevision={ratingsRevision} onChanged={refresh} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 36,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  categoryBadge: {
    backgroundColor: COLORS.softPink,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  urgentBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  urgentText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  title: {
    color: COLORS.textDark,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 12,
  },
  description: {
    color: COLORS.mutedText,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 24,
  },
  infoSection: {
    gap: 14,
    marginBottom: 28,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  infoText: {
    color: COLORS.textDark,
    fontSize: 16,
    fontWeight: "600",
  },

  offerButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  ownerActions: {
    gap: 12,
  },
  acceptedNotice: {
    color: COLORS.primary,
    backgroundColor: COLORS.softPink,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
  },
  cancelButton: {
    alignItems: "center",
  },
  offerButtonDisabled: {
    backgroundColor: "#8C8585",
  },
  offerButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  confirmationText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 14,
  },



  notFoundContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notFoundTitle: {
    color: COLORS.textDark,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8,
  },
  notFoundText: {
    color: COLORS.mutedText,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },



  additionalDetailsSection: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 24,
  },

  additionalDetailsTitle: {
    color: COLORS.textDark,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 12,
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  lastDetailRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },

  detailLabel: {
    flex: 1,
    color: COLORS.mutedText,
    fontSize: 13,
    fontWeight: "700",
  },

  detailValue: {
    flex: 1.4,
    color: COLORS.textDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "right",
  },

  statusValue: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "900",
    textTransform: "capitalize",
  },


  
});
