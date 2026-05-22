import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { mockCourses } from "../../constants/mockData";
import { Course } from "../../types";

type CourseFilter = "current" | "previous" | "shared";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  tagGray: "#F4F1F1",
  softPink: "#FBECEC",
};

const filters: { id: CourseFilter; label: string }[] = [
  { id: "current", label: "Current Term" },
  { id: "previous", label: "Previous Terms" },
  { id: "shared", label: "Shared Interests" },
];

export default function CoursesIndexScreen() {
  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState<CourseFilter>("current");
  const [search, setSearch] = useState("");

  const currentCourses = useMemo(() => {
    return mockCourses.filter((course) => course.status === "current");
  }, []);

  const previousCourses = useMemo(() => {
    return mockCourses.filter((course) => course.status === "previous");
  }, []);

  const handleOpenClassmates = (course?: Course) => {
    router.push({
      pathname: "/courses/classmates",
      params: { courseId: course?.id ?? "cmpt-361" },
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
            <Ionicons name="notifications" size={21} color={COLORS.textDark} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>My Courses</Text>

            <Pressable
              style={styles.addButton}
              onPress={() => router.push("/courses/add" as any)}
            >
              <Text style={styles.addButtonText}>+ Add Course</Text>
            </Pressable>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={COLORS.inactiveGray} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search course or student"
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.searchInput}
            />
          </View>

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

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Fall 2024</Text>
            <Text style={styles.currentText}>Current</Text>
          </View>

          <View style={styles.courseList}>
            {currentCourses.map((course) => (
              <Pressable
                key={course.id}
                style={styles.courseCard}
                onPress={() => handleOpenClassmates(course)}
              >
                <View style={styles.courseAccent} />

                <View style={styles.courseIconBox}>
                  <FontAwesome5 name={course.icon} size={16} color={COLORS.primary} />
                </View>

                <View style={styles.courseInfo}>
                  <Text style={styles.courseCode}>{course.code}</Text>
                  <Text style={styles.courseTitle} numberOfLines={2}>
                    {course.title}
                  </Text>
                </View>

                <View style={styles.studentStack}>
                  <View style={styles.avatarCluster}>
                    <Image
                      source={{
                        uri: "https://api.dicebear.com/7.x/personas/png?seed=Mini1",
                      }}
                      style={styles.miniAvatar}
                    />
                    <Image
                      source={{
                        uri: "https://api.dicebear.com/7.x/personas/png?seed=Mini2",
                      }}
                      style={[styles.miniAvatar, styles.overlapAvatar]}
                    />
                  </View>

                  <Text style={styles.studentCount}>{course.studentCount} students</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <Text style={styles.previousTitle}>Previous Courses</Text>

          <View style={styles.previousList}>
            {previousCourses.map((course) => (
              <Pressable key={course.id} style={styles.previousCard}>
                <View>
                  <Text style={styles.previousCode}>{course.code}</Text>
                  <Text style={styles.previousTerm}>{course.term}</Text>
                </View>

                <View style={styles.archivedRow}>
                  <Text style={styles.archivedText}>Archived</Text>
                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={COLORS.inactiveGray}
                  />
                </View>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={styles.findCard}
            onPress={() => handleOpenClassmates()}
          >
            <View style={styles.findTextBlock}>
              <Text style={styles.findTitle}>Find Classmates</Text>
              <Text style={styles.findDescription}>
                Connect with students in your same sections for study groups or delivery
                splits.
              </Text>

              <View style={styles.discoverButton}>
                <Text style={styles.discoverText}>Discover Now</Text>
                <FontAwesome5 name="user-friends" size={12} color={COLORS.primary} />
              </View>
            </View>

            <FontAwesome5 name="graduation-cap" size={62} color="#8F96A3" />
          </Pressable>
        </ScrollView>
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
  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 22,
  },
  pageTitle: { fontSize: 30, fontWeight: "900", color: COLORS.textDark },
  addButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 15,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: { color: COLORS.cardWhite, fontSize: 13, fontWeight: "900" },
  searchBar: {
    height: 47,
    borderRadius: 13,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#F1E9E9",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: "600",
  },
  filtersRow: { paddingBottom: 25 },
  filterPill: {
    height: 34,
    paddingHorizontal: 17,
    borderRadius: 17,
    backgroundColor: COLORS.tagGray,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  activeFilterPill: {
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  filterText: { fontSize: 11, fontWeight: "800", color: COLORS.inactiveGray },
  activeFilterText: { color: COLORS.primary },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 23, fontWeight: "900", color: COLORS.textDark },
  currentText: { fontSize: 12, fontWeight: "700", color: COLORS.inactiveGray },
  courseList: { gap: 14 },
  courseCard: {
    position: "relative",
    minHeight: 82,
    borderRadius: 14,
    backgroundColor: COLORS.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  courseAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: COLORS.primary,
  },
  courseIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  courseInfo: { flex: 1 },
  courseCode: { fontSize: 18, fontWeight: "900", color: COLORS.textDark },
  courseTitle: { fontSize: 13, fontWeight: "600", color: COLORS.mutedText },
  studentStack: { alignItems: "flex-end", marginLeft: 8 },
  avatarCluster: { flexDirection: "row", marginBottom: 5 },
  miniAvatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardWhite },
  overlapAvatar: { marginLeft: -7 },
  studentCount: { fontSize: 11, fontWeight: "800", color: "#B45B67" },
  previousTitle: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.textDark,
    marginTop: 28,
    marginBottom: 14,
  },
  previousList: { gap: 11 },
  previousCard: {
    height: 69,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#EFE1E1",
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previousCode: { fontSize: 18, fontWeight: "900", color: "#556070" },
  previousTerm: { fontSize: 12, fontWeight: "600", color: COLORS.inactiveGray },
  archivedRow: { flexDirection: "row", alignItems: "center" },
  archivedText: { fontSize: 12, fontWeight: "700", color: COLORS.inactiveGray },
  findCard: {
    marginTop: 32,
    minHeight: 176,
    borderRadius: 18,
    backgroundColor: "#5E6472",
    padding: 21,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  findTextBlock: { flex: 1, marginRight: 15 },
  findTitle: { fontSize: 21, fontWeight: "900", color: COLORS.cardWhite },
  findDescription: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "600",
    color: "#F3F3F3",
  },
  discoverButton: {
    marginTop: 18,
    alignSelf: "flex-start",
    height: 39,
    paddingHorizontal: 17,
    borderRadius: 20,
    backgroundColor: COLORS.cardWhite,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  discoverText: { fontSize: 13, fontWeight: "900", color: COLORS.primary },
});
