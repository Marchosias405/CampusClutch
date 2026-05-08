import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const COLORS = {
  primary: "#9B1C31",
  cardWhite: "#FFFFFF",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
};

const bottomTabs = [
  { id: "home", label: "Home", icon: "home", route: "/" },
  { id: "courses", label: "Courses", icon: "graduation-cap", route: "/courses" },
  { id: "requests", label: "Requests", icon: "list-alt", route: "/requests" },
  { id: "messages", label: "Messages", icon: "comment-alt", route: "/messages" },
  { id: "profile", label: "Profile", icon: "user", route: "/profile" },
];

type BottomNavProps = {
  activeTab: "home" | "courses" | "requests" | "messages" | "profile";
};

export default function BottomNav({ activeTab }: BottomNavProps) {
  const router = useRouter();

  return (
    <View style={styles.bottomNav}>
      {bottomTabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <Pressable
            key={tab.id}
            style={styles.tabItem}
            onPress={() => router.push(tab.route as any)}
          >
            <FontAwesome5
              name={tab.icon}
              size={18}
              color={isActive ? COLORS.primary : COLORS.inactiveGray}
              solid
            />
            <Text style={[styles.tabText, isActive && styles.activeTabText]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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