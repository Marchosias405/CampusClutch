import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenHeader from "../../components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import {
  courseDetailsLabel, getAcademicTerms, getMyCourses, isCurrentCourse,
  joinCourse, searchCourseCatalog,
} from "@/lib/courses";
import type { CourseCatalogCursor } from "@/lib/courses";
import type { AcademicTerm, CourseCatalogItem, MyCourse } from "@/types";

const COLORS = {
  primary: "#9B1C31", darkRed: "#8F1428", background: "#FFFFFF", cardWhite: "#FFFFFF",
  textDark: "#2B2525", mutedText: "#8C8585", border: "#ECE3E3", inactiveGray: "#A5AAB3", softPink: "#FBECEC",
};

export default function AddCourseRoute() {
  const { user } = useAuth();
  return user ? <AddCourseScreen key={user.id} userId={user.id} /> : null;
}

function AddCourseScreen({ userId }: { userId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useRef(false);
  const dataEpoch = useRef(0);
  const searchEpoch = useRef(0);
  const submitEpoch = useRef(0);
  const pageBusy = useRef(false);
  const submitBusy = useRef(false);
  const selection = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [courses, setCourses] = useState<CourseCatalogItem[]>([]);
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<CourseCatalogCursor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const resetSearch = useCallback(() => {
    searchEpoch.current += 1;
    selection.current = null;
    pageBusy.current = false;
    setCourses([]);
    setNextCursor(null);
    setSelectedCourseId(null);
    setSearchError(null);
    setIsSearching(false);
    setSubmitMessage(null);
  }, []);

  const loadData = useCallback(async () => {
    const ticket = ++dataEpoch.current;
    resetSearch();
    setIsLoading(true);
    setLoadError(null);
    try {
      const [termResult, memberships] = await Promise.all([getAcademicTerms(), getMyCourses(userId)]);
      if (!active.current || ticket !== dataEpoch.current) return;
      setTerms(termResult);
      setMyCourses(memberships);
      const defaultTerm = termResult.find((term) => term.status === "current")
        ?? termResult.find((term) => term.status === "upcoming") ?? termResult[0];
      setSelectedTermId((id) => termResult.some((term) => term.id === id) ? id : defaultTerm?.id ?? null);
    } catch {
      if (!active.current || ticket !== dataEpoch.current) return;
      setLoadError("We couldn't load your courses and terms. Please try again.");
    } finally {
      if (active.current && ticket === dataEpoch.current) setIsLoading(false);
    }
  }, [resetSearch, userId]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    submitBusy.current = false;
    setIsSubmitting(false);
    void loadData();
    return () => {
      active.current = false;
      dataEpoch.current += 1;
      searchEpoch.current += 1;
      submitEpoch.current += 1;
    };
  }, [loadData]));

  const selectedTerm = terms.find((term) => term.id === selectedTermId) ?? null;
  const fetchPage = useCallback(async (after: CourseCatalogCursor | null) => {
    if (!active.current || !selectedTerm || pageBusy.current) return;
    const ticket = ++searchEpoch.current;
    pageBusy.current = true;
    setIsSearching(true);
    setSearchError(null);
    try {
      const page = await searchCourseCatalog(selectedTerm, query, after);
      if (!active.current || ticket !== searchEpoch.current) return;
      setCourses((previous) => {
        const rows = after ? [...previous, ...page.courses] : page.courses;
        return rows.filter((course, index) => rows.findIndex((item) => item.id === course.id) === index);
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (!active.current || ticket !== searchEpoch.current) return;
      setSearchError("We couldn't load these courses. Check your connection and try again.");
    } finally {
      if (active.current && ticket === searchEpoch.current) {
        pageBusy.current = false;
        setIsSearching(false);
      }
    }
  }, [query, selectedTerm]);

  useEffect(() => {
    if (!active.current || isLoading || loadError || !selectedTerm) return;
    setIsSearching(true);
    const timer = setTimeout(() => { void fetchPage(null); }, 250);
    return () => {
      clearTimeout(timer);
      searchEpoch.current += 1;
      pageBusy.current = false;
    };
  }, [fetchPage, isLoading, loadError, selectedTerm]);

  const changeQuery = (value: string) => {
    if (submitBusy.current || value === query) return;
    resetSearch();
    setQuery(value);
    setIsSearching(selectedTerm !== null);
  };
  const selectTerm = (id: string) => {
    if (submitBusy.current || id === selectedTermId) return;
    resetSearch();
    setSelectedTermId(id);
    setIsSearching(true);
  };
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const existingMembership = myCourses.find((course) => course.id === selectedCourseId) ?? null;
  const canFindClassmates = existingMembership !== null && isCurrentCourse(existingMembership);
  const canAdd = selectedCourse !== null && existingMembership === null && !isSubmitting && !isLoading;
  const renderedSearchEpoch = searchEpoch.current;

  const addCourse = async () => {
    if (!active.current || !canAdd || !selectedCourse || submitBusy.current
      || selection.current !== selectedCourse.id) return;
    submitBusy.current = true;
    const ticket = ++submitEpoch.current;
    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      const result = await joinCourse(selectedCourse.id, userId);
      if (!active.current || ticket !== submitEpoch.current) return;
      // Keep the confirmed membership visible on this screen, including upcoming terms.
      setMyCourses((previous) => [
        ...previous.filter((course) => course.id !== selectedCourse.id),
        { ...selectedCourse, membershipStatus: "enrolled", joinedAt: new Date().toISOString(), endedAt: null },
      ]);
      setSubmitMessage(result === "already_enrolled"
        ? "This course is already in your CampusClutch courses."
        : selectedCourse.term.status === "upcoming"
          ? "Course added. You can find it under Upcoming in My Courses. Classmates become available when the term starts."
          : "Course added to My Courses.");
    } catch {
      if (!active.current || ticket !== submitEpoch.current) return;
      setSubmitMessage("We couldn't confirm this course was added. Your selection is kept; retrying will not add it twice.");
    } finally {
      if (active.current && ticket === submitEpoch.current) {
        submitBusy.current = false;
        setIsSubmitting(false);
      }
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Pressable style={styles.backRow} hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back to My Courses">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Add a Course</Text>
        </Pressable>
        <View />
      </ScreenHeader>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.searchBar}>
          <Ionicons name="search" size={19} color={COLORS.inactiveGray} />
          <TextInput value={query} onChangeText={changeQuery} editable={!isSubmitting}
            placeholder="Search by course code or name" placeholderTextColor={COLORS.inactiveGray}
            style={styles.searchInput} autoCorrect={false} returnKeyType="search" maxLength={100}
            accessibilityLabel="Search course catalog" />
          {query.length > 0 && <Pressable hitSlop={10} disabled={isSubmitting} onPress={() => changeQuery("")} accessibilityLabel="Clear course search">
            <Ionicons name="close-circle" size={19} color={COLORS.inactiveGray} />
          </Pressable>}
        </View>
        {isLoading ? <View style={styles.stateContainer}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.stateText}>Loading your courses and terms...</Text>
        </View> : loadError ? <View style={styles.stateContainer}>
          <Text style={styles.stateText}>{loadError}</Text>
          <Pressable style={styles.retryButton} onPress={() => void loadData()}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View> : <>
          <Text style={styles.smallLabel}>ACADEMIC TERM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow} keyboardShouldPersistTaps="handled">
            {terms.map((term) => <Pressable key={term.id} disabled={isSubmitting}
              style={[styles.optionPill, selectedTermId === term.id && styles.activeOptionPill]}
              onPress={() => selectTerm(term.id)} accessibilityRole="button" accessibilityState={{ selected: selectedTermId === term.id }}>
              <Text style={[styles.optionText, selectedTermId === term.id && styles.activeOptionText]}>{term.displayName}</Text>
            </Pressable>)}
          </ScrollView>
          {selectedTerm?.year === 2027 && selectedTerm.season === "spring" && <View style={styles.messageBox}>
            <Text style={styles.messageText}>Spring 2027 undergraduate courses · 3+ units</Text>
            <Text style={styles.messageText}>Published offerings only; some courses are awaiting details. Check SFU for registration and the latest schedule.</Text>
          </View>}
          <Text style={styles.smallLabel}>RESULTS</Text>
          {courses.length === 0 && !isSearching && !searchError && <Text style={styles.emptyText}>
            {query.trim() ? `No courses match "${query.trim()}".` : selectedTerm
              ? `No active courses are available for ${selectedTerm.displayName}.` : "No courses are available."}
          </Text>}
          <View style={styles.resultList}>
            {courses.map((course) => <Pressable key={course.id} disabled={isSubmitting}
              style={[styles.resultRow, selectedCourseId === course.id && styles.selectedResultRow]}
              onPress={() => {
                if (!active.current || renderedSearchEpoch !== searchEpoch.current) return;
                selection.current = course.id;
                setSelectedCourseId(course.id);
                setSubmitMessage(null);
              }}
              accessibilityRole="radio" accessibilityState={{ selected: selectedCourseId === course.id }}
              accessibilityLabel={`${course.code}, ${course.title}, ${courseDetailsLabel(course)}`}>
              <View style={styles.resultInfo}>
                <Text style={styles.resultCode}>{course.code}</Text>
                <Text style={styles.resultTitle}>{course.title}</Text>
                {!!courseDetailsLabel(course) && <Text style={styles.resultTitle}>{courseDetailsLabel(course)}</Text>}
                {myCourses.some((membership) => membership.id === course.id) && <Text style={styles.membershipLabel}>Already added</Text>}
              </View>
              <View style={[styles.radio, selectedCourseId === course.id && styles.radioSelected]}>
                {selectedCourseId === course.id && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
              </View>
            </Pressable>)}
          </View>
          {isSearching && <View style={styles.searchState}>
            <ActivityIndicator color={COLORS.primary} /><Text style={styles.stateText}>Searching courses...</Text>
          </View>}
          {searchError && <View style={styles.messageBox}>
            <Text style={styles.messageText}>{searchError}</Text>
            <Pressable style={styles.retryButton} onPress={() => void fetchPage(nextCursor)}>
              <Text style={styles.retryButtonText}>Retry course search</Text>
            </Pressable>
          </View>}
          {!!nextCursor && !isSearching && !searchError && <Pressable style={styles.loadMoreButton} onPress={() => void fetchPage(nextCursor)}>
            <Text style={styles.retryButtonText}>Load more courses</Text>
          </Pressable>}
          {selectedCourse && <View style={styles.confirmBox}>
            <Ionicons name="information-circle" size={20} color={COLORS.primary} />
            <View style={styles.confirmTextBlock}>
              <Text style={styles.confirmTitle}>{selectedCourse.code} · {selectedCourse.term.displayName}</Text>
              <Text style={styles.confirmSubtitle}>{existingMembership
                ? "This course is already in your CampusClutch courses."
                : "This adds a CampusClutch course membership. It does not change your university registration."}</Text>
              {selectedCourse.term.status === "upcoming" && <Text style={styles.confirmSubtitle}>Classmates become available when the term starts.</Text>}
            </View>
          </View>}
          {submitMessage && <View style={styles.messageBox}><Text style={styles.messageText}>{submitMessage}</Text></View>}
          {canFindClassmates && <Pressable style={styles.findLink} onPress={() => {
            if (existingMembership && isCurrentCourse(existingMembership)) router.push({ pathname: "/courses/classmates", params: { courseId: existingMembership.id } });
          }}>
            <FontAwesome5 name="user-friends" size={13} color={COLORS.primary} />
            <Text style={styles.findLinkText}>Find classmates in this course</Text>
          </Pressable>}
        </>}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={[styles.addCourseButton, !canAdd && styles.disabledButton]} disabled={!canAdd} onPress={() => void addCourse()}>
          {isSubmitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.addCourseButtonText}>
            {!selectedCourse ? "Select a course" : existingMembership ? "Already added" : `Add ${selectedCourse.code}`}
          </Text>}
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  searchState: { alignItems: "center", marginBottom: 20 },
  loadMoreButton: {
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 19,
    backgroundColor: COLORS.primary, alignItems: "center", marginBottom: 24,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  scrollView: {
    flex: 1,
  },
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
  stateContainer: {
    minHeight: 220,
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
    paddingVertical: 10,
    marginBottom: 14,
  },
  resultList: {
    gap: 10,
    marginBottom: 24,
  },
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
  resultInfo: {
    flex: 1,
    marginRight: 10,
    paddingVertical: 10,
  },
  resultCode: {
    fontSize: 17,
    fontWeight: "900",
    color: COLORS.textDark,
  },
  resultTitle: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.mutedText,
  },
  membershipLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary,
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
  pillRow: {
    paddingBottom: 22,
  },
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
  optionText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.mutedText,
  },
  activeOptionText: {
    color: COLORS.primary,
  },
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
  confirmTextBlock: {
    flex: 1,
    marginLeft: 10,
  },
  confirmTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },
  confirmSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    color: "#B45B67",
  },
  messageBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#F8F6F6",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  messageText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    color: COLORS.mutedText,
  },
  findLink: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  findLinkText: {
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },
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
