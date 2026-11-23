import { LoadingSkeleton } from '@/components/LoadingState';
import { useDirectAdmin } from '../../lib/useDirectAdmin';
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
  useWindowDimensions,
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
  mutedText: "#635C5C",
  border: "#ECE3E3",
  softPink: "#FBECEC",
  coinGold: "#F4A62A",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RequestDetailsScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams();
  const requestId = Array.isArray(id) ? id[0] : id;
  return <RequestDetails key={`${user?.id}:${requestId}`} userId={user?.id} requestId={requestId} />;
}

function RequestDetails({ userId, requestId }: { userId?: string; requestId?: string }) {
  const router = useRouter();
  const admin = useDirectAdmin(userId ?? '');
  const { width, fontScale } = useWindowDimensions();
  const stackDetails = width / fontScale < 420;
  const detailRowStyle = [styles.detailRow, stackDetails && styles.stackedDetailRow];
  const detailLabelStyle = [styles.detailLabel, stackDetails && styles.stackedDetailText];
  const detailValueStyle = [styles.detailValue, stackDetails && styles.stackedDetailText];
  const { invalidate } = useRequests();
  const [request, setRequest] = useState<CampusRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ownerAction, setOwnerAction] = useState<'cancel' | 'archive' | 'restore' | null>(null);
  const [ratingsRevision, setRatingsRevision] = useState(0);
  const lock = useRef(false);
  const focused = useRef(false);
  const focusEpoch = useRef(0);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!focused.current) return;
    const ticket = ++sequence.current;
    setLoading(true); setError('');
    try {
      const row = userId && requestId ? await loadRequest(requestId) : null;
      if (ticket === sequence.current) setRequest(row);
    } catch (failure) { if (ticket === sequence.current) setError(requestError(failure)); }
    finally { if (ticket === sequence.current) setLoading(false); }
  }, [requestId, userId]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    return () => { focused.current = false; ++focusEpoch.current; clearInterval(timer); ++sequence.current; setRequest(null); };
  }, [refresh]));
  const performOwnerAction = async (action: 'cancel' | 'archive' | 'restore', epoch: number) => {
    if (!userId || !request || request.ownerId !== userId || lock.current || !focused.current || epoch !== focusEpoch.current) return;
    lock.current = true; setOwnerAction(action); setError('');
    try {
      if (action === 'cancel') {
        if (request.status !== 'open' && request.status !== 'accepted') return;
        await cancelRequest(userId, request.id, request.offerRound ?? 1, request.status);
      } else {
        await setRequestArchived(userId, request.id, action === 'archive');
      }
      invalidate();
      await refresh();
    } catch (failure) {
      if (focused.current && epoch === focusEpoch.current) setError(requestError(failure));
    } finally {
      lock.current = false;
      setOwnerAction(null);
    }
  };
  const handleCancel = () => {
    const epoch = focusEpoch.current;
    const accepted = request?.status === 'accepted';
    Alert.alert(accepted ? 'Cancel accepted request?' : 'Cancel request?', accepted
      ? 'This ends the arrangement with your helper and releases reserved points to your available balance. No points will be paid. You can both rate the cancelled assignment. If the work is finished, use Confirm completion instead.'
      : 'It will leave the campus feed and remain in your history.', [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => { void performOwnerAction('cancel', epoch); } },
    ]);
  };
  const firstPostExpired = request?.status === 'expired' && (request.offerRound ?? 1) === 1;
  const handleArchive = () => {
    const epoch = focusEpoch.current;
    const restoring = Boolean(request?.ownerArchivedAt);
    let message = 'You can find this post under My requests → Archived.';
    if (restoring) {
      message = firstPostExpired
        ? 'This returns the post to My requests. If it received no offers, its 90-day window starts again.'
        : 'This returns the request to your main list. Its status and points history stay the same.';
    }
    Alert.alert(restoring ? 'Restore request?' : 'Archive request?', message, [
      { text: 'Keep as is', style: 'cancel' },
      { text: restoring ? 'Restore' : 'Archive', onPress: () => { void performOwnerAction(restoring ? 'restore' : 'archive', epoch); } },
    ]);
  };

  if (!request) {
    return (
      <View style={styles.safeArea}>
        <ScreenHeader>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBack} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>

          <Text style={styles.headerTitle}>Request Details</Text>

          <View style={styles.headerSpacer} />
        </ScreenHeader>

        <ScrollView style={styles.scrollView} contentContainerStyle={loading && !error ? styles.scrollContent : styles.notFoundContainer}>
          {loading && !error ? <LoadingSkeleton variant="details" rows={1} label="Loading request…" /> : <>
            <Text style={styles.notFoundTitle}>{error ? "Unable to load request" : "Request unavailable"}</Text>
            <Text style={styles.notFoundText}>
              {error || "This request may be closed, expired, or unavailable to your account."}
            </Text>
          </>}

          {!loading && !error && userId && requestId && <View><RequestOffers key={`${userId}:${requestId}`} requestId={requestId} onChanged={refresh} /></View>}
          {!loading && <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => { void refresh(); }}><Text style={styles.backButtonText}>Retry</Text></Pressable>}
          <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back to Requests</Text>
          </Pressable>
        </ScrollView>
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


  let archiveHint = 'Archive this closed request to move it out of your main list.';
  if (request.ownerArchivedAt) {
    archiveHint = 'Archived. You can restore this request to your main list without reopening it.';
  } else if (firstPostExpired) {
    archiveHint = 'If this post received no offers, archive it to keep it beyond 90 days.';
  }

  const hasAdditionalDetails = Boolean(
    request.campus ||
      request.roomLocation ||
      request.pickupLocation ||
      request.dropoffLocation ||
      request.eventName ||
      request.eventTask ||
      request.courseOrSubject ||
      request.studyTopic ||
      request.status ||
      request.createdAt
  );


  return (
    <View style={styles.safeArea}>
      <ScreenHeader>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBack} onPress={() => router.back()}>
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
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Campus</Text>
                  <Text style={detailValueStyle}>{request.campus}</Text>
                </View>
              )}

              {request.roomLocation && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Room/Location</Text>
                  <Text style={detailValueStyle}>
                    {request.roomLocation}
                  </Text>
                </View>
              )}

              {request.pickupLocation && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Pickup Location</Text>
                  <Text style={detailValueStyle}>
                    {request.pickupLocation}
                  </Text>
                </View>
              )}

              {request.dropoffLocation && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>
                    {request.category === "PICKUP"
                      ? "Destination"
                      : "Drop-off Location"}
                  </Text>

                  <Text style={detailValueStyle}>
                    {request.dropoffLocation}
                  </Text>
                </View>
              )}

              {request.eventName && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Event Name</Text>
                  <Text style={detailValueStyle}>
                    {request.eventName}
                  </Text>
                </View>
              )}

              {request.eventTask && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Help Needed</Text>
                  <Text style={detailValueStyle}>
                    {request.eventTask}
                  </Text>
                </View>
              )}

              {request.courseOrSubject && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Course/Subject</Text>
                  <Text style={detailValueStyle}>
                    {request.courseOrSubject}
                  </Text>
                </View>
              )}

              {request.studyTopic && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Study Topic</Text>
                  <Text style={detailValueStyle}>
                    {request.studyTopic}
                  </Text>
                </View>
              )}

              {request.status && (
                <View style={detailRowStyle}>
                  <Text style={detailLabelStyle}>Status</Text>
                  <Text style={styles.statusValue}>
                    {request.status.charAt(0).toUpperCase() +
                      request.status.slice(1)}
                  </Text>
                </View>
              )}

              {request.createdAt && (
                <View style={[detailRowStyle, styles.lastDetailRow]}>
                  <Text style={detailLabelStyle}>Posted</Text>
                  <Text style={detailValueStyle}>
                    {formatCreatedAt(request.createdAt)}
                  </Text>
                </View>
              )}
            </View>
          )}














          {!!error && <Text accessibilityRole="alert" style={styles.notFoundText}>{error}</Text>}
          {request.ownerId === userId && (request.status === 'open' || request.status === 'accepted') && <View style={styles.ownerActions}>
            {request.status === 'open' && <Pressable accessibilityRole="button" style={[styles.offerButton, (loading || !!ownerAction) && styles.offerButtonDisabled]} disabled={loading || !!ownerAction} onPress={() => router.push({ pathname: '/requests/create', params: { edit: request.id } })}>
              <Text style={styles.offerButtonText}>Edit Request</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" style={[styles.backButton, styles.cancelButton, (loading || !!ownerAction) && styles.offerButtonDisabled]} disabled={loading || !!ownerAction} onPress={handleCancel}>
              <Text style={styles.backButtonText}>{ownerAction === 'cancel' ? 'Cancelling…' : 'Cancel Request'}</Text>
            </Pressable>
          </View>}
          {request.ownerId === userId && ['expired', 'cancelled', 'completed'].includes(request.status ?? '') && <View style={styles.ownerActions}>
            <Text style={styles.acceptedNotice}>{archiveHint}</Text>
            <Pressable accessibilityRole="button" style={[styles.backButton, styles.cancelButton, (loading || !!ownerAction) && styles.offerButtonDisabled]} disabled={loading || !!ownerAction} onPress={handleArchive}>
              <Text style={styles.backButtonText}>{ownerAction === 'archive' ? 'Archiving…' : ownerAction === 'restore' ? 'Restoring…' : request.ownerArchivedAt ? 'Restore Request' : 'Archive Request'}</Text>
            </Pressable>
          </View>}
          {request.ownerId === userId && request.status === 'accepted' && <Text style={styles.acceptedNotice}>
            Accepted requests remain in My requests; your helper can find this in My offers.
          </Text>}
          <ReopenRequest key={`reopen:${userId}:${request.id}:${request.offerRound ?? 1}`} request={request} disabled={loading || !!ownerAction} onChanged={refresh} />
          {(request.status === 'accepted' || request.status === 'completed') && <RequestCompletion key={`completion:${userId}:${request.id}:${request.offerRound ?? 1}`} request={request} disabled={loading || !!ownerAction} onChanged={refresh} />}
          <RequestRating key={`rating:${userId}:${request.id}`} requestId={request.id} requestRevision={`${request.offerRound ?? 1}:${request.status}`} disabled={loading || !!ownerAction} onChanged={async () => { setRatingsRevision(value => value + 1); }} />
          <RequestConversation requestId={request.id} requestRevision={`${request.offerRound ?? 1}:${request.status}`} disabled={loading || !!ownerAction} />
          <RequestOffers key={`offers:${userId}:${requestId}:${request.offerRound ?? 1}`} request={request} requestId={requestId} ratingsRevision={ratingsRevision} onChanged={refresh} />
          {admin.allowed && request.ownerId !== userId && <Pressable accessibilityRole="button" style={styles.reportButton} disabled={loading || !!ownerAction}
            onPress={() => { if (focused.current && !loading && !lock.current) admin.open('request', request.id); }}><Text style={styles.reportButtonText}>Admin actions</Text></Pressable>}
            {!!userId && !!request.ownerId && request.ownerId !== userId && UUID_PATTERN.test(request.id) && (
            <Pressable accessibilityRole="button" accessibilityLabel="Report request"
              style={styles.reportButton} disabled={loading} accessibilityState={{ disabled: loading }}
              onPress={() => {
                if (!focused.current || loading) return;
                router.push({ pathname: '/safety/report', params: { targetType: 'request', targetId: request.id } });
              }}>
              <Text style={styles.reportButtonText}>Report request</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  reportButton: { minHeight: 48, marginTop: 20, padding: 12, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reportButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  headerSpacer: {
    width: 48,
  },
  headerBack: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
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
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  categoryBadge: {
    maxWidth: "100%",
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
    maxWidth: "100%",
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
    alignItems: "flex-start",
    gap: 10,
  },
  infoText: {
    flex: 1,
    minWidth: 0,
    color: COLORS.textDark,
    fontSize: 16,
    fontWeight: "600",
  },

  offerButton: {
    minHeight: 48,
    paddingHorizontal: 16,
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
    textAlign: "center",
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
    flexGrow: 1,
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  notFoundTitle: {
    textAlign: "center",
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
    minHeight: 48,
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButtonText: {
    textAlign: "center",
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

  stackedDetailRow: {
    flexDirection: "column",
    gap: 6,
  },

  stackedDetailText: {
    flex: 0,
    maxWidth: "100%",
    textAlign: "left",
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
    flexShrink: 1,
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: "900",
    textTransform: "capitalize",
  },


  
});
