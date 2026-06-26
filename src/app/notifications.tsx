import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../components/ScreenHeader";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  softPink: "#FBECEC",
  green: "#2E9E5B",
  amber: "#E08A1E",
};

type PersonNotification = {
  id: string;
  kind: "person";
  avatar: string;
  text: string;
  highlight: string;
  time: string;
  action?: string;
  unread?: boolean;
};

type SystemNotification = {
  id: string;
  kind: "system";
  icon: string;
  iconColor: string;
  iconBackground: string;
  text: string;
  highlight: string;
  time: string;
  action?: string;
  unread?: boolean;
};

type AppNotification = PersonNotification | SystemNotification;

type NotificationSection = {
  title: string;
  data: AppNotification[];
};

const sections: NotificationSection[] = [
  {
    title: "New",
    data: [
      {
        id: "points-earned",
        kind: "system",
        icon: "star",
        iconColor: COLORS.amber,
        iconBackground: "#FCF1DE",
        highlight: "+30 points",
        text: " earned for completing a delivery. Balance: 120 pts.",
        time: "1h",
        unread: true,
      },
    ],
  },
  {
    title: "This week",
    data: [
      {
        id: "match-jordan",
        kind: "person",
        avatar: "https://api.dicebear.com/7.x/personas/png?seed=Jordan",
        highlight: "Jordan T.",
        text: " is a new classmate match in CMPT 361.",
        time: "Tue",
        action: "Message",
      },
      {
        id: "routes-burnaby",
        kind: "system",
        icon: "route",
        iconColor: COLORS.primary,
        iconBackground: COLORS.softPink,
        highlight: "2 delivery routes",
        text: " to Burnaby are open today. Earn up to 40 pts.",
        time: "Tue",
        action: "View",
      },
      {
        id: "message-mei",
        kind: "person",
        avatar: "https://api.dicebear.com/7.x/personas/png?seed=Mei",
        highlight: "Mei L.",
        text: " sent you a message about the study group.",
        time: "Mon",
        action: "Reply",
      },
      {
        id: "reward-progress",
        kind: "system",
        icon: "gift",
        iconColor: COLORS.green,
        iconBackground: "#E5F4EC",
        highlight: "80 points",
        text: " away from your next reward. Keep it up!",
        time: "Mon",
      },
    ],
  },
  {
    title: "Earlier",
    data: [
      {
        id: "request-done",
        kind: "system",
        icon: "check-circle",
        iconColor: COLORS.green,
        iconBackground: "#E5F4EC",
        highlight: "Library printouts",
        text: " request was marked completed.",
        time: "Jun 18",
      },
      {
        id: "classmates-276",
        kind: "system",
        icon: "user-friends",
        iconColor: COLORS.primary,
        iconBackground: COLORS.softPink,
        highlight: "3 new classmates",
        text: " joined CMPT 276 this week.",
        time: "Jun 15",
        action: "View",
      },
      {
        id: "follow-sarah",
        kind: "person",
        avatar: "https://api.dicebear.com/7.x/personas/png?seed=Sarah",
        highlight: "Sarah Chen",
        text: " joined your CMPT study group.",
        time: "Jun 12",
      },
    ],
  },
];

export default function NotificationsScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Pressable
          style={styles.backRow}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Notifications</Text>
        </Pressable>

        <View />
      </ScreenHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            {section.data.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.row, item.unread && styles.unreadRow]}
              >
                {item.kind === "person" ? (
                  <Image source={{ uri: item.avatar }} style={styles.avatar} />
                ) : (
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: item.iconBackground },
                    ]}
                  >
                    <FontAwesome5
                      name={item.icon}
                      size={16}
                      color={item.iconColor}
                      solid
                    />
                  </View>
                )}

                <View style={styles.rowText}>
                  <Text style={styles.bodyText}>
                    <Text style={styles.highlight}>{item.highlight}</Text>
                    {item.text}
                  </Text>
                  <Text style={styles.time}>{item.time}</Text>
                </View>

                {item.action ? (
                  <Pressable style={styles.actionButton}>
                    <Text style={styles.actionText}>{item.action}</Text>
                  </Pressable>
                ) : item.unread ? (
                  <View style={styles.unreadDot} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 32,
  },

  section: {
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 6,
    marginTop: 8,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 14,
  },

  unreadRow: {
    backgroundColor: COLORS.softPink,
  },

  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 13,
    backgroundColor: COLORS.softPink,
  },

  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  rowText: {
    flex: 1,
    marginRight: 10,
  },

  bodyText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "500",
    color: COLORS.textDark,
  },

  highlight: {
    fontWeight: "900",
  },

  time: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  actionButton: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  actionText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});
