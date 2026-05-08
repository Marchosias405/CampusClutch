import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  filterGray: "#E6E6E6",
  inputGray: "#EDEDED",
  inactiveGray: "#A5AAB3",
};

const filters = ["All Messages", "Courses", "Deliveries", "Unread"];

const conversations = [
  {
    id: "marcus",
    name: "Marcus Jenkins",
    badge: "CMPT 361",
    preview: "Hey! Are we still meeting at the lib...",
    time: "14:02",
    unread: true,
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Marcus&backgroundColor=b6e3f4",
    type: "person",
  },
  {
    id: "sarah",
    name: "Sarah Chen",
    badge: "ECON 201",
    preview: "Perfect, see you then. Thanks for t...",
    time: "Yesterday",
    unread: false,
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Sarah&backgroundColor=ffd5dc",
    type: "person",
  },
  {
    id: "delivery",
    name: "CampusLoop Deliv...",
    badge: "ACTIVE ORDER",
    preview: "Your Starbucks order from Studen...",
    time: "Tuesday",
    unread: false,
    type: "delivery",
    accent: true,
  },
  {
    id: "alex",
    name: "Alex Rodriguez",
    badge: "CMPT 361",
    preview: "I found the textbook link you were l...",
    time: "Oct 12",
    unread: false,
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=AlexRodriguez&backgroundColor=c0aede",
    type: "person",
  },
  {
    id: "jordan",
    name: "Jordan Lee",
    badge: "STUDY GROUP",
    preview: "Should we book the private room i...",
    time: "Oct 10",
    unread: false,
    type: "group",
  },
];

const bottomTabs = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    route: "/",
  },
  {
    id: "courses",
    label: "Courses",
    icon: "book",
    route: "/courses",
  },
  {
    id: "requests",
    label: "Requests",
    icon: "users",
    route: "/requests",
  },
  {
    id: "messages",
    label: "Messages",
    icon: "comment",
    route: "/messages",
  },
  {
    id: "profile",
    label: "Profile",
    icon: "user",
    route: "/profile",
  },
];

export default function MessagesInboxScreen() {
  const router = useRouter();

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
            style={styles.composeButton}
            onPress={() => router.push("/messages/new" as any)}
          >
            <FontAwesome5 name="edit" size={21} color={COLORS.primary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>Messages</Text>

          <View style={styles.searchBar}>
            <Ionicons
              name="search"
              size={21}
              color="#777777"
              style={styles.searchIcon}
            />
            <Text style={styles.searchPlaceholder}>Search conversations</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {filters.map((filter, index) => {
              const isActive = index === 0;

              return (
                <Pressable
                  key={filter}
                  style={[
                    styles.filterPill,
                    isActive && styles.activeFilterPill,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      isActive && styles.activeFilterText,
                    ]}
                  >
                    {filter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.conversationList}>
            {conversations.map((item) => (
              <Pressable
                key={item.id}
                style={styles.cardWrapper}
                onPress={() =>
                router.push({
                pathname: "/messages/[id]",
                params: { id: item.id },
                } as any)
                }
              >
                {item.accent && <View style={styles.accentLine} />}

                <View style={styles.messageCard}>
                  <View style={styles.avatarContainer}>
                    {item.type === "person" && (
                      <Image source={{ uri: item.avatar }} style={styles.avatar} />
                    )}

                    {item.type === "delivery" && (
                      <View style={styles.deliveryAvatar}>
                        <FontAwesome5
                          name="truck"
                          size={20}
                          color={COLORS.cardWhite}
                        />
                      </View>
                    )}

                    {item.type === "group" && (
                      <View style={styles.groupAvatar}>
                        <FontAwesome5
                          name="users"
                          size={18}
                          color="#4D5663"
                        />
                      </View>
                    )}
                  </View>

                  <View style={styles.messageContent}>
                    <View style={styles.titleRow}>
                      <Text style={styles.senderName} numberOfLines={1}>
                        {item.name}
                      </Text>

                      <Text style={styles.timeText}>{item.time}</Text>
                    </View>

                    <View
                      style={[
                        styles.badge,
                        item.type === "delivery" && styles.activeOrderBadge,
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          item.type === "delivery" && styles.activeOrderText,
                        ]}
                        numberOfLines={1}
                      >
                        {item.badge}
                      </Text>
                    </View>

                    <View style={styles.previewRow}>
                      {item.unread && <View style={styles.unreadDot} />}

                      <Text
                        style={[
                          styles.previewText,
                          item.unread && styles.unreadPreviewText,
                        ]}
                        numberOfLines={1}
                      >
                        {item.preview}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={styles.bottomNav}>
          {bottomTabs.map((tab) => {
            const isActive = tab.id === "messages";

            return (
              <Pressable
                key={tab.id}
                style={styles.tabItem}
                onPress={() => router.push(tab.route as any)}
              >
                <FontAwesome5
                  name={tab.icon}
                  size={20}
                  color={isActive ? COLORS.primary : COLORS.inactiveGray}
                  solid
                />

                <Text
                  style={[styles.tabText, isActive && styles.activeTabText]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
    height: 62,
    backgroundColor: COLORS.cardWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  logoAvatar: {
    width: 33,
    height: 33,
    borderRadius: 17,
    marginRight: 12,
  },

  brandText: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primary,
  },

  composeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 110,
  },

  pageTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 22,
  },

  searchBar: {
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.inputGray,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 17,
    marginBottom: 24,
  },

  searchIcon: {
    marginRight: 12,
  },

  searchPlaceholder: {
    fontSize: 17,
    color: "#777777",
    fontWeight: "500",
  },

  filtersRow: {
    paddingBottom: 22,
  },

  filterPill: {
    height: 35,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: COLORS.filterGray,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  activeFilterPill: {
    backgroundColor: COLORS.primary,
  },

  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#777777",
  },

  activeFilterText: {
    color: COLORS.cardWhite,
  },

  conversationList: {
    gap: 16,
  },

  cardWrapper: {
    position: "relative",
  },

  accentLine: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    backgroundColor: COLORS.primary,
    zIndex: 2,
  },

  messageCard: {
    minHeight: 105,
    borderRadius: 12,
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F3E9E9",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  avatarContainer: {
    width: 54,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },

  deliveryAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#EEF0F8",
    alignItems: "center",
    justifyContent: "center",
  },

  messageContent: {
    flex: 1,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  senderName: {
    flex: 1,
    fontSize: 21,
    fontWeight: "900",
    color: COLORS.textDark,
    marginRight: 8,
  },

  timeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#817A7A",
  },

  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#E8E8E8",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
    marginBottom: 7,
  },

  badgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#9B9B9B",
  },

  activeOrderBadge: {
    backgroundColor: COLORS.primary,
  },

  activeOrderText: {
    color: COLORS.cardWhite,
  },

  previewRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginRight: 14,
  },

  previewText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.mutedText,
    fontWeight: "500",
  },

  unreadPreviewText: {
    color: COLORS.textDark,
    fontWeight: "800",
    fontStyle: "italic",
  },

  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 76,
    backgroundColor: COLORS.cardWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingBottom: 10,
  },

  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  tabText: {
    marginTop: 5,
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.inactiveGray,
  },

  activeTabText: {
    color: COLORS.primary,
  },
});