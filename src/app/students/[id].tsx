import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
};

export default function StudentProfilePlaceholderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.safeArea}>
      <ScreenHeader>
        <Pressable
          style={styles.backRow}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Student Profile</Text>
        </Pressable>

        <View />
      </ScreenHeader>

      <View style={styles.content}>
        <Text style={styles.title}>Profile page works</Text>
        <Text style={styles.subtitle}>Student ID: {id}</Text>

        <Text style={styles.note}>
          Later, replace this placeholder with the full Aisha R. profile screen.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  content: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 12,
  },

  note: {
    fontSize: 14,
    color: COLORS.mutedText,
    textAlign: "center",
    lineHeight: 20,
  },
});