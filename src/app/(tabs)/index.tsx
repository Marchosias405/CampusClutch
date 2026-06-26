import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import ScreenHeader from "../../components/ScreenHeader";

type Course = {
  id: string;
  code: string;
  number: string;
  title: string;
};

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  softPink: "#FBECEC",
  track: "#F0E7E8",
};

const currentCourses: Course[] = [
  {
    id: "cmpt-276",
    code: "CMPT 276",
    number: "276",
    title: "Introduction to Software Engineering",
  },
  {
    id: "cmpt-361",
    code: "CMPT 361",
    number: "361",
    title: "Introduction to Computer Graphics",
  },
  {
    id: "cmpt-371",
    code: "CMPT 371",
    number: "371",
    title: "Data Communications and Networking",
  },
];

export default function HomeDashboardScreen() {
  const router = useRouter();

  const handleOpenCourse = (courseId: string) => {
    router.push({
      pathname: "/courses/classmates",
      params: { courseId },
    } as any);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Text style={styles.brandText}>CampusClutch</Text>

        <Pressable
          hitSlop={10}
          onPress={() => router.push("/notifications" as any)}
        >
          <Ionicons name="notifications-outline" size={23} color="#FFFFFF" />
        </Pressable>
      </ScreenHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Combined greeting + balance hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroTextBlock}>
              <Text style={styles.heroHello}>Welcome back,</Text>
              <Text style={styles.heroName}>Hi, Kazi</Text>
            </View>

            <View style={styles.pointsPill}>
              <FontAwesome5 name="star" size={11} color="#FFFFFF" solid />
              <Text style={styles.pointsPillText}>120 pts</Text>
            </View>
          </View>

          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>

          <Text style={styles.heroSub}>80 points to your next reward</Text>
        </View>

        {/* Current courses */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Current Courses</Text>

          <Pressable onPress={() => router.push("/courses" as any)}>
            <Text style={styles.viewAllText}>View All</Text>
          </Pressable>
        </View>

        <View style={styles.courseList}>
          {currentCourses.map((course) => (
            <Pressable
              key={course.id}
              style={styles.courseCard}
              onPress={() => handleOpenCourse(course.id)}
            >
              <View style={styles.courseBadge}>
                <Text style={styles.courseBadgeText}>{course.number}</Text>
              </View>

              <View style={styles.courseInfo}>
                <Text style={styles.courseCode}>{course.code}</Text>
                <Text style={styles.courseTitle} numberOfLines={1}>
                  {course.title}
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.mutedText}
              />
            </Pressable>
          ))}
        </View>

        {/* Active requests - compact banner */}
        <Text style={styles.sectionTitle}>Active Requests</Text>

        <Pressable
          style={styles.requestBanner}
          onPress={() => router.push("/requests" as any)}
        >
          <View style={styles.requestIcon}>
            <FontAwesome5 name="route" size={15} color="#FFFFFF" solid />
          </View>

          <View style={styles.requestText}>
            <Text style={styles.requestTitle} numberOfLines={1}>
              2 deliveries to Burnaby today
            </Text>
            <Text style={styles.requestSub} numberOfLines={1}>
              Join a route · earn up to 40 pts
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={20} color={COLORS.primary} />
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
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 9,
    elevation: 2,
  },

  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },

  heroTextBlock: {
    flex: 1,
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
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
  },

  pointsPillText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.track,
    overflow: "hidden",
    marginBottom: 8,
  },

  progressFill: {
    width: "60%",
    height: "100%",
    borderRadius: 3,
    backgroundColor: COLORS.primary,
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
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 14,
  },

  viewAllText: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
    marginBottom: 14,
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
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },

  courseBadge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  courseBadgeText: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.primary,
  },

  courseInfo: {
    flex: 1,
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

  requestBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },

  requestIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  requestText: {
    flex: 1,
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
