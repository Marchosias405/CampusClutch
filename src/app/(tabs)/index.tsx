import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
    Image,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";

type Course = {
  id: string;
  code: string;
  number: string;
  title: string;
};

type QuickAction = {
  id: string;
  title: string;
  icon: string;
  route: string;
};

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFF7F6",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  softPink: "#FBECEC",
  lightGrayCard: "#F8F8F8",
};

const quickActions: QuickAction[] = [
  {
    id: "find-classmates",
    title: "Find Classmates",
    icon: "users",
    route: "/courses/classmates",
  },
  {
    id: "add-course",
    title: "Add Course",
    icon: "plus-circle",
    route: "/courses/add",
  },
  {
    id: "post-request",
    title: "Post Request",
    icon: "truck",
    route: "/requests/create",
  },
  {
    id: "messages",
    title: "Messages",
    icon: "comment-alt",
    route: "/messages",
  },
];

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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.appHeader}>
          <View style={styles.brandRow}>
            <Image
              source={{
                uri: "https://api.dicebear.com/7.x/personas/png?seed=Kazi",
              }}
              style={styles.logoAvatar}
            />

            <Text style={styles.brandText}>CampusLoop</Text>
          </View>

          <Pressable
            style={styles.headerIconButton}
            onPress={() => router.push("/notifications" as any)}
          >
            <Ionicons name="notifications" size={22} color={COLORS.textDark} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.greetingText}>Hi, Kazi</Text>

          <View style={styles.balanceCard}>
            <View style={styles.balanceTopRow}>
              <View>
                <Text style={styles.balanceLabel}>Current Balance</Text>

                <View style={styles.pointsRow}>
                  <Text style={styles.pointsNumber}>120</Text>
                  <Text style={styles.pointsText}>points</Text>
                </View>
              </View>

              <View style={styles.starBox}>
                <FontAwesome5 name="star" size={21} color={COLORS.cardWhite} solid />
              </View>
            </View>

            <View style={styles.balanceDivider} />

            <Text style={styles.rewardText}>Next reward at 200 points</Text>

            <View style={styles.progressTrack}>
              <View style={styles.progressFill} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Quick Actions</Text>

          <View style={styles.quickGrid}>
            {quickActions.map((action) => (
              <Pressable
                key={action.id}
                style={styles.quickCard}
                onPress={() => router.push(action.route as any)}
              >
                <View style={styles.quickIconCircle}>
                  <FontAwesome5
                    name={action.icon}
                    size={18}
                    color={COLORS.primary}
                    solid
                  />
                </View>

                <Text style={styles.quickTitle}>{action.title}</Text>
              </Pressable>
            ))}
          </View>

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
                <View style={styles.courseAccent} />

                <View style={styles.courseCodeBox}>
                  <Text style={styles.courseNumber}>{course.number}</Text>
                </View>

                <View style={styles.courseInfo}>
                  <Text style={styles.courseCode}>{course.code}</Text>
                  <Text style={styles.courseTitle} numberOfLines={2}>
                    {course.title}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color="#D9BFC2"
                />
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Active Requests</Text>

          <View style={styles.activeRequestCard}>
            <View style={styles.routeIconCircle}>
              <FontAwesome5 name="map" size={20} color={COLORS.primary} solid />
            </View>

            <View style={styles.activeRequestContent}>
              <Text style={styles.activeRequestTitle}>
                2 requests going to Burnaby today
              </Text>

              <Text style={styles.activeRequestDescription}>
                Join a delivery route and earn up to 40 bonus points.
              </Text>

              <Pressable
                style={styles.viewRoutesButton}
                onPress={() => router.push("/requests" as any)}
              >
                <Text style={styles.viewRoutesText}>View Routes</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
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

  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  logoAvatar: {
    width: 31,
    height: 31,
    borderRadius: 16,
    marginRight: 10,
  },

  brandText: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.primary,
  },

  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
  },

  welcomeText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginBottom: 5,
  },

  greetingText: {
    fontSize: 31,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 20,
  },

  balanceCard: {
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 21,
    paddingTop: 22,
    paddingBottom: 20,
    marginBottom: 23,
    shadowColor: COLORS.primary,
    shadowOffset: {
      width: 0,
      height: 5,
    },
    shadowOpacity: 0.22,
    shadowRadius: 9,
    elevation: 5,
  },

  balanceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  balanceLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#E4B9C0",
    marginBottom: 4,
  },

  pointsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },

  pointsNumber: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },

  pointsText: {
    marginLeft: 7,
    marginBottom: 3,
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },

  starBox: {
    width: 51,
    height: 51,
    borderRadius: 12,
    backgroundColor: "#C35F70",
    alignItems: "center",
    justifyContent: "center",
  },

  balanceDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginTop: 18,
    marginBottom: 13,
  },

  rewardText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#E8BDC3",
    marginBottom: 8,
  },

  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "#C66775",
    overflow: "hidden",
  },

  progressFill: {
    width: "60%",
    height: "100%",
    borderRadius: 3,
    backgroundColor: COLORS.cardWhite,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 14,
  },

  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 11,
    marginBottom: 24,
  },

  quickCard: {
    width: "48%",
    height: 90,
    borderRadius: 12,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E8CFCF",
    paddingHorizontal: 15,
    paddingVertical: 13,
    justifyContent: "space-between",
  },

  quickIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
  },

  quickTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#5F5757",
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  viewAllText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#B45B67",
    marginBottom: 14,
  },

  courseList: {
    gap: 11,
    marginBottom: 24,
  },

  courseCard: {
    position: "relative",
    minHeight: 76,
    borderRadius: 12,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E8CFCF",
    overflow: "hidden",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },

  courseAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: COLORS.primary,
  },

  courseCodeBox: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  courseNumber: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.primary,
  },

  courseInfo: {
    flex: 1,
  },

  courseCode: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  courseTitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  activeRequestCard: {
    minHeight: 137,
    borderRadius: 13,
    backgroundColor: COLORS.lightGrayCard,
    borderWidth: 1,
    borderColor: "#E8CFCF",
    paddingHorizontal: 19,
    paddingVertical: 18,
    flexDirection: "row",
    marginBottom: 10,
  },

  routeIconCircle: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: COLORS.cardWhite,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
  },

  activeRequestContent: {
    flex: 1,
  },

  activeRequestTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 6,
  },

  activeRequestDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginBottom: 14,
  },

  viewRoutesButton: {
    alignSelf: "flex-start",
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: COLORS.darkRed,
    alignItems: "center",
    justifyContent: "center",
  },

  viewRoutesText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },
});
