import { LoadingSkeleton, LoadingNotice } from '@/components/LoadingState';
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";
import NotificationBell from "../../components/NotificationBell";
import { useAuth } from "@/context/AuthContext";

import {
  getMyCourses,
  courseDetailsLabel,
  isCurrentCourse,
  isPreviousCourse,
  isUpcomingCourse,
  leaveCourse,
} from "@/lib/courses";
import type { MyCourse } from "@/types";

type CourseFilter = "current" | "upcoming" | "previous";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#ECE3E3",
  inactiveGray: "#635C5C",
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
    id: "upcoming",
    label: "Upcoming",
  },
  {
    id: "previous",
    label: "Previous Terms",
  },
];

export default function CoursesRoute() {
  const { user } = useAuth();
  return user ? <CoursesIndexScreen key={user.id} userId={user.id} /> : null;
}

function CoursesIndexScreen({ userId }: { userId: string }) {
  const router = useRouter();
  const active = useRef(false);
  const scrollView = useRef<ScrollView>(null);
  const loadEpoch = useRef(0);
  const loadBusy = useRef(false);
  const leaveEpoch = useRef(0);
  const leaveBusy = useRef(false);
  const [pendingRemoval, setPendingRemoval] = useState<MyCourse | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
    if (!active.current || loadBusy.current) return;
    loadBusy.current = true;
    const ticket = ++loadEpoch.current;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const result = await getMyCourses(userId);
      if (!active.current || ticket !== loadEpoch.current) return;
      setCourses(result);
    } catch {
      if (!active.current || ticket !== loadEpoch.current) return;

      setErrorMessage(
        "We couldn't load your courses. Please try again."
      );
    } finally {
      if (active.current && ticket === loadEpoch.current) {
        loadBusy.current = false;
        setIsLoading(false);
      }
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      leaveBusy.current = false;
      setLeavingCourseId(null);
      setPendingRemoval(null);
      setRemoveError(null);
      void loadCourses();
      return () => {
        active.current = false;
        loadBusy.current = false;
        loadEpoch.current += 1;
        leaveEpoch.current += 1;
      };
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

  const upcomingCourses = useMemo(() => courses.filter(isUpcomingCourse), [courses]);

  const query = search.trim().toLowerCase();

  const filteredCourses = useMemo(() => {
    const source =
      selectedFilter === "current"
        ? currentCourses
        : selectedFilter === "upcoming" ? upcomingCourses : previousCourses;

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
    upcomingCourses,
    query,
    selectedFilter,
  ]);

  const currentTermLabel =
    currentCourses[0]?.term.displayName ?? "Current Courses";

  const handleOpenClassmates = (course: MyCourse) => {
    if (!active.current || !isCurrentCourse(course)) return;
    router.push({
      pathname: "/courses/classmates",
      params: {
        courseId: course.id,
      },
    } as any);
  };

  const handleOpenReviews = (course: MyCourse) => {
    if (!active.current || leaveBusy.current) return;
    router.push({ pathname: "/courses/reviews", params: { code: course.code } } as any);
  };

  const performLeaveCourse = async (
    course: MyCourse
  ) => {
    if (!active.current || leaveBusy.current) return;
    leaveBusy.current = true;
    const ticket = ++leaveEpoch.current;
    setLeavingCourseId(course.id);
    setRemoveError(null);

    try {
      await leaveCourse(course.id, userId);
      if (!active.current || ticket !== leaveEpoch.current) return;
      setPendingRemoval(null);
      setCourses((current) => current.filter((item) => item.id !== course.id));
      loadEpoch.current += 1;
      loadBusy.current = false;
      await loadCourses();
    } catch {
      if (!active.current || ticket !== leaveEpoch.current) return;
      setRemoveError("We couldn't confirm this course was removed. Please try again.");
    } finally {
      if (active.current && ticket === leaveEpoch.current) {
        leaveBusy.current = false;
        setLeavingCourseId(null);
      }
    }
  };

  const handleRemoveCourse = (course: MyCourse) => {
    if (!active.current || leaveBusy.current) return;
    setPendingRemoval(course);
    setRemoveError(null);
    scrollView.current?.scrollTo({ y: 0, animated: true });
  };

  const emptyMessage = query
    ? `No courses match "${search.trim()}".`
    : selectedFilter === "current"
      ? "You haven't added any current courses yet."
      : selectedFilter === "upcoming" ? "You haven't added any upcoming courses yet."
        : "You don't have any previous courses yet.";

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Text style={styles.headerTitle}>Courses</Text>

          <View style={styles.headerActions}>
            <Pressable
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Add a course"
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

            <NotificationBell />
          </View>
        </ScreenHeader>

        <ScrollView
          ref={scrollView}
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
              accessibilityLabel="Search your courses"
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
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Clear course search"
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
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

          {pendingRemoval && <View style={styles.removalBox}>
            <Text style={styles.courseTitle}>Remove {pendingRemoval.code} ({pendingRemoval.term.displayName}) from your CampusClutch courses?</Text>
            {removeError && <Text style={styles.removalError}>{removeError}</Text>}
            <View style={styles.removalActions}>
              <Pressable accessibilityRole="button" disabled={leavingCourseId !== null} onPress={() => setPendingRemoval(null)} style={styles.confirmRemove}>
                <Text style={styles.classmatesText}>Keep course</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={leavingCourseId !== null} onPress={() => void performLeaveCourse(pendingRemoval)} style={styles.confirmRemove}>
                {leavingCourseId ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.classmatesText}>Remove course</Text>}
              </Pressable>
            </View>
          </View>}

          {isLoading && !errorMessage && (courses.length === 0
            ? <LoadingSkeleton variant="courses" label="Loading your courses…" />
            : <LoadingNotice label="Refreshing your courses…" />)}
          {errorMessage && (
            <View style={styles.stateContainer} accessibilityLiveRegion="polite">
              <Ionicons
                name="alert-circle-outline"
                size={28}
                color={COLORS.primary}
              />

              <Text style={styles.stateText}>
                {errorMessage}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading your courses"
                disabled={isLoading}
                style={styles.retryButton}
                onPress={() => void loadCourses()}
              >
                <Text style={styles.retryButtonText}>
                  Try Again
                </Text>
              </Pressable>
            </View>
          )}
          {(courses.length > 0 || (!isLoading && !errorMessage)) && (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {selectedFilter === "current"
                    ? currentTermLabel
                    : selectedFilter === "upcoming" ? "Upcoming Courses" : "Previous Courses"}
                </Text>

                <Text style={styles.currentText}>
                  {selectedFilter === "current"
                    ? "Current"
                    : selectedFilter === "upcoming" ? "Upcoming" : "Past"}
                </Text>
              </View>

              {selectedFilter === "upcoming" && <Text style={styles.upcomingNote}>
                Your courses are saved for the upcoming term. Classmates become available when the term starts.
              </Text>}

              {filteredCourses.length === 0 ? (
                <Text style={styles.emptyText}>
                  {emptyMessage}
                </Text>
              ) : selectedFilter !== "previous" ? (
                <View style={styles.courseList}>
                  {filteredCourses.map((course) => (
                    <View
                      key={course.id}
                      style={styles.courseCard}
                    >
                      <Pressable style={styles.courseInfo}
                        accessibilityRole="button"
                        accessibilityLabel={`Read reviews for ${course.code}, ${course.term.displayName}`}
                        onPress={() => handleOpenReviews(course)}>
                        <Text style={styles.courseCode}>
                          {course.code}
                        </Text>

                        <Text
                          style={styles.courseTitle}
                        >
                          {course.title}
                        </Text>
                        <Text style={styles.courseTitle}>{course.term.displayName}</Text>
                        {!!courseDetailsLabel(course) && <Text style={styles.courseTitle}>{courseDetailsLabel(course, "\n")}</Text>}
                        <Text style={styles.reviewLink}>Course reviews ›</Text>
                      </Pressable>

                      <View style={styles.courseActions}>
                        {isCurrentCourse(course) && <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Find classmates in ${course.code}`}
                          style={styles.classmatesButton}
                          onPress={(event) => {
                            event?.stopPropagation();
                            handleOpenClassmates(course);
                          }}
                        >
                          <Text style={styles.classmatesText}>
                            Classmates
                          </Text>

                          <Ionicons
                            name="chevron-forward"
                            size={17}
                            color={COLORS.primary}
                          />
                        </Pressable>}

                        <Pressable
                          accessibilityRole="button"
                          style={styles.removeButton}
                          hitSlop={6}
                          accessibilityLabel={`Remove ${course.code}`}
                          disabled={
                            leavingCourseId === course.id
                          }
                          onPress={(event) => {
                            event?.stopPropagation();
                            handleRemoveCourse(course);
                          }}
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
                      <Pressable style={styles.previousInfo}
                        accessibilityRole="button"
                        accessibilityLabel={`Read reviews for ${course.code}, ${course.term.displayName}`}
                        onPress={() => handleOpenReviews(course)}>
                        <Text style={styles.previousCode}>
                          {course.code}
                        </Text>

                        <Text style={styles.previousTerm}>
                          {course.term.displayName}
                        </Text>
                        <Text style={styles.reviewLink}>Course reviews ›</Text>
                      </Pressable>

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
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${course.code}`}
                            style={
                              styles.previousRemoveButton
                            }
                            hitSlop={6}
                            disabled={
                              leavingCourseId ===
                              course.id
                            }
                            onPress={(event) => {
                              event?.stopPropagation();
                              handleRemoveCourse(course);
                            }}
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

            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reviewLink: { color: COLORS.primary, fontSize: 12, fontWeight: "800", marginTop: 8 },
  removalBox: { borderRadius: 14, padding: 14, backgroundColor: COLORS.softPink, marginBottom: 16 },
  removalActions: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  confirmRemove: { minHeight: 48, justifyContent: "center", paddingVertical: 12, paddingHorizontal: 10 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  removalError: { color: COLORS.primary, marginTop: 8 },
  upcomingNote: { fontSize: 13, lineHeight: 19, color: COLORS.mutedText, marginBottom: 14 },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  headerTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
    minHeight: 52,
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
    minWidth: 0,
    paddingVertical: 12,
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: "600",
  },

  filtersRow: {
    paddingBottom: 25,
  },

  filterPill: {
    minHeight: 48,
    paddingVertical: 10,
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
    flexWrap: "wrap",
    gap: 8,
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
    minHeight: 48,
    paddingVertical: 10,
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
    alignItems: "stretch",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    minHeight: 48,
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },

  classmatesButton: {
    minHeight: 48,
    paddingVertical: 10,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },

  classmatesText: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
  },

  removeButton: {
    width: 48,
    height: 48,
    borderRadius: 22,
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
    paddingVertical: 12,
    alignItems: "stretch",
    gap: 12,
    justifyContent: "space-between",
  },

  previousInfo: {
    minHeight: 48,
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },

  archivedText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.inactiveGray,
  },

  previousRemoveButton: {
    width: 48,
    height: 48,
    borderRadius: 22,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
  },
});
