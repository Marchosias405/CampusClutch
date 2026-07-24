import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ScreenHeader from "../../components/ScreenHeader";
import { mockStudents } from "../../constants/mockData";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  softPink: "#FBECEC",
  tagGray: "#F4F1F1",
  green: "#34A853",
};

export default function StudentProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const student = mockStudents.find((item) => item.id === id);

  if (!student) {
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

        <View style={styles.notFoundContent}>
          <Ionicons
            name="person-circle-outline"
            size={72}
            color={COLORS.mutedText}
          />

          <Text style={styles.notFoundTitle}>Student not found</Text>

          <Text style={styles.notFoundText}>
            This student profile is unavailable.
          </Text>

          <Pressable
            style={styles.backToClassmatesButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backToClassmatesText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const handleMessage = () => {
    router.push({
      pathname: "/messages/[id]",
      params: { id: student.id },
    } as any);
  };

  const activityNote = student.sharedCourseNote || student.activityNote;

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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarWrap}>
            <Image source={{ uri: student.avatar }} style={styles.avatar} />

            {student.isRecentlyActive && <View style={styles.onlineDot} />}
          </View>

          <Text style={styles.studentName}>{student.name}</Text>

          <Text style={styles.studentMeta}>
            {student.major}, {student.year}
          </Text>

          <View style={styles.campusRow}>
            <Ionicons
              name="location-sharp"
              size={17}
              color={COLORS.primary}
            />
            <Text style={styles.campusText}>{student.campus}</Text>
          </View>

          {student.matchLabel && (
            <View style={styles.matchBadge}>
              <Ionicons name="star" size={14} color={COLORS.primary} />
              <Text style={styles.matchBadgeText}>{student.matchLabel}</Text>
            </View>
          )}

          <Pressable style={styles.messageButton} onPress={handleMessage}>
            <Ionicons
              name="chatbubble-ellipses"
              size={18}
              color="#FFFFFF"
            />
            <Text style={styles.messageButtonText}>Message</Text>
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Student Details</Text>

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="school" size={18} color={COLORS.primary} />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Program</Text>
              <Text style={styles.detailValue}>{student.major}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="calendar" size={18} color={COLORS.primary} />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Year</Text>
              <Text style={styles.detailValue}>{student.year}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="location" size={18} color={COLORS.primary} />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>Campus</Text>
              <Text style={styles.detailValue}>{student.campus}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Shared Interests</Text>

          <View style={styles.interestsRow}>
            {student.sharedInterests.map((interest) => (
              <View key={interest} style={styles.interestTag}>
                <Text style={styles.interestText}>{interest}</Text>
              </View>
            ))}
          </View>
        </View>

        {activityNote && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Connection</Text>

            <View style={styles.connectionBox}>
              <Ionicons
                name={student.activityNote ? "time" : "school"}
                size={19}
                color={COLORS.primary}
              />
              <Text style={styles.connectionText}>{activityNote}</Text>
            </View>
          </View>
        )}
      </ScrollView>
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

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  profileCard: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 26,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
  },

  avatarWrap: {
    width: 112,
    height: 112,
    marginBottom: 16,
  },

  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: COLORS.softPink,
  },

  onlineDot: {
    position: "absolute",
    right: 4,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: COLORS.cardWhite,
    backgroundColor: COLORS.green,
  },

  studentName: {
    fontSize: 27,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  studentMeta: {
    marginTop: 5,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  campusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 5,
  },

  campusText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  matchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: COLORS.softPink,
  },

  matchBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.primary,
  },

  messageButton: {
    width: "100%",
    height: 48,
    marginTop: 22,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  messageButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  sectionCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
  },

  sectionTitle: {
    marginBottom: 16,
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  detailIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softPink,
  },

  detailContent: {
    flex: 1,
  },

  detailLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  detailValue: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  divider: {
    height: 1,
    marginVertical: 13,
    backgroundColor: COLORS.border,
  },

  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  interestTag: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.tagGray,
  },

  interestText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#676060",
  },

  connectionBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.softPink,
  },

  connectionText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: "#7C6666",
  },

  notFoundContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  notFoundTitle: {
    marginTop: 14,
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  notFoundText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
    color: COLORS.mutedText,
  },

  backToClassmatesButton: {
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },

  backToClassmatesText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
