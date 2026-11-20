import { MotionSelection } from '@/components/motion';
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React, { useState } from "react";
import { Text, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnreadMessages } from "../../context/UnreadMessagesContext";

const COLORS = {
  primary: "#9B1C31",
  cardWhite: "#FFFFFF",
  border: "#EFE1E1",
  inactiveGray: "#635C5C",
};

export default function TabLayout() {
  const { unreadCount } = useUnreadMessages();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const labelWidth = Math.max(1, (width - 2 * Math.max(insets.left, insets.right)) / 5 - 2);
  const layoutKey = `${width}:${fontScale}:${insets.left}:${insets.right}`;
  const [measuredLabel, setMeasuredLabel] = useState({ key: layoutKey, height: 0 });
  // Reserve wrapping space before layout, then accommodate the actual platform font.
  const estimatedLines = Math.max(1, Math.ceil(8 * 11 * 0.6 * fontScale / labelWidth));
  const labelHeight = Math.max(14 * fontScale * estimatedLines,
    measuredLabel.key === layoutKey ? measuredLabel.height : 0);
  const badgeHeight = Math.ceil(18 * fontScale);
  const displayedBadge = unreadCount > 0 ? unreadCount > 99 ? '99+' : unreadCount : undefined;
  const badgeWidth = Math.max(badgeHeight, Math.ceil(String(displayedBadge ?? '').length * 8 * fontScale + 8));
  const iconHeight = Math.max(28, badgeHeight);
  const bottomPadding = Math.max(12, insets.bottom);
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.inactiveGray,
        tabBarLabelPosition: "below-icon",
        tabBarAllowFontScaling: true,
        tabBarLabel: ({ color, children }) => (
          <Text
            allowFontScaling
            onLayout={({ nativeEvent }) => {
              const height = Math.ceil(nativeEvent.layout.height);
              setMeasuredLabel(previous => previous.key === layoutKey && previous.height >= height
                ? previous : { key: layoutKey, height });
            }}
            style={{ width: labelWidth, minWidth: 0, alignSelf: "center", textAlign: "center", color,
              fontSize: 11, lineHeight: 14, fontWeight: "700", includeFontPadding: false }}
          >
            {children}
          </Text>
        ),
        tabBarIconStyle: { width: Math.max(31, badgeWidth), height: iconHeight, marginBottom: 4 },
        tabBarBadgeStyle: {
          backgroundColor: COLORS.primary, color: "#FFFFFF", fontSize: 12, lineHeight: 16,
          width: badgeWidth, height: badgeHeight, minWidth: badgeHeight, borderRadius: badgeHeight / 2,
          paddingHorizontal: 3, textAlignVertical: "center", includeFontPadding: false, end: 0,
        },
        tabBarStyle: {
          backgroundColor: COLORS.cardWhite,
          borderTopWidth: 1,
          borderTopColor: COLORS.border,
          height: Math.max(82, Math.ceil(iconHeight + 4 + labelHeight + 10 + 8 + bottomPadding + 1)),
          paddingTop: 8,
          paddingBottom: bottomPadding,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarAccessibilityLabel: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <MotionSelection active={focused} accessible={false}><Ionicons name="home" size={size ?? 22} color={color} /></MotionSelection>
          ),
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: "Courses",
          tabBarAccessibilityLabel: "Courses",
          tabBarIcon: ({ color, size, focused }) => (
            <MotionSelection active={focused} accessible={false}><Ionicons name="school" size={size ?? 22} color={color} /></MotionSelection>
          ),
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: "Requests",
          tabBarAccessibilityLabel: "Requests",
          tabBarIcon: ({ color, size, focused }) => (
            <MotionSelection active={focused} accessible={false}><Ionicons name="list" size={size ?? 22} color={color} /></MotionSelection>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarBadge: displayedBadge,
          tabBarAccessibilityLabel: unreadCount > 0 ? `Messages, ${unreadCount} unread messages` : 'Messages',
          tabBarIcon: ({ color, size, focused }) => (
            <MotionSelection active={focused} accessible={false}><Ionicons name="chatbubble" size={size ?? 22} color={color} /></MotionSelection>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarAccessibilityLabel: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <MotionSelection active={focused} accessible={false}><Ionicons name="person" size={size ?? 22} color={color} /></MotionSelection>
          ),
        }}
      />
    </Tabs>
  );
}
