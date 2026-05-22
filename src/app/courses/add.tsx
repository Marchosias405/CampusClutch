import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { addCourseOptions } from "../../constants/mockData";

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
};

const terms = ["Spring 2026", "Summer 2026", "Fall 2026"];
const statuses = ["Current course", "Previous course"];

export default function AddCourseScreen() {
  const router = useRouter();

  const [query, setQuery] = useState("CMPT");
  const [selectedCourseId, setSelectedCourseId] = useState("cmpt-361");
  const [selectedTerm, setSelectedTerm] = useState("Summer 2026");
  const [selectedStatus, setSelectedStatus] = useState("Current course");

  const selectedCourse = addCourseOptions.find(
    (course) => course.id === selectedCourseId
  );

  const handleAddCourse = () => {
    console.log("Course added:", {
      course: selectedCourse,
      term: selectedTerm,
      status: selectedStatus,
    });

    router.back();
  };

  const handleFindClassmates = () => {
    router.push({
      pathname: "/courses/classmates",
      params: { courseId: selectedCourseId },
    } as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.modalCard}>
            <View style={styles.topHandle} />

            <View style={styles.headerRow}>
              <Text style={styles.title}>Add a Course</Text>

              <Pressable
                style={styles.closeButton}
                onPress={() => router.back()}
              >
                <Ionicons name="close" size={23} color="#555555" />
              </Pressable>
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={COLORS.inactiveGray} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="CMPT"
                placeholderTextColor={COLORS.inactiveGray}
                style={styles.searchInput}
              />
            </View>

            <Text style={styles.smallLabel}>RESULTS</Text>

            <View style={styles.courseGrid}>
              {addCourseOptions.map((course) => {
                const isSelected = selectedCourseId === course.id;

                return (
                  <Pressable
                    key={course.id}
                    style={[
                      styles.resultCard,
                      isSelected && styles.selectedResultCard,
                    ]}
                    onPress={() => setSelectedCourseId(course.id)}
                  >
                    <View style={styles.resultTopRow}>
                      <Text style={styles.resultCode}>{course.code}</Text>

                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={COLORS.primary}
                        />
                      )}
                    </View>

                    <Text style={styles.resultTitle}>{course.title}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.smallLabel}>ACADEMIC TERM</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {terms.map((term) => {
                const isActive = selectedTerm === term;

                return (
                  <Pressable
                    key={term}
                    style={[styles.optionPill, isActive && styles.activeOptionPill]}
                    onPress={() => setSelectedTerm(term)}
                  >
                    <Text style={[styles.optionText, isActive && styles.activeOptionText]}>
                      {term}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.smallLabel}>STATUS</Text>

            <View style={styles.statusSegment}>
              {statuses.map((status) => {
                const isActive = selectedStatus === status;

                return (
                  <Pressable
                    key={status}
                    style={[styles.statusButton, isActive && styles.activeStatusButton]}
                    onPress={() => setSelectedStatus(status)}
                  >
                    <Text style={[styles.statusText, isActive && styles.activeStatusText]}>
                      {status}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.confirmBox}>
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={COLORS.primary}
              />

              <View style={styles.confirmTextBlock}>
                <Text style={styles.confirmTitle}>
                  {selectedCourse?.code} added to your current courses.
                </Text>
                <Text style={styles.confirmSubtitle}>
                  Registration synced with university portal.
                </Text>
              </View>
            </View>

            <Pressable style={styles.findLink} onPress={handleFindClassmates}>
              <FontAwesome5 name="user-friends" size={13} color={COLORS.primary} />
              <Text style={styles.findLinkText}>Find classmates in this course</Text>
            </Pressable>

            <Pressable style={styles.addCourseButton} onPress={handleAddCourse}>
              <Text style={styles.addCourseButtonText}>Add Course</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  screen: { flex: 1, backgroundColor: COLORS.background },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 30,
  },
  modalCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 26,
    borderWidth: 1,
    borderColor: "#E6D4D4",
  },
  topHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#ECECEC",
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  title: { fontSize: 25, fontWeight: "900", color: COLORS.textDark },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E6E6E6",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    height: 53,
    borderRadius: 11,
    backgroundColor: "#F5F3F3",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 21,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textDark,
  },
  smallLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: COLORS.inactiveGray,
    marginBottom: 10,
  },
  courseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 23,
  },
  resultCard: {
    width: "48%",
    height: 134,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E4CACA",
    backgroundColor: COLORS.cardWhite,
    padding: 13,
    justifyContent: "space-between",
  },
  selectedResultCard: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.softPink,
  },
  resultTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultCode: { fontSize: 20, fontWeight: "900", color: COLORS.textDark },
  resultTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#686060",
  },
  pillRow: {
    paddingBottom: 20,
  },
  optionPill: {
    height: 37,
    paddingHorizontal: 20,
    borderRadius: 19,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E4CACA",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  activeOptionPill: {
    borderColor: COLORS.primary,
    backgroundColor: "#FFF6F6",
  },
  optionText: { fontSize: 13, fontWeight: "800", color: COLORS.mutedText },
  activeOptionText: { color: COLORS.primary },
  statusSegment: {
    height: 42,
    borderRadius: 11,
    backgroundColor: "#F4F4F4",
    flexDirection: "row",
    padding: 3,
    marginBottom: 20,
  },
  statusButton: {
    flex: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  activeStatusButton: {
    backgroundColor: COLORS.cardWhite,
  },
  statusText: { fontSize: 13, fontWeight: "800", color: COLORS.mutedText },
  activeStatusText: { color: COLORS.textDark },
  confirmBox: {
    borderRadius: 10,
    backgroundColor: "#F8D9DC",
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 13,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 17,
  },
  confirmTextBlock: { flex: 1, marginLeft: 10 },
  confirmTitle: { fontSize: 13, fontWeight: "900", color: COLORS.primary },
  confirmSubtitle: { fontSize: 11, fontWeight: "700", color: "#B45B67" },
  findLink: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    gap: 8,
  },
  findLinkText: { fontSize: 13, fontWeight: "900", color: COLORS.primary },
  addCourseButton: {
    height: 52,
    borderRadius: 10,
    backgroundColor: COLORS.darkRed,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.darkRed,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  addCourseButtonText: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },
});