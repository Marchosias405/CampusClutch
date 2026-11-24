import { LoadingSkeleton } from '@/components/LoadingState';
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";
import NotificationBell from "../../components/NotificationBell";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import {
  getMyCourses,
  isCurrentCourse,
} from "@/lib/courses";
import type { MyCourse } from "@/types";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#ECE3E3",
  softPink: "#FBECEC",
};

function getCourseNumber(code: string) {
  const parts = code.trim().split(/\s+/);

  return parts.length > 1
    ? parts.slice(1).join(" ")
    : code;
}

export default function HomeDashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile();
  const { width, fontScale } = useWindowDimensions();
  const compact = width / fontScale < 350;
  const userId = user?.id ?? null;
  const activeUser = useRef(userId);
  activeUser.current = userId;
  const focused = useRef(false);
  const readSequence = useRef(0);
  const pendingRead = useRef<number | null>(null);
  const displayName =
    (profile?.id === user?.id ? profile?.displayName?.trim() : null) ||
    "Student";

  const [courseState, setCourseState] = useState<{
    userId: string | null;
    courses: MyCourse[];
    loading: boolean;
    error: string | null;
  }>({ userId, courses: [], loading: true, error: null });
  const sameAccount = courseState.userId === userId;
  const currentCourses = sameAccount ? courseState.courses : [];
  const isLoadingCourses = !sameAccount || courseState.loading;
  const courseError = sameAccount ? courseState.error : null;

  const loadCurrentCourses = useCallback(
    async () => {
      if (!userId || activeUser.current !== userId || !focused.current || pendingRead.current !== null) return;
      const sequence = ++readSequence.current;
      pendingRead.current = sequence;
      const isCurrentRead = () => focused.current && activeUser.current === userId && readSequence.current === sequence;
      setCourseState(previous => ({ userId, courses: previous.userId === userId ? previous.courses : [], loading: true, error: null }));

      try {
        const courses = await getMyCourses(userId);

        if (isCurrentRead()) setCourseState({ userId, courses: courses.filter(isCurrentCourse), loading: false, error: null });
      } catch {
        if (isCurrentRead()) {
          setCourseState(previous => ({ ...previous, loading: false, error: "Unable to refresh your courses. Check your connection and try again." }));
        }
      } finally {
        if (pendingRead.current === sequence) pendingRead.current = null;
      }
    },
    [userId]
  );

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadCurrentCourses();
      return () => {
        focused.current = false;
        readSequence.current += 1;
        pendingRead.current = null;
      };
    }, [loadCurrentCourses])
  );

  const handleOpenCourse = (
    courseId: string
  ) => {
    router.push({
      pathname: "/courses/classmates",
      params: {
        courseId,
      },
    } as any);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Text style={styles.brandText}>
          CampusClutch
        </Text>

        <NotificationBell />
      </ScreenHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={
          styles.scrollContent
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Combined greeting + balance hero */}
        <View style={styles.heroCard}>
          <View style={[styles.heroTopRow, compact && styles.stackedRow]}>
            <View style={[styles.heroTextBlock, compact && styles.stackedTextBlock]}>
              <Text style={styles.heroHello}>
                Welcome back,
              </Text>
              <Text style={styles.heroName}>
                Hi, {displayName}
              </Text>
            </View>

            <Pressable accessibilityRole="button" accessibilityLabel="View points" style={styles.pointsPill} onPress={() => router.push('/(tabs)/profile')}>
              <FontAwesome5
                name="star"
                size={11}
                color="#FFFFFF"
                solid
              />
              <Text style={styles.pointsPillText}>
                View points
              </Text>
            </Pressable>
          </View>

          <Text style={styles.heroSub}>
            Earn points by helping other students
          </Text>
        </View>

        {/* Current courses */}
        <View style={[styles.sectionHeaderRow, compact && styles.stackedRow]}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, styles.courseHeading]}>
            Current Courses
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all courses"
            style={styles.textButton}
            onPress={() =>
              router.push("/courses" as any)
            }
          >
            <Text style={styles.viewAllText}>
              View All
            </Text>
          </Pressable>
        </View>

        <View style={styles.courseList}>
          {isLoadingCourses && !courseError && currentCourses.length === 0 &&
            <LoadingSkeleton variant="courses" rows={2} label="Loading courses…" />}
          {courseError ? (
            <View style={styles.courseState}>
              <Text accessibilityLiveRegion="polite" style={styles.courseStateText}>
                {courseError}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry home courses"
                style={styles.textButton}
                onPress={() =>
                  void loadCurrentCourses()
                }
              >
                <Text style={styles.retryText}>
                  Try Again
                </Text>
              </Pressable>
            </View>
          ) : null}
          {!isLoadingCourses && !courseError && currentCourses.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a course"
              style={styles.emptyCourseCard}
              onPress={() =>
                router.push("/courses/add" as any)
              }
            >
              {!compact && <View style={styles.courseBadge}>
                <Ionicons
                  name="add"
                  size={22}
                  color={COLORS.primary}
                />
              </View>}

              <View style={styles.courseInfo}>
                <Text style={styles.courseCode}>
                  Add a course
                </Text>

                <Text style={styles.courseTitle}>
                  Your current courses will appear
                  here.
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.mutedText}
              />
            </Pressable>
          ) : null}
          {
            currentCourses.map((course) => (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                accessibilityLabel={`${course.code}, ${course.title}. View classmates`}
                style={styles.courseCard}
                onPress={() =>
                  handleOpenCourse(course.id)
                }
              >
                {!compact && <View style={styles.courseBadge}>
                  <Text
                    style={
                      styles.courseBadgeText
                    }
                  >
                    {getCourseNumber(
                      course.code
                    )}
                  </Text>
                </View>}

                <View style={styles.courseInfo}>
                  <Text style={styles.courseCode}>
                    {course.code}
                  </Text>

                  <Text
                    style={styles.courseTitle}
                  >
                    {course.title}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={COLORS.mutedText}
                />
              </Pressable>
            ))
          }
        </View>

        {/* Active requests - compact banner */}
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Active Requests
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Find a campus request"
          style={styles.requestBanner}
          onPress={() =>
            router.push("/requests" as any)
          }
        >
          {!compact && <View style={styles.requestIcon}>
            <FontAwesome5
              name="route"
              size={15}
              color="#FFFFFF"
              solid
            />
          </View>}

          <View style={styles.requestText}>
            <Text
              style={styles.requestTitle}
            >
              Find a campus request
            </Text>

            <Text
              style={styles.requestSub}
            >
              Help a student and earn their offered points
            </Text>
          </View>

          <Ionicons
            name="chevron-forward"
            size={20}
            color={COLORS.primary}
          />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  brandText: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
    fontSize: 19,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 32,
  },

  heroCard: {
    borderRadius: 16,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    marginBottom: 28,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 9,
    elevation: 2,
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },

  stackedRow: {
    flexDirection: "column",
    alignItems: "stretch",
  },

  stackedTextBlock: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
  },

  heroTextBlock: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },

  heroHello: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginBottom: 3,
  },

  heroName: {
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  pointsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 48,
    maxWidth: "100%",
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
  },

  pointsPillText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  heroSub: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 8,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 14,
  },

  courseHeading: {
    flexShrink: 1,
    marginBottom: 0,
  },

  textButton: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: "center",
    alignSelf: "flex-start",
  },

  viewAllText: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },

  courseList: {
    gap: 11,
    marginBottom: 28,
  },

  courseCard: {
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },

  emptyCourseCard: {
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  courseBadge: {
    width: 46,
    minHeight: 46,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
  },

  courseBadgeText: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.primary,
  },

  courseInfo: {
    flex: 1,
    minWidth: 0,
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

  courseState: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },

  courseStateText: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
    textAlign: "center",
  },

  retryText: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.primary,
  },

  requestBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },

  requestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  requestText: {
    flex: 1,
    minWidth: 0,
  },

  requestTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  requestSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.mutedText,
  },
});
