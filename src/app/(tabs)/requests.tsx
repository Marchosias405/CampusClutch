import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
import { useRequests } from "../../context/RequestsContext";
import type { RequestCategory } from "../../types";





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
    const { requests } = useRequests();

    const [selectedFilter, setSelectedFilter] = useState<RequestCategory>("ALL");

    const visibleRequests = useMemo(() => {
      if (selectedFilter === "ALL") {
        return requests;
      }

      return requests.filter((request) => request.category === selectedFilter);
    }, [selectedFilter, requests]);

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
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.balanceBar}>
            <View style={styles.balanceIcon}>
              <FontAwesome5 name="star" size={14} color="#FFFFFF" solid />
            </View>

            <View style={styles.balanceTextBlock}>
              <Text style={styles.balanceLabel}>Your balance</Text>
              <Text style={styles.balanceAmount}>1,250 points</Text>
            </View>

            <View style={styles.balanceTrend}>
              <Ionicons name="trending-up" size={14} color={COLORS.primary} />
              <Text style={styles.balanceTrendText}>+95 this week</Text>
            </View>
          </View>

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
            {visibleRequests.map((item) => (
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

                  <Text style={styles.pointsText}>{item.points} pts</Text>
                </View>

                <Text style={styles.requestTitle} numberOfLines={1}>
                  {item.title}
                </Text>

                <Text style={styles.requestDescription} numberOfLines={2}>
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
                      <Text style={styles.metaText} numberOfLines={1}>
                        {item.location}
                      </Text>
                    </View>

                    <View style={styles.metaItem}>
                      <Ionicons name="time" size={14} color="#747474" />
                      <Text style={styles.metaText} numberOfLines={1}>
                        {item.timeLabel}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.offerButton}
                    onPress={() => handleOfferHelp(item.id)}
                  >
                    <Text style={styles.offerButtonText}>Offer Help</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  metaRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 10,
  },

  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 15,
    maxWidth: 105,
  },

  metaText: {
    marginLeft: 5,
    fontSize: 11,
    fontWeight: "700",
    color: "#747474",
  },

  offerButton: {
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
});
