import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import BottomNav from "../../components/BottomNav";
import { mockCourses, mockStudents } from "../../constants/mockData";

type MatchFilter = "MOST_SHARED" | "SAME_CAMPUS" | "RECENTLY_ACTIVE";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  tagGray: "#F4F1F1",
  softPink: "#FBECEC",
  green: "#34A853",
};

const filters: { id: MatchFilter; label: string }[] = [
  { id: "MOST_SHARED", label: "Most shared interests" },
  { id: "SAME_CAMPUS", label: "Same campus" },
  { id: "RECENTLY_ACTIVE", label: "Recently active" },
];

export default function ClassmateMatchesScreen() {
  const router = useRouter();
  const { courseId } = useLocalSearchParams<{ courseId?: string }>();

  const [selectedFilter, setSelectedFilter] =
    useState<MatchFilter>("MOST_SHARED");

  const course =
    mockCourses.find((item) => item.id === courseId) ??
    mockCourses.find((item) => item.id === "cmpt-361");

  const visibleStudents = useMemo(() => {
    if (selectedFilter === "SAME_CAMPUS") {
      return mockStudents.filter((student) => student.campus === "Burnaby Campus");
    }

    if (selectedFilter === "RECENTLY_ACTIVE") {
      return mockStudents.filter((student) => student.isRecentlyActive);
    }

    return [...mockStudents].sort(
      (a, b) => b.sharedInterests.length - a.sharedInterests.length
    );
  }, [selectedFilter]);

  const handleViewProfile = (id: string) => {
    router.push({
      pathname: "/students/[id]",
      params: { id },
    } as any);
  };

  const handleMessageStudent = (id: string) => {
    router.push({
      pathname: "/messages/[id]",
      params: { id },
    } as any);
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

          <Pressable onPress={() => router.push("/notifications" as any)}>
            <Ionicons name="notifications" size={22} color={COLORS.primary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.pageTitle}>{course?.code ?? "CMPT 361"} Classmates</Text>

          <Text style={styles.subtitle}>
            Find peers from your {course?.title ?? "Intro to Computer Graphics"} course.
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {filters.map((filter) => {
              const isActive = selectedFilter === filter.id;

              return (
                <Pressable
                  key={filter.id}
                  style={[styles.filterPill, isActive && styles.activeFilterPill]}
                  onPress={() => setSelectedFilter(filter.id)}
                >
                  <Text style={[styles.filterText, isActive && styles.activeFilterText]}>
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.studentsList}>
            {visibleStudents.map((item) => (
              <Pressable
                key={item.id}
                style={styles.studentCard}
                onPress={() => handleViewProfile(item.id)}
              >
                <View style={styles.cardTopRow}>
                  <View style={styles.avatarWrap}>
                    <Image source={{ uri: item.avatar }} style={styles.avatar} />
                    {item.id === "aisha-r" && <View style={styles.onlineDot} />}
                  </View>

                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName} numberOfLines={1}>
                      {item.name}
                    </Text>

                    <Text style={styles.studentMeta} numberOfLines={1}>
                      {item.major}, {item.year}
                    </Text>

                    <View style={styles.campusRow}>
                      <Ionicons name="location-sharp" size={13} color="#6F6A6A" />
                      <Text style={styles.campusText} numberOfLines={1}>
                        {item.campus}
                      </Text>
                    </View>
                  </View>

                  {item.matchLabel && (
                    <View style={styles.matchBadge}>
                      <FontAwesome5 name="star" size={10} color={COLORS.primary} solid />
                      <Text style={styles.matchBadgeText}>{item.matchLabel}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.interestsRow}>
                  {item.sharedInterests.map((interest) => (
                    <View key={interest} style={styles.interestTag}>
                      <Text style={styles.interestText}>{interest}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.noteBox}>
                  <FontAwesome5
                    name={item.activityNote ? "history" : "graduation-cap"}
                    size={12}
                    color={COLORS.primary}
                    solid
                  />
                  <Text style={styles.noteText} numberOfLines={1}>
                    {item.sharedCourseNote || item.activityNote}
                  </Text>
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => handleViewProfile(item.id)}
                  >
                    <Text style={styles.viewProfileText}>View Profile</Text>
                  </Pressable>

                  <View style={styles.actionDivider} />

                  <Pressable
                    style={styles.actionButton}
                    onPress={() => handleMessageStudent(item.id)}
                  >
                    <Text style={styles.messageText}>Message</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <BottomNav activeTab="courses" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1, backgroundColor: COLORS.background },
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
  brandRow: { flexDirection: "row", alignItems: "center" },
  logoAvatar: { width: 30, height: 30, borderRadius: 15, marginRight: 10 },
  brandText: { fontSize: 18, fontWeight: "900", color: COLORS.primary },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 104 },
  pageTitle: { fontSize: 24, fontWeight: "900", color: COLORS.textDark, marginBottom: 6 },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginBottom: 21,
  },
  filtersRow: { paddingBottom: 24 },
  filterPill: {
    height: 36,
    paddingHorizontal: 17,
    borderRadius: 18,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E7CFCF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  activeFilterPill: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { fontSize: 12, fontWeight: "800", color: "#7A7373" },
  activeFilterText: { color: COLORS.cardWhite },
  studentsList: { gap: 17 },
  studentCard: {
    borderRadius: 13,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#F1E6E6",
    overflow: "hidden",
    paddingTop: 18,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  avatarWrap: { width: 72, height: 72, marginRight: 15 },
  avatar: { width: 72, height: 72, borderRadius: 13 },
  onlineDot: {
    position: "absolute",
    right: -2,
    bottom: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.green,
    borderWidth: 2,
    borderColor: COLORS.cardWhite,
  },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 21, fontWeight: "900", color: COLORS.textDark },
  studentMeta: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: "#6F6A6A",
  },
  campusRow: { marginTop: 6, flexDirection: "row", alignItems: "center" },
  campusText: {
    marginLeft: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#6F6A6A",
  },
  matchBadge: {
    width: 70,
    minHeight: 45,
    borderRadius: 20,
    backgroundColor: "#FFDDE2",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  matchBadgeText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    color: COLORS.primary,
    textAlign: "center",
  },
  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 18,
    marginTop: 15,
    gap: 8,
  },
  interestTag: {
    backgroundColor: COLORS.tagGray,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  interestText: { fontSize: 12, fontWeight: "800", color: "#676060" },
  noteBox: {
    marginHorizontal: 18,
    marginTop: 13,
    borderRadius: 7,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  noteText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#8A7474",
  },
  actionRow: {
    marginTop: 16,
    height: 55,
    borderTopWidth: 1,
    borderTopColor: "#F0EAEA",
    flexDirection: "row",
    alignItems: "center",
  },
  actionButton: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center" },
  actionDivider: { width: 1, height: "100%", backgroundColor: "#F0EAEA" },
  viewProfileText: { fontSize: 15, fontWeight: "800", color: "#6E6262" },
  messageText: { fontSize: 15, fontWeight: "800", color: "#B45B67" },
});