import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LoadingNotice, LoadingSkeleton } from "@/components/LoadingState";
import ScreenHeader from "../../components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import { exactReviewCourseCode, searchReviewCourses, type ReviewCourse } from "@/lib/courseReviewDirectory";

export default function ReviewDirectoryRoute() {
  const { user } = useAuth();
  return user ? <ReviewDirectory key={user.id} /> : null;
}

function ReviewDirectory() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<ReviewCourse>>(null);
  const ticket = useRef(0);
  const inFlight = useRef(false);
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<ReviewCourse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchPage = useCallback(async (after: string | null) => {
    if (inFlight.current) return;
    const request = ++ticket.current;
    inFlight.current = true;
    setFailed(false);
    setLoading(true);
    try {
      const page = await searchReviewCourses(query, after);
      if (request !== ticket.current) return;
      setCourses(previous => after ? [...previous, ...page.courses] : page.courses);
      setCursor(page.nextCode);
    } catch {
      if (request === ticket.current) setFailed(true);
    } finally {
      if (request === ticket.current) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [query]);

  const cancelSearch = useCallback(() => {
    ticket.current++;
    inFlight.current = false;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchPage(null); }, query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      cancelSearch();
    };
  }, [cancelSearch, fetchPage, query]);

  function changeQuery(value: string) {
    if (value === query) return;
    cancelSearch();
    setCourses([]);
    setCursor(null);
    setLoading(true);
    setFailed(false);
    setQuery(value);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }

  function openCourse(code: string) {
    router.push({ pathname: "/courses/reviews", params: { code } });
  }

  const exactCode = exactReviewCourseCode(query);
  const showOlderCourse = exactCode && !cursor && !loading && !failed &&
    !courses.some(course => course.course_code === exactCode);

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Courses"
        onPress={() => router.back()} style={styles.back}>
        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
      </Pressable>
      <Text accessibilityRole="header" style={styles.heading}>Course reviews</Text>
    </ScreenHeader>
    <View style={styles.searchArea}>
      <Text style={styles.hint}>Read reviews from any term or share your experience with a course you took.</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color="#635C5C" />
        <TextInput style={styles.input} value={query} onChangeText={changeQuery}
          placeholder="Course code or title" placeholderTextColor="#635C5C" accessibilityLabel="Search by course code or title"
          maxLength={80} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
        {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear search"
          style={styles.clear} onPress={() => changeQuery("")}>
          <Ionicons name="close-circle" size={20} color="#635C5C" />
        </Pressable>}
      </View>
    </View>
    <FlatList ref={list} data={courses} keyExtractor={course => course.course_code}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.results, { paddingBottom: insets.bottom + 24 }]}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={item.title === item.course_code ? item.course_code : `${item.course_code}, ${item.title}`}
        accessibilityHint="Opens course reviews" onPress={() => openCourse(item.course_code)} style={styles.row}>
        <View style={styles.course}>
          <Text style={styles.code}>{item.course_code}</Text>
          {item.title !== item.course_code && <Text style={styles.title}>{item.title}</Text>}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9B1C31" />
      </Pressable>}
      ListEmptyComponent={loading ? <LoadingSkeleton variant="courses" label="Loading courses for review…" /> :
        failed ? null : <View style={styles.feedback} accessibilityLiveRegion="polite">
          <Text style={styles.code}>{exactCode ? "Course not listed" : query.trim() ? "No matching courses" : "No courses available"}</Text>
          <Text style={styles.title}>{exactCode ? "You can still review it if you took it in a past term."
            : "For an older course, enter its full code, such as CMPT 120."}</Text>
        </View>}
      ListFooterComponent={<>
        {loading && courses.length > 0 && <LoadingNotice label="Loading more courses…" />}
        {failed && <Text accessibilityLiveRegion="polite" style={styles.error}>Course search couldn’t load. Try again.</Text>}
        {!loading && (failed || cursor) && <Pressable style={styles.action} accessibilityRole="button"
          onPress={() => void fetchPage(cursor)}><Text style={styles.actionText}>{failed ? "Try again" : "Show more courses"}</Text></Pressable>}
        {showOlderCourse && <View style={styles.fallback}>
          {courses.length > 0 && <Text style={styles.title}>Looking for an earlier course?</Text>}
          <Pressable style={styles.action} accessibilityRole="button" onPress={() => openCourse(exactCode)}>
            <Text style={styles.actionText}>Open reviews for {exactCode}</Text>
          </Pressable>
        </View>}
      </>} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  back: { width: 48, minHeight: 48, justifyContent: "center" },
  heading: { flex: 1, color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  searchArea: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8, gap: 12 },
  hint: { color: "#635C5C", fontSize: 15, lineHeight: 22 },
  searchBox: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingLeft: 14,
    borderColor: "#ECE3E3", borderWidth: 1, borderRadius: 13, gap: 8 },
  input: { flex: 1, minWidth: 0, color: "#2B2525", fontSize: 16, paddingVertical: 12, paddingRight: 8 },
  clear: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  results: { paddingHorizontal: 20 },
  row: { flexDirection: "row", alignItems: "center", minHeight: 56, gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#ECE3E3" },
  course: { flex: 1, gap: 3 },
  code: { color: "#2B2525", fontSize: 17, fontWeight: "700" },
  title: { color: "#635C5C", fontSize: 15, lineHeight: 21 },
  feedback: { paddingTop: 20, gap: 6 },
  fallback: { paddingTop: 12 },
  action: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingVertical: 10 },
  actionText: { color: "#9B1C31", fontSize: 15, fontWeight: "700" },
  error: { color: "#9B1C31", fontSize: 15, paddingTop: 16 },
});
