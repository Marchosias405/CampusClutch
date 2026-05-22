import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

type RequestCategory = "ALL" | "DELIVERY" | "EVENT HELP" | "PICKUP" | "STUDY HELP";

type CampusRequest = {
  id: string;
  category: Exclude<RequestCategory, "ALL">;
  secondaryCategory?: string;
  title: string;
  description: string;
  location: string;
  timeLabel: string;
  points: number;
  isUrgent?: boolean;
};

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  lightPillGray: "#F4F1F1",
};

const filters: RequestCategory[] = [
  "ALL",
  "DELIVERY",
  "EVENT HELP",
  "PICKUP",
  "STUDY HELP",
];

const mockRequests: CampusRequest[] = [
  {
    id: "surrey-burnaby",
    category: "DELIVERY",
    title: "Surrey -> Burnaby",
    description:
      "Need a package picked up from the Surrey campus registrar and brought to...",
    location: "Surrey Campus",
    timeLabel: "By 8:00 PM",
    points: 30,
  },
  {
    id: "help-set-up-chairs",
    category: "EVENT HELP",
    title: "Help set up chairs",
    description:
      "Setting up for the Student Union gala in the Convocation Mall. Need 4 people fo...",
    location: "Burnaby",
    timeLabel: "Tomorrow, 10:00 AM",
    points: 45,
  },
  {
    id: "calculus-review",
    category: "STUDY HELP",
    secondaryCategory: "URGENT",
    title: "Calculus Review",
    description:
      "Midterm is Monday! Looking for someone to go over derivative rules and integrali...",
    location: "Surrey",
    timeLabel: "Starts in 2h",
    points: 25,
    isUrgent: true,
  },
  {
    id: "library-printouts",
    category: "PICKUP",
    title: "Library printouts",
    description:
      "Printed my thesis draft at the Belzberg Library. Need someone to grab them an...",
    location: "Vancouver",
    timeLabel: "ASAP",
    points: 15,
  },
];

export default function RequestsFeedScreen() {
  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState<RequestCategory>("ALL");

  const visibleRequests = useMemo(() => {
    if (selectedFilter === "ALL") {
      return mockRequests;
    }

    return mockRequests.filter((request) => request.category === selectedFilter);
  }, [selectedFilter]);

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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.appHeader}>
          <View style={styles.brandRow}>
            <Image
              source={{
                uri: "https://api.dicebear.com/7.x/personas/png?seed=CampusLoop",
              }}
              style={styles.logoAvatar}
            />

            <Text style={styles.brandText}>CampusLoop</Text>
          </View>

          <Pressable
            style={styles.headerIconButton}
            onPress={() => router.push("/notifications" as any)}
          >
            <Ionicons name="notifications" size={22} color={COLORS.textDark} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroRow}>
            <View style={styles.heroTextBlock}>
              <Text style={styles.welcomeText}>Welcome back,</Text>
              <Text style={styles.pageTitle}>Campus{"\n"}Requests</Text>
            </View>

            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>BALANCE</Text>

              <View style={styles.balanceRow}>
                <View style={styles.balanceDot} />
                <Text style={styles.balanceAmount}>1,250 pts</Text>
              </View>
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
                <View style={styles.accentLine} />

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
    </SafeAreaView>
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

  appHeader: {
    height: 58,
    backgroundColor: COLORS.cardWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  logoAvatar: {
    width: 31,
    height: 31,
    borderRadius: 16,
    marginRight: 10,
  },

  brandText: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primary,
  },

  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 32,
  },

  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },

  heroTextBlock: {
    flex: 1,
  },

  welcomeText: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.mutedText,
    marginBottom: 6,
  },

  pageTitle: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  balanceCard: {
    width: 105,
    minHeight: 66,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E7D3D3",
    backgroundColor: COLORS.cardWhite,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    marginLeft: 12,
  },

  balanceLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.mutedText,
    letterSpacing: 0.5,
  },

  balanceRow: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
  },

  balanceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginRight: 5,
  },

  balanceAmount: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textDark,
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
    position: "relative",
    minHeight: 166,
    borderRadius: 14,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E7CACA",
    paddingHorizontal: 17,
    paddingVertical: 15,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 7,
    elevation: 2,
  },

  accentLine: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: COLORS.primary,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    flexWrap: "wrap",
    gap: 7,
  },

  categoryBadge: {
    backgroundColor: "#FFE7E9",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#C2606B",
  },

  pointsText: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.primary,
    marginLeft: 8,
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
    borderRadius: 10,
    backgroundColor: COLORS.darkRed,
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
