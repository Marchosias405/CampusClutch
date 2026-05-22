import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from "react-native";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
};

export default function StudentProfilePlaceholderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.primary} />
        </Pressable>

        <Text style={styles.headerTitle}>Student Profile</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Profile page works</Text>
        <Text style={styles.subtitle}>Student ID: {id}</Text>

        <Text style={styles.note}>
          Later, replace this placeholder with the full Aisha R. profile screen.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  header: {
    height: 58,
    backgroundColor: COLORS.cardWhite,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
  },

  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: COLORS.textDark,
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