import { LoadingSkeleton, LoadingNotice } from '@/components/LoadingState';
import { MotionPressable as Pressable } from '@/components/motion';
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
  textDark: "#2B2525", mutedText: "#635C5C", border: "#ECE3E3", inactiveGray: "#635C5C", softPink: "#FBECEC",
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
  const joinedCourseIds = useRef<string[]>([]);
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [courses, setCourses] = useState<CourseCatalogItem[]>([]);
  const [myCourses, setMyCourses] = useState<MyCourse[]>([]);
  const [actionCourseId, setActionCourseId] = useState<string | null>(null);
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
    pageBusy.current = false;
    setCourses([]);
    setNextCursor(null);
    setActionCourseId(null);
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
      joinedCourseIds.current = memberships.map((course) => course.id);
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
  const renderedSearchEpoch = searchEpoch.current;

  const addCourse = async (course: CourseCatalogItem) => {
    if (!active.current || isLoading || submitBusy.current
      || renderedSearchEpoch !== searchEpoch.current
      || joinedCourseIds.current.includes(course.id)) return;
    setActionCourseId(course.id);
    submitBusy.current = true;
    const ticket = ++submitEpoch.current;
    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      const result = await joinCourse(course.id, userId);
      if (!active.current || ticket !== submitEpoch.current) return;
      joinedCourseIds.current = [...joinedCourseIds.current, course.id];
      // Keep the confirmed membership visible on this screen, including upcoming terms.
      setMyCourses((previous) => [
        ...previous.filter((membership) => membership.id !== course.id),
        { ...course, membershipStatus: "enrolled", joinedAt: new Date().toISOString(), endedAt: null },
      ]);
      setSubmitMessage(result === "already_enrolled"
        ? "This course is already in your CampusClutch courses."
        : course.term.status === "upcoming"
          ? "Added under Upcoming in My Courses. Classmates open when the term starts."
          : "Course added to My Courses.");
    } catch {
      if (!active.current || ticket !== submitEpoch.current) return;
      setSubmitMessage("We couldn't confirm the course was added. Try Add course again; it won't be added twice.");
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
        <Pressable style={styles.backRow} accessibilityRole="button" hitSlop={10} onPress={() => router.back()} accessibilityLabel="Back to My Courses">
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Add a Course</Text>
        </Pressable>
        <View />
      </ScreenHeader>
      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.searchBar}>
          <Ionicons name="search" size={19} color={COLORS.inactiveGray} />
          <TextInput value={query} onChangeText={changeQuery} editable={!isSubmitting}
            placeholder="Search courses" placeholderTextColor={COLORS.inactiveGray}
            style={styles.searchInput} autoCorrect={false} returnKeyType="search" maxLength={100}
            accessibilityLabel="Search course catalog" />
          {query.length > 0 && <Pressable style={styles.iconButton} accessibilityRole="button" hitSlop={10} disabled={isSubmitting} onPress={() => changeQuery("")} accessibilityLabel="Clear course search">
            <Ionicons name="close-circle" size={19} color={COLORS.inactiveGray} />
          </Pressable>}
        </View>
        {isLoading && !loadError ? <LoadingSkeleton variant="courses" label="Loading courses and terms…" /> : loadError ? <View style={styles.stateContainer} accessibilityLiveRegion="polite">
          <Text style={styles.stateText}>{loadError}</Text>
          <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void loadData()}>
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
            <Text style={styles.messageText}>Spring 2027 undergraduate courses with 3+ units</Text>
            <Text style={styles.messageText}>Some details are pending. Check SFU for registration and schedule updates.</Text>
          </View>}
          <Text style={styles.catalogHint}>Tap a course to read reviews. Adding it saves it to CampusClutch, not your SFU registration.</Text>
          <Text style={styles.smallLabel}>RESULTS</Text>
          {courses.length === 0 && !isSearching && !searchError && <Text style={styles.emptyText}>
            {query.trim() ? `No courses match "${query.trim()}".` : selectedTerm
              ? `No active courses are available for ${selectedTerm.displayName}.` : "No courses are available."}
          </Text>}
          <View style={styles.resultList}>
            {courses.map((course) => {
              const membership = myCourses.find((item) => item.id === course.id);
              const adding = isSubmitting && actionCourseId === course.id;
              const details = `${course.code}, ${course.term.displayName}, ${courseDetailsLabel(course)}`;
              return <View key={course.id} style={styles.resultRow}>
                <Pressable style={styles.resultInfo} disabled={isSubmitting}
                  accessibilityRole="button" accessibilityLabel={`Read reviews for ${details}`}
                  accessibilityHint="Reviews from all terms. Opening reviews does not add the course."
                  onPress={() => {
                    if (!active.current || submitBusy.current || renderedSearchEpoch !== searchEpoch.current) return;
                    router.push({ pathname: "/courses/reviews", params: { code: course.code } } as any);
                  }}>
                  <Text style={styles.resultCode}>{course.code}</Text>
                  <Text style={styles.resultTitle}>{course.title}</Text>
                  {!!courseDetailsLabel(course) && <Text style={styles.resultTitle}>{courseDetailsLabel(course, "\n")}</Text>}
                  <Text style={styles.reviewLink}>Read reviews from all terms ›</Text>
                </Pressable>
                <View style={styles.cardActions}>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={membership ? `Already added: ${details}` : `Add ${details}`}
                    accessibilityState={{ disabled: !!membership || isSubmitting, busy: adding }}
                    style={[styles.addCourseButton, !!membership && styles.addedButton, isSubmitting && styles.disabledButton]}
                    disabled={!!membership || isSubmitting} onPress={() => void addCourse(course)}>
                    {adding ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={[styles.addCourseButtonText, !!membership && styles.addedButtonText]}>
                      {membership ? "Already added" : "Add course"}
                    </Text>}
                  </Pressable>
                  {!!membership && isCurrentCourse(membership) && <Pressable accessibilityRole="button"
                    accessibilityLabel={`Classmates for ${details}`} style={styles.findLink} disabled={isSubmitting}
                    onPress={() => {
                      if (!active.current || submitBusy.current || renderedSearchEpoch !== searchEpoch.current) return;
                      router.push({ pathname: "/courses/classmates", params: { courseId: course.id } });
                    }}>
                    <FontAwesome5 name="user-friends" size={13} color={COLORS.primary} />
                    <Text style={styles.findLinkText}>Classmates</Text>
                  </Pressable>}
                </View>
                {actionCourseId === course.id && submitMessage && <View style={styles.cardMessage} accessibilityLiveRegion="polite">
                  <Text style={styles.messageText}>{submitMessage}</Text>
                </View>}
              </View>;
            })}
          </View>
          {isSearching && !searchError && (courses.length === 0
            ? <LoadingSkeleton variant="courses" label="Searching courses…" />
            : <LoadingNotice label="Loading more courses…" />)}
          {searchError && <View style={styles.messageBox} accessibilityLiveRegion="polite">
            <Text style={styles.messageText}>{searchError}</Text>
            <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void fetchPage(nextCursor)}>
              <Text style={styles.retryButtonText}>Retry course search</Text>
            </Pressable>
          </View>}
          {!!nextCursor && !isSearching && !searchError && <Pressable accessibilityRole="button" style={styles.loadMoreButton} onPress={() => void fetchPage(nextCursor)}>
            <Text style={styles.retryButtonText}>Load more courses</Text>
          </Pressable>}
        </>}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  iconButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  searchState: { alignItems: "center", marginBottom: 20 },
  loadMoreButton: {
    minHeight: 48, justifyContent: "center",
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 19,
    backgroundColor: COLORS.primary, alignItems: "center", marginBottom: 24,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backRow: {
    minHeight: 48,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    flexShrink: 1,
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
    minHeight: 52,
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
    minWidth: 0,
    paddingVertical: 12,
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
    paddingVertical: 10,
    marginBottom: 14,
  },
  resultList: {
    gap: 10,
    marginBottom: 24,
  },
  catalogHint: {
    fontSize: 13, lineHeight: 19, color: COLORS.mutedText, marginBottom: 18,
  },
  resultRow: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
    overflow: "hidden",
  },
  resultInfo: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  reviewLink: {
    color: COLORS.primary, fontSize: 13, fontWeight: "800", marginTop: 10,
  },
  cardActions: {
    flexDirection: "row", flexWrap: "wrap", gap: 12,
    alignItems: "center", paddingHorizontal: 16, paddingBottom: 16,
  },
  cardMessage: {
    backgroundColor: "#F8F6F6", paddingHorizontal: 16, paddingVertical: 12,
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
  pillRow: {
    paddingBottom: 22,
  },
  optionPill: {
    minHeight: 48,
    paddingVertical: 10,
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
    minHeight: 48,
    maxWidth: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  findLinkText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "900",
    color: COLORS.primary,
  },
  addCourseButton: {
    minHeight: 48,
    minWidth: 120,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: COLORS.darkRed,
    alignItems: "center",
    justifyContent: "center",
  },
  addedButton: { backgroundColor: COLORS.softPink },
  addedButtonText: { color: COLORS.primary },
  disabledButton: {
    backgroundColor: "#D8C2C2",
  },
  addCourseButtonText: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.cardWhite,
  },
});
