import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenHeader from "../../components/ScreenHeader";
import { addCourseOptions } from "../../constants/mockData";

const COLORS = {
  primary: "#9B1C31",
  darkRed: "#8F1428",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#ECE3E3",
  inactiveGray: "#A5AAB3",
  softPink: "#FBECEC",
};

const terms = ["Spring 2026", "Summer 2026", "Fall 2026"];
const statuses = ["Current course", "Previous course"];

export default function AddCourseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("cmpt-361");
  const [selectedTerm, setSelectedTerm] = useState("Summer 2026");
  const [selectedStatus, setSelectedStatus] = useState("Current course");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addCourseOptions;
    return addCourseOptions.filter(
      (course) =>
        course.code.toLowerCase().includes(q) ||
        course.title.toLowerCase().includes(q),
    );
  }, [query]);

  const selectedCourse = addCourseOptions.find(
    (course) => course.id === selectedCourseId,
  );

  const handleAddCourse = () => {
    router.back();
  };

  const handleFindClassmates = () => {
    router.push({
      pathname: "/courses/classmates",
      params: { courseId: selectedCourseId },
    } as any);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Pressable
          style={styles.backRow}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Add a Course</Text>
        </Pressable>

        <View />
      </ScreenHeader>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchBar}>
          <Ionicons name="search" size={19} color={COLORS.inactiveGray} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by course code or name"
            placeholderTextColor={COLORS.inactiveGray}
            style={styles.searchInput}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable hitSlop={10} onPress={() => setQuery("")}>
              <Ionicons
                name="close-circle"
                size={19}
                color={COLORS.inactiveGray}
              />
            </Pressable>
          )}
        </View>

        <Text style={styles.smallLabel}>RESULTS</Text>

        {results.length === 0 ? (
          <Text style={styles.emptyText}>No courses match “{query}”.</Text>
        ) : (
          <View style={styles.resultList}>
            {results.map((course) => {
              const isSelected = selectedCourseId === course.id;

              return (
                <Pressable
                  key={course.id}
                  style={[
                    styles.resultRow,
                    isSelected && styles.selectedResultRow,
                  ]}
                  onPress={() => setSelectedCourseId(course.id)}
                >
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultCode}>{course.code}</Text>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {course.title}
                    </Text>
                  </View>

                  <View
                    style={[styles.radio, isSelected && styles.radioSelected]}
                  >
                    {isSelected && (
                      <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={styles.smallLabel}>ACADEMIC TERM</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
          keyboardShouldPersistTaps="handled"
        >
          {terms.map((term) => {
            const isActive = selectedTerm === term;

            return (
              <Pressable
                key={term}
                style={[styles.optionPill, isActive && styles.activeOptionPill]}
                onPress={() => setSelectedTerm(term)}
              >
                <Text
                  style={[
                    styles.optionText,
                    isActive && styles.activeOptionText,
                  ]}
                >
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
                style={[
                  styles.statusButton,
                  isActive && styles.activeStatusButton,
                ]}
                onPress={() => setSelectedStatus(status)}
              >
                <Text
                  style={[
                    styles.statusText,
                    isActive && styles.activeStatusText,
                  ]}
                >
                  {status}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {selectedCourse && (
          <View style={styles.confirmBox}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={COLORS.primary}
            />

            <View style={styles.confirmTextBlock}>
              <Text style={styles.confirmTitle}>
                {selectedCourse.code} ready to add to your{" "}
                {selectedStatus.toLowerCase()}s.
              </Text>
              <Text style={styles.confirmSubtitle}>
                Registration synced with university portal.
              </Text>
            </View>
          </View>
        )}

        <Pressable style={styles.findLink} onPress={handleFindClassmates}>
          <FontAwesome5 name="user-friends" size={13} color={COLORS.primary} />
          <Text style={styles.findLinkText}>
            Find classmates in this course
          </Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable
          style={[
            styles.addCourseButton,
            !selectedCourse && styles.disabledButton,
          ]}
          onPress={handleAddCourse}
          disabled={!selectedCourse}
        >
          <Text style={styles.addCourseButtonText}>
            {selectedCourse ? `Add ${selectedCourse.code}` : "Select a course"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  backRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 19, fontWeight: "900", color: "#FFFFFF" },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  searchBar: {
    height: 52,
    borderRadius: 13,
    backgroundColor: "#F5F3F3",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 22,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textDark,
  },
  smallLabel: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    color: COLORS.inactiveGray,
    marginBottom: 11,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
    paddingVertical: 10,
    marginBottom: 14,
  },
  resultList: { gap: 10, marginBottom: 24 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 66,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
    paddingHorizontal: 14,
  },
  selectedResultRow: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.softPink,
  },
  resultIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.softPink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  resultInfo: { flex: 1, marginRight: 10 },
  resultCode: { fontSize: 17, fontWeight: "900", color: COLORS.textDark },
  resultTitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.mutedText,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#D8C2C2",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  pillRow: { paddingBottom: 22 },
  optionPill: {
    height: 38,
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
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F4F4F4",
    flexDirection: "row",
    padding: 4,
    marginBottom: 22,
  },
  statusButton: {
    flex: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  activeStatusButton: {
    backgroundColor: COLORS.cardWhite,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  statusText: { fontSize: 13, fontWeight: "800", color: COLORS.mutedText },
  activeStatusText: { color: COLORS.textDark },
  confirmBox: {
    borderRadius: 12,
    backgroundColor: COLORS.softPink,
    borderWidth: 1,
    borderColor: "#E7CFD2",
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  confirmTextBlock: { flex: 1, marginLeft: 10 },
  confirmTitle: { fontSize: 13, fontWeight: "900", color: COLORS.primary },
  confirmSubtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: "#B45B67",
  },
  findLink: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  findLinkText: { fontSize: 13, fontWeight: "900", color: COLORS.primary },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
  },
  addCourseButton: {
    height: 52,
    borderRadius: 13,
    backgroundColor: COLORS.darkRed,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    backgroundColor: "#D8C2C2",
  },
  addCourseButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.cardWhite,
  },
});
