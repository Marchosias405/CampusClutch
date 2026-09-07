import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";

import {
  getMyCourses,
  isCurrentCourse,
  isPreviousCourse,
  leaveCourse,
} from "@/lib/courses";
import type { MyCourse } from "@/types";

type CourseFilter = "current" | "previous";

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

const filters: {
  id: CourseFilter;
  label: string;
}[] = [
  {
    id: "current",
    label: "Current Term",
  },
  {
    id: "previous",
    label: "Previous Terms",
  },
];

export default function CoursesIndexScreen() {
  const router = useRouter();

  const [selectedFilter, setSelectedFilter] =
    useState<CourseFilter>("current");

  const [search, setSearch] = useState("");
  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<
    string | null
  >(null);

  const [leavingCourseId, setLeavingCourseId] =
    useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await getMyCourses();
      setCourses(result);
    } catch (error) {
      console.error("Failed to load courses:", error);

      setErrorMessage(
        "We couldn't load your courses. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCourses();
    }, [loadCourses])
  );

  const currentCourses = useMemo(
    () => courses.filter(isCurrentCourse),
    [courses]
  );

  const previousCourses = useMemo(
    () => courses.filter(isPreviousCourse),
    [courses]
  );

  const query = search.trim().toLowerCase();

  const filteredCourses = useMemo(() => {
    const source =
      selectedFilter === "current"
        ? currentCourses
        : previousCourses;

    if (!query) {
      return source;
    }

    return source.filter(
      (course) =>
        course.code.toLowerCase().includes(query) ||
        course.title.toLowerCase().includes(query) ||
        course.term.displayName
          .toLowerCase()
          .includes(query)
    );
  }, [
    currentCourses,
    previousCourses,
    query,
    selectedFilter,
  ]);

  const currentTermLabel =
    currentCourses[0]?.term.displayName ?? "Current Courses";

  const handleOpenClassmates = (course: MyCourse) => {
    router.push({
      pathname: "/courses/classmates",
      params: {
        courseId: course.id,
      },
    } as any);
  };

  const performLeaveCourse = async (
    course: MyCourse
  ) => {
    setLeavingCourseId(course.id);

    try {
      await leaveCourse(course.id);
      await loadCourses();
    } catch (error) {
      console.error("Failed to remove course:", error);

      Alert.alert(
        "Unable to remove course",
        "We couldn't remove this course. Please try again."
      );
    } finally {
      setLeavingCourseId(null);
    }
  };

  const handleRemoveCourse = (course: MyCourse) => {
    Alert.alert(
      "Remove course",
      `Remove ${course.code} from your CampusClutch courses?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void performLeaveCourse(course);
          },
        },
      ]
    );
  };

  const emptyMessage = query
    ? `No courses match "${search.trim()}".`
    : selectedFilter === "current"
      ? "You haven't added any current courses yet."
      : "You don't have any previous courses yet.";

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Courses</Text>

          <View style={styles.headerActions}>
            <Pressable
              hitSlop={10}
              onPress={() =>
                router.push("/courses/add" as any)
              }
            >
              <Ionicons
                name="add"
                size={26}
                color="#FFFFFF"
              />
            </Pressable>

            <Pressable
              hitSlop={10}
              onPress={() =>
                router.push("/notifications" as any)
              }
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
            <Ionicons
              name="search"
              size={18}
              color={COLORS.inactiveGray}
            />

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search courses"
              placeholderTextColor={COLORS.inactiveGray}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
            />

            {search.length > 0 && (
              <Pressable
                hitSlop={10}
                onPress={() => setSearch("")}
              >
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
              const isActive =
                selectedFilter === filter.id;

              return (
                <Pressable
                  key={filter.id}
                  style={[
                    styles.filterPill,
                    isActive &&
                      styles.activeFilterPill,
                  ]}
                  onPress={() =>
                    setSelectedFilter(filter.id)
                  }
                >
                  <Text
                    style={[
                      styles.filterText,
                      isActive &&
                        styles.activeFilterText,
                    ]}
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {isLoading ? (
            <View style={styles.stateContainer}>
              <ActivityIndicator
                size="small"
                color={COLORS.primary}
              />

              <Text style={styles.stateText}>
                Loading your courses...
              </Text>
            </View>
          ) : errorMessage ? (
            <View style={styles.stateContainer}>
              <Ionicons
                name="alert-circle-outline"
                size={28}
                color={COLORS.primary}
              />

              <Text style={styles.stateText}>
                {errorMessage}
              </Text>

              <Pressable
                style={styles.retryButton}
                onPress={() => void loadCourses()}
              >
                <Text style={styles.retryButtonText}>
                  Try Again
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {selectedFilter === "current"
                    ? currentTermLabel
                    : "Previous Courses"}
                </Text>

                <Text style={styles.currentText}>
                  {selectedFilter === "current"
                    ? "Current"
                    : "Past"}
                </Text>
              </View>

              {filteredCourses.length === 0 ? (
                <Text style={styles.emptyText}>
                  {emptyMessage}
                </Text>
              ) : selectedFilter === "current" ? (
                <View style={styles.courseList}>
                  {filteredCourses.map((course) => (
                    <View
                      key={course.id}
                      style={styles.courseCard}
                    >
                      <View style={styles.courseInfo}>
                        <Text style={styles.courseCode}>
                          {course.code}
                        </Text>

                        <Text
                          style={styles.courseTitle}
                          numberOfLines={1}
                        >
                          {course.title}
                        </Text>
                      </View>

                      <View style={styles.courseActions}>
                        <Pressable
                          style={styles.classmatesButton}
                          onPress={() =>
                            handleOpenClassmates(course)
                          }
                        >
                          <Text style={styles.classmatesText}>
                            Classmates
                          </Text>

                          <Ionicons
                            name="chevron-forward"
                            size={17}
                            color={COLORS.primary}
                          />
                        </Pressable>

                        <Pressable
                          style={styles.removeButton}
                          hitSlop={6}
                          disabled={
                            leavingCourseId === course.id
                          }
                          onPress={() =>
                            handleRemoveCourse(course)
                          }
                        >
                          {leavingCourseId === course.id ? (
                            <ActivityIndicator
                              size="small"
                              color={COLORS.primary}
                            />
                          ) : (
                            <Ionicons
                              name="trash-outline"
                              size={18}
                              color={COLORS.primary}
                            />
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.previousList}>
                  {filteredCourses.map((course) => (
                    <View
                      key={course.id}
                      style={styles.previousCard}
                    >
                      <View style={styles.previousInfo}>
                        <Text style={styles.previousCode}>
                          {course.code}
                        </Text>

                        <Text style={styles.previousTerm}>
                          {course.term.displayName}
                        </Text>
                      </View>

                      <View style={styles.archivedRow}>
                        <Text style={styles.archivedText}>
                          {course.membershipStatus ===
                          "completed"
                            ? "Completed"
                            : "Previous"}
                        </Text>

                        {course.membershipStatus !==
                          "completed" && (
                          <Pressable
                            style={
                              styles.previousRemoveButton
                            }
                            hitSlop={6}
                            disabled={
                              leavingCourseId ===
                              course.id
                            }
                            onPress={() =>
                              handleRemoveCourse(course)
                            }
                          >
                            {leavingCourseId ===
                            course.id ? (
                              <ActivityIndicator
                                size="small"
                                color={COLORS.primary}
                              />
                            ) : (
                              <Ionicons
                                name="trash-outline"
                                size={17}
                                color={COLORS.primary}
                              />
                            )}
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.findCard}>
                <View style={styles.findIcon}>
                  <FontAwesome5
                    name="user-friends"
                    size={16}
                    color="#FFFFFF"
                  />
                </View>

                <View style={styles.findTextBlock}>
                  <Text style={styles.findTitle}>
                    Find Classmates
                  </Text>

                  <Text
                    style={styles.findDescription}
                    numberOfLines={2}
                  >
                    Open a current course above to
                    discover students enrolled with you.
                  </Text>
                </View>

                <View style={styles.discoverPill}>
                  <Text style={styles.discoverText}>
                    Courses
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
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

  headerTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 32,
  },

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

  filtersRow: {
    paddingBottom: 25,
  },

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

  filterText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.inactiveGray,
  },

  activeFilterText: {
    color: COLORS.primary,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  sectionTitle: {
    fontSize: 23,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  currentText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.inactiveGray,
  },

  stateContainer: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  stateText: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  retryButton: {
    marginTop: 14,
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  retryButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
    paddingVertical: 14,
  },

  courseList: {
    gap: 11,
  },

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
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },

  courseInfo: {
    flex: 1,
    marginRight: 8,
  },

  courseCode: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  courseTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  courseActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  classmatesButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  classmatesText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },

  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
  },

  previousList: {
    gap: 11,
  },

  previousCard: {
    minHeight: 69,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  previousInfo: {
    flex: 1,
    marginRight: 12,
  },

  previousCode: {
    fontSize: 18,
    fontWeight: "900",
    color: "#556070",
  },

  previousTerm: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.inactiveGray,
  },

  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  archivedText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.inactiveGray,
  },

  previousRemoveButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
  },

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

  findTextBlock: {
    flex: 1,
    marginRight: 12,
  },

  findTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.textDark,
  },

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

  discoverText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
