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
import { mockCourses } from "../../constants/mockData";
import { Course } from "../../types";

type CourseFilter = "current" | "previous" | "shared";

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

  const query = search.trim().toLowerCase();

  const matchesQuery = (course: Course) =>
    !query ||
    course.code.toLowerCase().includes(query) ||
    course.title.toLowerCase().includes(query);

  const currentCourses = useMemo(
    () =>
      mockCourses.filter(
        (course) => course.status === "current" && matchesQuery(course),
      ),
    [query],
  );

  const previousCourses = useMemo(
    () =>
      mockCourses.filter(
        (course) => course.status === "previous" && matchesQuery(course),
      ),
    [query],
  );

  const handleOpenClassmates = (course?: Course) => {
    router.push({
      pathname: "/courses/classmates",
      params: { courseId: course?.id ?? "cmpt-361" },
    } as any);
  };

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Courses</Text>

          <View style={styles.headerActions}>
            <Pressable
              hitSlop={10}
              onPress={() => router.push("/courses/add" as any)}
            >
              <Ionicons name="add" size={26} color="#FFFFFF" />
            </Pressable>

            <Pressable
              hitSlop={10}
              onPress={() => router.push("/notifications" as any)}
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color="#FFFFFF"
              />
            </Pressable>
          </View>
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
              placeholder="Search course or student"
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
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
              const isActive = selectedFilter === filter.id;

              return (
                <Pressable
                  key={filter.id}
                  style={[
                    styles.filterPill,
                    isActive && styles.activeFilterPill,
                  ]}
                  onPress={() => setSelectedFilter(filter.id)}
                >
                  <Text
                    style={[
                      styles.filterText,
                      isActive && styles.activeFilterText,
                    ]}
                  >
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

          {currentCourses.length === 0 ? (
            <Text style={styles.emptyText}>No courses match “{search}”.</Text>
          ) : (
            <View style={styles.courseList}>
              {currentCourses.map((course) => (
                <Pressable
                  key={course.id}
                  style={styles.courseCard}
                  onPress={() => handleOpenClassmates(course)}
                >
                  <View style={styles.courseInfo}>
                    <Text style={styles.courseCode}>{course.code}</Text>
                    <Text style={styles.courseTitle} numberOfLines={1}>
                      {course.title}
                    </Text>
                  </View>

                  <View style={styles.studentStack}>
                    <View style={styles.avatarCluster}>
                      <Image
                        source={{
                          uri: `https://api.dicebear.com/7.x/personas/png?seed=${course.id}-1`,
                        }}
                        style={styles.miniAvatar}
                      />
                      <Image
                        source={{
                          uri: `https://api.dicebear.com/7.x/personas/png?seed=${course.id}-2`,
                        }}
                        style={[styles.miniAvatar, styles.overlapAvatar]}
                      />
                    </View>

                    <Text style={styles.studentCount}>
                      {course.studentCount} students
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {previousCourses.length > 0 && (
            <>
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
            </>
          )}

          <Pressable
            style={styles.findCard}
            onPress={() => handleOpenClassmates()}
          >
            <View style={styles.findIcon}>
              <FontAwesome5 name="user-friends" size={16} color="#FFFFFF" />
            </View>

            <View style={styles.findTextBlock}>
              <Text style={styles.findTitle}>Find Classmates</Text>
              <Text style={styles.findDescription} numberOfLines={2}>
                Connet with other students in your classes to ask questions,
                share notes.
              </Text>
            </View>

            <View style={styles.discoverPill}>
              <Text style={styles.discoverText}>Discover</Text>
            </View>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1, backgroundColor: COLORS.background },
  headerTitle: { fontSize: 20, fontWeight: "900", color: "#FFFFFF" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 32 },
  searchBar: {
    height: 47,
    borderRadius: 13,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
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
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
    paddingVertical: 14,
  },
  courseList: { gap: 11 },
  courseCard: {
    minHeight: 76,
    borderRadius: 14,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },
  courseIconBox: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  courseInfo: { flex: 1, marginRight: 8 },
  courseCode: { fontSize: 16, fontWeight: "900", color: COLORS.textDark },
  courseTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mutedText,
  },
  studentStack: { alignItems: "flex-end" },
  avatarCluster: { flexDirection: "row", marginBottom: 5 },
  miniAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.cardWhite,
    backgroundColor: COLORS.softPink,
  },
  overlapAvatar: { marginLeft: -8 },
  studentCount: { fontSize: 11, fontWeight: "800", color: COLORS.primary },
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
    borderColor: COLORS.border,
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
    marginTop: 28,
    borderRadius: 16,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  findIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  findTextBlock: { flex: 1, marginRight: 12 },
  findTitle: { fontSize: 16, fontWeight: "900", color: COLORS.textDark },
  findDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: COLORS.mutedText,
  },
  discoverPill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  discoverText: { fontSize: 13, fontWeight: "800", color: "#FFFFFF" },
});
