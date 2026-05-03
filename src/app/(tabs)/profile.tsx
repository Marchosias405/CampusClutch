import { FontAwesome5, Ionicons, MaterialIcons } from "@expo/vector-icons";
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
  green: "#34A853",
  inactiveGray: "#A5AAB3",
};

const activities = [
  {
    id: "1",
    title: "Delivered notebook",
    time: "Today, 2:15PM",
    points: "+30",
    pointsColor: COLORS.green,
    icon: "archive",
    iconColor: COLORS.green,
    iconBackground: "#EAF8EF",
  },
  {
    id: "2",
    title: "Requested item",
    time: "Yesterday",
    points: "-25",
    pointsColor: COLORS.primary,
    icon: "shopping-cart",
    iconColor: COLORS.primary,
    iconBackground: "#FFF0F1",
  },
];

const settingsItems = [
  {
    id: "edit-profile",
    title: "Edit Profile",
    icon: "user-edit",
    route: "/profile/edit",
  },
  {
    id: "manage-courses",
    title: "Manage Courses",
    icon: "graduation-cap",
    route: "/courses",
  },
  {
    id: "manage-interests",
    title: "Manage Interests",
    icon: "shapes",
    route: "/profile/interests",
  },
  {
    id: "notifications",
    title: "Notification Settings",
    icon: "bell",
    route: "/notifications",
  },
  {
    id: "privacy",
    title: "Privacy Settings",
    icon: "lock",
    route: "/profile/privacy",
  },
  {
    id: "help",
    title: "Help & Safety",
    icon: "question-circle",
    route: "/help",
  },
];

const bottomTabs = [
  {
    id: "home",
    title: "Home",
    icon: "home",
    route: "/",
  },
  {
    id: "courses",
    title: "Courses",
    icon: "graduation-cap",
    route: "/courses",
  },
  {
    id: "requests",
    title: "Requests",
    icon: "list-alt",
    route: "/requests",
  },
  {
    id: "messages",
    title: "Messages",
    icon: "comment-alt",
    route: "/messages",
  },
  {
    id: "profile",
    title: "Profile",
    icon: "user",
    route: "/profile",
  },
];

export default function ProfileScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <Pressable style={styles.headerIconButton}>
            <Ionicons name="menu" size={27} color={COLORS.textDark} />
          </Pressable>

          <Text style={styles.headerTitle}>Profile</Text>

          <Pressable
            style={styles.headerIconButton}
            onPress={() => router.push("/profile/settings" as any)}
          >
            <Ionicons name="settings-sharp" size={24} color={COLORS.textDark} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.profileSection}>
            <View style={styles.avatarOuter}>
              <Image
                source={{
                  uri: "https://api.dicebear.com/7.x/personas/png?seed=Alex",
                }}
                style={styles.avatar}
              />
            </View>

            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>Alex Rivera</Text>
              <Text style={styles.profileMajor}>Computer Science</Text>

              <View style={styles.badgeRow}>
                <MaterialIcons
                  name="verified"
                  size={14}
                  color={COLORS.primary}
                />
                <Text style={styles.badgeText}>Student Ambassador</Text>
              </View>
            </View>
          </View>

          <View style={styles.pointsCard}>
            <View style={styles.pointsTop}>
              <Text style={styles.balanceLabel}>Total Balance</Text>

              <View style={styles.balanceRow}>
                <Text style={styles.balanceNumber}>120</Text>
                <Text style={styles.balancePoints}>points</Text>
              </View>

              <View style={styles.pointsButtonRow}>
                <Pressable
                  style={styles.sendButton}
                  onPress={() => router.push("/points/send" as any)}
                >
                  <Ionicons
                    name="send"
                    size={17}
                    color={COLORS.primary}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.sendButtonText}>Send Points</Text>
                </Pressable>

                <Pressable
                  style={styles.earnButton}
                  onPress={() => router.push("/points/earn" as any)}
                >
                  <Ionicons
                    name="add-circle"
                    size={17}
                    color={COLORS.cardWhite}
                    style={styles.buttonIcon}
                  />
                  <Text style={styles.earnButtonText}>Earn More</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.activityArea}>
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>Recent Activity</Text>

                <Pressable onPress={() => router.push("/activity" as any)}>
                  <Text style={styles.seeAllText}>See All</Text>
                </Pressable>
              </View>

              {activities.map((item) => (
                <View key={item.id} style={styles.activityRow}>
                  <View
                    style={[
                      styles.activityIconCircle,
                      { backgroundColor: item.iconBackground },
                    ]}
                  >
                    <FontAwesome5
                      name={item.icon}
                      size={16}
                      color={item.iconColor}
                    />
                  </View>

                  <View style={styles.activityTextWrap}>
                    <Text style={styles.activityName}>{item.title}</Text>
                    <Text style={styles.activityTime}>{item.time}</Text>
                  </View>

                  <Text
                    style={[
                      styles.activityPoints,
                      { color: item.pointsColor },
                    ]}
                  >
                    {item.points}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.sectionTitle}>Account Settings</Text>

          <View style={styles.settingsCard}>
            {settingsItems.map((item, index) => (
              <Pressable
                key={item.id}
                style={[
                  styles.settingsRow,
                  index !== settingsItems.length - 1 && styles.settingsDivider,
                ]}
                onPress={() => router.push(item.route as any)}
              >
                <View style={styles.settingsLeft}>
                  <FontAwesome5
                    name={item.icon}
                    size={17}
                    color={COLORS.inactiveGray}
                    style={styles.settingsIcon}
                  />
                  <Text style={styles.settingsText}>{item.title}</Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color="#D3D6DB"
                />
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.logoutButton}>
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.bottomNav}>
          {bottomTabs.map((tab) => {
            const isActive = tab.id === "profile";

            return (
              <Pressable
                key={tab.id}
                style={styles.tabItem}
                onPress={() => router.push(tab.route as any)}
              >
                <FontAwesome5
                  name={tab.icon}
                  size={19}
                  color={isActive ? COLORS.primary : COLORS.inactiveGray}
                  solid
                />

                <Text
                  style={[
                    styles.tabText,
                    isActive && styles.activeTabText,
                  ]}
                >
                  {tab.title}
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

  header: {
    height: 58,
    paddingHorizontal: 17,
    backgroundColor: "#FBFAFA",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },

  headerIconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    flex: 1,
    marginLeft: 7,
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.primary,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 110,
  },

  profileSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
  },

  avatarOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.cardWhite,
  },

  avatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
  },

  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },

  profileName: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  profileMajor: {
    marginTop: 1,
    fontSize: 16,
    color: COLORS.mutedText,
  },

  badgeRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
  },

  badgeText: {
    marginLeft: 5,
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary,
  },

  pointsCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 9,
    overflow: "hidden",
    marginBottom: 26,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },

  pointsTop: {
    backgroundColor: COLORS.darkRed,
    paddingHorizontal: 21,
    paddingTop: 20,
    paddingBottom: 22,
  },

  balanceLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#D6A8AF",
    marginBottom: 4,
  },

  balanceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 23,
  },

  balanceNumber: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },

  balancePoints: {
    marginLeft: 8,
    marginBottom: 6,
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },

  pointsButtonRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  sendButton: {
    height: 41,
    paddingHorizontal: 16,
    borderRadius: 7,
    backgroundColor: COLORS.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  earnButton: {
    height: 41,
    paddingHorizontal: 17,
    borderRadius: 7,
    backgroundColor: "#B95666",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  buttonIcon: {
    marginRight: 8,
  },

  sendButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.primary,
  },

  earnButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },

  activityArea: {
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },

  activityHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },

  activityTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  seeAllText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#B45B67",
  },

  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  activityIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  activityTextWrap: {
    flex: 1,
  },

  activityName: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  activityTime: {
    marginTop: 1,
    fontSize: 12,
    color: COLORS.mutedText,
  },

  activityPoints: {
    fontSize: 17,
    fontWeight: "900",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 14,
  },

  settingsCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 9,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#F4EEEE",
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },

  settingsRow: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  settingsDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F1ECEC",
  },

  settingsLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  settingsIcon: {
    width: 24,
    textAlign: "center",
    marginRight: 13,
  },

  settingsText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6F6868",
  },

  logoutButton: {
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 13,
  },

  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#B45B67",
  },

  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 78,
    backgroundColor: COLORS.cardWhite,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingBottom: 11,
  },

  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  tabText: {
    marginTop: 5,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.inactiveGray,
  },

  activeTabText: {
    color: COLORS.primary,
  },
});