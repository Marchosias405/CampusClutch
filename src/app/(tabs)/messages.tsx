import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  inactiveGray: "#A5AAB3",
  tagGray: "#F4F1F1",
  softPink: "#FBECEC",
  searchGray: "#F2F0F0",
};

type ConversationType = "person" | "delivery" | "group";

type Conversation = {
  id: string;
  name: string;
  badge: string;
  preview: string;
  time: string;
  unread: boolean;
  type: ConversationType;
  avatar?: string;
};

const filters = ["All", "Courses", "Deliveries", "Unread"] as const;
type Filter = (typeof filters)[number];

const conversations: Conversation[] = [
  {
    id: "marcus",
    name: "Marcus Jenkins",
    badge: "CMPT 361",
    preview: "Hey! Are we still meeting at the library at 4?",
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
    preview: "Perfect, see you then. Thanks for the notes!",
    time: "Yesterday",
    unread: false,
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Sarah&backgroundColor=ffd5dc",
    type: "person",
  },
  {
    id: "delivery",
    name: "CampusLoop Delivery",
    badge: "ACTIVE ORDER",
    preview: "Your Starbucks order from Student Union is on the way.",
    time: "Tuesday",
    unread: true,
    type: "delivery",
  },
  {
    id: "alex",
    name: "Alex Rodriguez",
    badge: "CMPT 361",
    preview: "I found the textbook link you were looking for.",
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
    preview: "Should we book the private room in the library?",
    time: "Oct 10",
    unread: false,
    type: "group",
  },
];

export default function MessagesInboxScreen() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<Filter>("All");

  const visibleConversations = useMemo(() => {
    const q = search.trim().toLowerCase();

    return conversations.filter((item) => {
      if (selectedFilter === "Unread" && !item.unread) return false;
      if (selectedFilter === "Deliveries" && item.type !== "delivery") return false;
      if (selectedFilter === "Courses" && item.type === "delivery") return false;
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !item.preview.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [search, selectedFilter]);

  const openChat = (id: string) => {
    router.push({ pathname: "/messages/[id]", params: { id } } as any);
  };

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Messages</Text>

          <Pressable
            hitSlop={10}
            onPress={() => router.push("/messages/new" as any)}
          >
            <FontAwesome5 name="edit" size={19} color="#FFFFFF" />
          </Pressable>
        </ScreenHeader>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={COLORS.inactiveGray} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search conversations"
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable hitSlop={10} onPress={() => setSearch("")}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={COLORS.inactiveGray}
                />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
            keyboardShouldPersistTaps="handled"
          >
            {filters.map((filter) => {
              const isActive = selectedFilter === filter;

              return (
                <Pressable
                  key={filter}
                  style={[styles.filterPill, isActive && styles.activeFilterPill]}
                  onPress={() => setSelectedFilter(filter)}
                >
                  <Text
                    style={[styles.filterText, isActive && styles.activeFilterText]}
                  >
                    {filter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {visibleConversations.length === 0 ? (
            <Text style={styles.emptyText}>No conversations found.</Text>
          ) : (
            <View style={styles.conversationList}>
              {visibleConversations.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.convRow}
                  onPress={() => openChat(item.id)}
                >
                  <View style={styles.avatarWrap}>
                    {item.type === "person" && (
                      <Image source={{ uri: item.avatar }} style={styles.avatar} />
                    )}

                    {item.type === "delivery" && (
                      <View style={[styles.iconAvatar, styles.deliveryAvatar]}>
                        <FontAwesome5 name="truck" size={18} color="#FFFFFF" />
                      </View>
                    )}

                    {item.type === "group" && (
                      <View style={[styles.iconAvatar, styles.groupAvatar]}>
                        <FontAwesome5 name="users" size={17} color={COLORS.primary} />
                      </View>
                    )}
                  </View>

                  <View style={styles.convBody}>
                    <View style={styles.convTopRow}>
                      <Text style={styles.convName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text
                        style={[styles.convTime, item.unread && styles.unreadTime]}
                      >
                        {item.time}
                      </Text>
                    </View>

                    <View style={styles.convBottomRow}>
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

                      <Text
                        style={[
                          styles.convPreview,
                          item.unread && styles.unreadPreview,
                        ]}
                        numberOfLines={1}
                      >
                        {item.preview}
                      </Text>
                    </View>
                  </View>

                  {item.unread && <View style={styles.unreadDot} />}
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1, backgroundColor: COLORS.background },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#FFFFFF" },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
  searchBar: {
    height: 47,
    borderRadius: 13,
    backgroundColor: COLORS.searchGray,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textDark,
  },
  filtersRow: { paddingBottom: 20 },
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
  filterText: { fontSize: 13, fontWeight: "700", color: COLORS.mutedText },
  activeFilterText: { color: "#FFFFFF" },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
    paddingVertical: 12,
  },
  conversationList: {},
  convRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F4EDED",
  },
  avatarWrap: { marginRight: 13 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.softPink,
  },
  iconAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  deliveryAvatar: { backgroundColor: COLORS.primary },
  groupAvatar: { backgroundColor: COLORS.softPink },
  convBody: { flex: 1 },
  convTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  convName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textDark,
    marginRight: 8,
  },
  convTime: { fontSize: 12, fontWeight: "600", color: COLORS.mutedText },
  unreadTime: { color: COLORS.primary, fontWeight: "800" },
  convBottomRow: { flexDirection: "row", alignItems: "center" },
  badge: {
    backgroundColor: COLORS.tagGray,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginRight: 8,
    maxWidth: 110,
  },
  badgeText: { fontSize: 10, fontWeight: "900", color: "#9B9B9B" },
  activeOrderBadge: { backgroundColor: COLORS.primary },
  activeOrderText: { color: "#FFFFFF" },
  convPreview: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.mutedText,
  },
  unreadPreview: { color: COLORS.textDark, fontWeight: "700" },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginLeft: 10,
  },
});
