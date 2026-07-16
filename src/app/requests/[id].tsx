import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
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
  const { requests } = useRequests();
  const { id } = useLocalSearchParams();

  const requestId = Array.isArray(id) ? id[0] : id;

  const request = requests.find((item) => item.id === requestId);

  const [offerSent, setOfferSent] = useState(false);

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
          <Text style={styles.notFoundTitle}>Request not found</Text>
          <Text style={styles.notFoundText}>
            This request does not exist or may have been removed.
          </Text>

          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Back to Requests</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const handleOfferHelp = () => {
    setOfferSent(true);
    console.log("Offer sent for request:", request.id);
  };


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














          <Pressable
            style={[styles.offerButton, offerSent && styles.offerButtonDisabled]}
            onPress={handleOfferHelp}
            disabled={offerSent}
          >
            <Text style={styles.offerButtonText}>
              {offerSent ? "Offer Sent" : "Offer Help"}
            </Text>
          </Pressable>

          {offerSent && (
            <Text style={styles.confirmationText}>
              Your offer has been sent. The requester can message you if they accept.
            </Text>
          )}          
          
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