import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
import { useAuth } from "../../context/AuthContext";
import { loadRequests, requestError } from "../../lib/requests";
import type { CampusRequest, RequestCategory } from "../../types";





const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  inactiveGray: "#A5AAB3",
  lightPillGray: "#F4F1F1",
  softPink: "#FBECEC",
};

const filters: RequestCategory[] = [
  "ALL",
  "DELIVERY",
  "EVENT HELP",
  "PICKUP",
  "STUDY HELP",
];


  export default function RequestsFeedScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const [selectedFilter, setSelectedFilter] = useState<RequestCategory>("ALL");
    const [mine, setMine] = useState(false);
    const [requests, setRequests] = useState<CampusRequest[]>([]);
    const [loadedFor, setLoadedFor] = useState<string>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [hasMore, setHasMore] = useState(false);
    const offset = useRef(0);
    const generation = useRef(0);
    const busy = useRef(false);
    const fetchPage = useCallback(async (append = false) => {
      if (!user || (append && busy.current)) return;
      const ticket = ++generation.current;
      busy.current = true;
      setLoading(true); setError("");
      if (!append) { setRequests([]); offset.current = 0; setHasMore(false); }
      try {
        const result = await loadRequests(selectedFilter, mine ? user.id : null, append ? offset.current : 0);
        if (ticket !== generation.current) return;
        setLoadedFor(user.id);
        setRequests(previous => append ? [...previous, ...result.items.filter(item => !previous.some(old => old.id === item.id))] : result.items);
        offset.current = result.nextOffset; setHasMore(result.hasMore);
      } catch (failure) { if (ticket === generation.current) setError(requestError(failure)); }
      finally { if (ticket === generation.current) { setLoading(false); busy.current = false; } }
    }, [user, selectedFilter, mine]);
    useFocusEffect(useCallback(() => {
      void fetchPage();
      const timer = setInterval(() => { void fetchPage(); }, 60000);
      return () => { clearInterval(timer); ++generation.current; busy.current = false; setRequests([]); };
    }, [fetchPage]));
    const visibleRequests = user?.id === loadedFor ? requests : [];

  const handleFilterChange = (filter: RequestCategory) => {
    setSelectedFilter(filter);
  };

  const handleOpenRequest = (id: string) => {
    router.push({
      pathname: "/requests/[id]",
      params: { id },
    } as any);
  };

  const handleOfferHelp = (id: string) => {
    router.push({
      pathname: "/requests/[id]",
      params: { id },
    } as any);
  };

  const handleCreateRequest = () => {
    router.push("/requests/create" as any);
  };

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Requests</Text>

          <Pressable
            hitSlop={10}
            onPress={() => router.push("/notifications" as any)}
          >
            <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
          </Pressable>
        </ScreenHeader>

        <ScrollView
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void fetchPage(); }} />}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={[styles.filterPill, styles.feedToggle]} onPress={() => setMine(value => !value)}>
            <Text style={styles.filterText}>{mine ? "My requests • Show campus feed" : "Campus feed • Show my requests"}</Text>
          </Pressable>
          {loading && <View style={styles.refreshStatus}><ActivityIndicator color={COLORS.primary} /><Text>Refreshing requests…</Text></View>}
          {!!error && <Pressable onPress={() => { void fetchPage(); }}><Text accessibilityRole="alert">{error} Tap to retry.</Text></Pressable>}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {filters.map((filter) => {
              const isActive = selectedFilter === filter;
              const label = filter === "ALL" ? "All" : filter;

              return (
                <Pressable
                  key={filter}
                  style={[
                    styles.filterPill,
                    isActive && styles.activeFilterPill,
                  ]}
                  onPress={() => handleFilterChange(filter)}
                >
                  <Text
                    style={[
                      styles.filterText,
                      isActive && styles.activeFilterText,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>




          <View style={styles.requestList}>
            {visibleRequests.length === 0 && !loading && !error ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyStateIcon}>
                  <Ionicons
                    name="document-text-outline"
                    size={34}
                    color={COLORS.primary}
                  />
                </View>

                <Text style={styles.emptyStateTitle}>
                  No requests found
                </Text>

                <Text style={styles.emptyStateText}>
                  There are currently no requests in this category.
                </Text>

                <Pressable
                  style={styles.emptyStateButton}
                  onPress={handleCreateRequest}
                >
                  <Ionicons
                    name="add"
                    size={19}
                    color={COLORS.cardWhite}
                  />

                  <Text style={styles.emptyStateButtonText}>
                    Create Request
                  </Text>
                </Pressable>
              </View>
            ) : (
              visibleRequests.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.requestCard}
                  onPress={() => handleOpenRequest(item.id)}
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.badgesRow}>
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryBadgeText}>
                          {item.category}
                        </Text>
                      </View>

                      {item.secondaryCategory && (
                        <View style={styles.categoryBadge}>
                          <Text style={styles.categoryBadgeText}>
                            ! {item.secondaryCategory}
                          </Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.pointsText}>
                      {item.points} pts
                    </Text>
                  </View>

                  <Text style={styles.requestTitle} numberOfLines={1}>
                    {item.title}
                  </Text>

                  <Text
                    style={styles.requestDescription}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>

                  <View style={styles.cardBottomRow}>
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <Ionicons
                          name="location-sharp"
                          size={14}
                          color="#747474"
                        />

                        <Text style={styles.metaText}>
                          {item.location}
                        </Text>
                      </View>

                      <View style={styles.metaItem}>
                        <Ionicons
                          name="time"
                          size={14}
                          color="#747474"
                        />

                        <Text style={styles.metaText}>
                          {item.timeLabel}
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      style={styles.offerButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        handleOfferHelp(item.id);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${item.title}`}
                    >
                      <Text style={styles.offerButtonText}>
                        View Details
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))
            )}
          </View>











          {hasMore && <Pressable disabled={loading} style={styles.emptyStateButton} onPress={() => { void fetchPage(true); }}><Text style={styles.emptyStateButtonText}>Load more</Text></Pressable>}
        </ScrollView>

        <Pressable style={styles.fab} onPress={handleCreateRequest}>
          <Ionicons name="add" size={28} color={COLORS.cardWhite} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  headerTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
  },

  balanceBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },

  balanceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  balanceTextBlock: {
    flex: 1,
  },

  balanceLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  balanceAmount: {
    marginTop: 1,
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  balanceTrend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  balanceTrendText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },

  filtersRow: {
    paddingBottom: 16,
  },
  refreshStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  feedToggle: {
    marginBottom: 16,
    marginRight: 0,
  },

  filterPill: {
    height: 35,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E4CACA",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },

  activeFilterPill: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  filterText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  activeFilterText: {
    color: COLORS.cardWhite,
  },

  requestList: {
    gap: 14,
  },

  requestCard: {
    borderRadius: 16,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    paddingVertical: 15,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 11,
  },

  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    flexWrap: "wrap",
    gap: 7,
  },

  categoryBadge: {
    backgroundColor: COLORS.softPink,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#C2606B",
    letterSpacing: 0.2,
  },

  pointsText: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
    marginLeft: 8,
    backgroundColor: COLORS.softPink,
    overflow: "hidden",
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },

  requestTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 5,
  },

  requestDescription: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
    color: "#6D6666",
    marginBottom: 18,
  },

  cardBottomRow: {
    gap: 12,
  },

  metaRow: {
    gap: 6,
  },

  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },

  metaText: {
    flex: 1,
    marginLeft: 5,
    fontSize: 11,
    fontWeight: "700",
    color: "#747474",
  },

  offerButton: {
    alignSelf: "flex-end",
    height: 38,
    paddingHorizontal: 20,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  offerButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.cardWhite,
  },

  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.darkRed,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 10,
  },


  emptyState: {
    minHeight: 260,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  emptyStateIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },

  emptyStateTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
    marginBottom: 7,
  },

  emptyStateText: {
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    color: COLORS.mutedText,
    textAlign: "center",
    marginBottom: 20,
  },

  emptyStateButton: {
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 7,
  },

  emptyStateButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },











});
