import { LoadingSkeleton } from '@/components/LoadingState';
import { MotionPressable as Pressable } from '@/components/motion';
import { useDirectAdmin } from '../../lib/useDirectAdmin';
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScreenHeader from "@/components/ScreenHeader";
import { useAuth } from "@/context/AuthContext";
import {
  deleteCourseReview,
  getCourseReviews,
  getCourseReviewSummary,
  saveCourseReview,
} from "@/lib/courseReviews";
import {
  COURSE_GRADES,
  COURSE_REVIEW_TAGS,
  type CourseReview,
  type CourseReviewInput,
  type CourseReviewSummary,
  type PastReviewTerm,
  type ReviewCursor,
} from "@/types/courseReview";

const COLORS = {
  primary: "#9B1C31",
  text: "#2B2525",
  muted: "#635C5C",
  border: "#ECE3E3",
  pink: "#FBECEC",
  pale: "#FAF7F7",
  white: "#FFFFFF",
};

type ReviewDraft = Omit<CourseReviewInput, "difficulty" | "workload" | "recommend"> & {
  difficulty: number | null;
  workload: number | null;
  recommend: boolean | null;
};
type Editor = { reviewId: string | null; termName: string; draft: ReviewDraft; isHidden?: boolean; choosingPastTerm: boolean };

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function reviewDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function CourseReviewsRoute() {
  const { user } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const courseCode = (Array.isArray(code) ? code[0] : code)?.trim().toUpperCase() ?? "";
  return user ? <CourseReviewsScreen key={`${user.id}:${courseCode}`} userId={user.id} courseCode={courseCode} /> : null;
}

function CourseReviewsScreen({ userId, courseCode }: { userId: string; courseCode: string }) {
  const router = useRouter();
  const admin = useDirectAdmin(userId);
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const focusEpoch = useRef(0);
  const loadEpoch = useRef(0);
  const mutationBusy = useRef(false);
  const paginationBusy = useRef(false);
  const scrollToEditor = useRef(false);
  const [summary, setSummary] = useState<CourseReviewSummary | null>(null);
  const [reviews, setReviews] = useState<CourseReview[]>([]);
  const currentReviews = useRef(reviews);
  currentReviews.current = reviews;
  const [active, setActive] = useState(false);
  const [nextCursor, setNextCursor] = useState<ReviewCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CourseReview | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!focused.current || !foreground.current) return;
    const ticket = ++loadEpoch.current;
    paginationBusy.current = false;
    setLoadingOlder(false);
    setLoading(true);
    setLoadError(null);
    setOlderError(null);
    if (!courseCode) {
      setLoadError("No course was selected. Go back and open a course card.");
      setLoading(false);
      return;
    }
    try {
      const [overview, page] = await Promise.all([
        getCourseReviewSummary(courseCode, userId),
        getCourseReviews(courseCode, userId),
      ]);
      if (!focused.current || ticket !== loadEpoch.current) return;
      setSummary(overview);
      setReviews(page.reviews);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (!focused.current || ticket !== loadEpoch.current) return;
      setLoadError(errorText(error, "We couldn't load course reviews. Check your connection and try again."));
    } finally {
      if (focused.current && ticket === loadEpoch.current) setLoading(false);
    }
  }, [courseCode, userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState === "active";
    setActive(foreground.current);
    focusEpoch.current += 1;
    mutationBusy.current = false;
    setBusy(false);
    void load();
    return () => {
      focused.current = false;
      setActive(false);
      focusEpoch.current += 1;
      loadEpoch.current += 1;
    };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const wasForeground = foreground.current;
      foreground.current = state === "active";
      setActive(focused.current && foreground.current);
      if (!wasForeground && foreground.current && !mutationBusy.current) void load();
    });
    return () => subscription.remove();
  }, [load]);

  const availableTerms = useMemo(() => summary?.eligibleTerms.filter(
    (term) => !summary.myReviews.some((review) => review.termId === term.id),
  ) ?? [], [summary]);
  const reviewedTerms = useMemo(() => new Set(summary?.myReviews.map(review => review.termId)), [summary]);
  const hasPastTerm = summary?.pastTerms.some(term => !reviewedTerms.has(term.id)) ?? false;

  const openReviewReport = (reviewId: string) => {
    if (!focused.current || !foreground.current || mutationBusy.current
      || !currentReviews.current.some(review => review.id === reviewId && review.isMine === false)) return;
    router.push({ pathname: "/safety/report", params: { targetType: "course_review", targetId: reviewId } });
  };

  const loadOlder = async () => {
    if (!focused.current || !nextCursor || loading || mutationBusy.current || paginationBusy.current) return;
    paginationBusy.current = true;
    const ticket = loadEpoch.current;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await getCourseReviews(courseCode, userId, nextCursor);
      if (!focused.current || ticket !== loadEpoch.current) return;
      setReviews((previous) => {
        const seen = new Set(previous.map((review) => review.id));
        return [...previous, ...page.reviews.filter((review) => !seen.has(review.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (focused.current && ticket === loadEpoch.current) setOlderError(errorText(error, "We couldn't load older reviews. Please try again."));
    } finally {
      if (focused.current && ticket === loadEpoch.current) {
        paginationBusy.current = false;
        setLoadingOlder(false);
      }
    }
  };

  const openEditor = (review?: CourseReview) => {
    if (!focused.current || mutationBusy.current) return;
    const term = availableTerms[0];
    if (!review && !term && !hasPastTerm) return;
    setNotice(null);
    setFormError(null);
    setPendingDelete(null);
    scrollToEditor.current = true;
    setEditor(review ? {
      reviewId: review.id,
      choosingPastTerm: false,
      isHidden: review.isHidden,
      termName: review.termName,
      draft: {
        termId: review.termId, difficulty: review.difficulty, workload: review.workload,
        recommend: review.recommend, grade: review.grade, comment: review.comment,
        tips: review.tips, instructor: review.instructor, tags: [...review.tags],
      },
    } : {
      reviewId: null,
      choosingPastTerm: !term,
      termName: term?.displayName ?? "",
      draft: {
        termId: term?.id ?? "", difficulty: null, workload: null, recommend: null,
        grade: null, comment: "", tips: "", instructor: "", tags: [],
      },
    });
  };

  const updateDraft = (change: Partial<ReviewDraft>) => {
    if (mutationBusy.current) return;
    setEditor((current) => current ? { ...current, draft: { ...current.draft, ...change } } : null);
    setFormError(null);
  };

  const selectTerm = (term: { id: string; displayName: string } | null, choosingPastTerm: boolean) => {
    if (mutationBusy.current) return;
    setEditor(current => current && {
      ...current, choosingPastTerm, termName: term?.displayName ?? "",
      draft: { ...current.draft, termId: term?.id ?? "" },
    });
    setFormError(null);
  };

  const save = async () => {
    if (!focused.current || mutationBusy.current || !editor) return;
    const draft = editor.draft;
    if (!draft.termId) {
      setFormError("Choose the year and semester when you took this course.");
      return;
    }
    if (!editor.reviewId && reviewedTerms.has(draft.termId)) {
      setFormError("You already reviewed this term. Open your existing review to edit it.");
      return;
    }
    if (!draft.difficulty || !draft.workload || draft.recommend === null) {
      setFormError("Choose a difficulty, workload, and whether you recommend this course.");
      return;
    }
    if (draft.comment.trim().length < 10 || draft.comment.trim().length > 2000) {
      setFormError("Write a review between 10 and 2,000 characters.");
      return;
    }
    mutationBusy.current = true;
    const ticket = focusEpoch.current;
    loadEpoch.current += 1;
    setLoading(false);
    setLoadingOlder(false);
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      await saveCourseReview(courseCode, userId, {
        ...draft, difficulty: draft.difficulty, workload: draft.workload,
        recommend: draft.recommend,
      });
      if (!focused.current || ticket !== focusEpoch.current) return;
      setEditor(null);
      setNotice("Your review was saved. Thank you for sharing your experience.");
      await load();
    } catch (error) {
      if (focused.current && ticket === focusEpoch.current) setFormError(errorText(error, "We couldn't confirm your review was saved. Your answers are still here; retry when connected."));
    } finally {
      if (focused.current && ticket === focusEpoch.current) {
        mutationBusy.current = false;
        setBusy(false);
      }
    }
  };

  const confirmDelete = async () => {
    if (!focused.current || mutationBusy.current || !pendingDelete) return;
    mutationBusy.current = true;
    const ticket = focusEpoch.current;
    loadEpoch.current += 1;
    setLoading(false);
    setLoadingOlder(false);
    setBusy(true);
    setDeleteError(null);
    setNotice(null);
    try {
      await deleteCourseReview(pendingDelete.id, userId);
      if (!focused.current || ticket !== focusEpoch.current) return;
      if (editor?.reviewId === pendingDelete.id) setEditor(null);
      setPendingDelete(null);
      setNotice("Your review was removed. The course summary will reflect this change.");
      await load();
    } catch (error) {
      if (focused.current && ticket === focusEpoch.current) setDeleteError(errorText(error, "We couldn't confirm your review was removed. Please try again."));
    } finally {
      if (focused.current && ticket === focusEpoch.current) {
        mutationBusy.current = false;
        setBusy(false);
      }
    }
  };

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable style={styles.iconButton} accessibilityLabel="Back to courses" accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={COLORS.white} />
      </Pressable>
      <Text style={styles.headerTitle}>Course Reviews</Text>
      <Pressable style={styles.iconButton} accessibilityLabel="Refresh course reviews" accessibilityRole="button" hitSlop={12} disabled={loading || busy} onPress={() => void load()}>
        {loading ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="refresh" size={23} color={COLORS.white} />}
      </Pressable>
    </ScreenHeader>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 20) }]} keyboardShouldPersistTaps="handled">
        {loadError && <View style={styles.messageBox} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable style={styles.textButton} disabled={loading || busy} accessibilityRole="button" onPress={() => void load()}><Text style={styles.actionText}>Retry loading reviews</Text></Pressable>
        </View>}
        {notice && <View style={styles.messageBox} accessibilityLiveRegion="polite"><Text style={styles.noticeText}>{notice}</Text></View>}
        {loading && !loadError && !summary && <LoadingSkeleton variant="reviews" label="Loading course reviews…" />}
        {summary && <>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>REVIEWS FROM ALL TERMS</Text>
            <Text style={styles.courseCode}>{summary.courseCode}</Text>
            {summary.title !== summary.courseCode && <Text style={styles.courseTitle}>{summary.title}</Text>}
            <Text style={styles.body}>Reviews are anonymous to other students.</Text>
            {(availableTerms.length > 0 || hasPastTerm) && !editor && <Pressable style={styles.primaryButton} accessibilityRole="button" disabled={busy} onPress={() => openEditor()}><Text style={styles.primaryButtonText}>Write a review</Text></Pressable>}
            {!hasPastTerm && !availableTerms.length && !summary.myReviews.length && <Text style={styles.caption}>You can read reviews without adding this course.</Text>}
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>At a glance</Text><Text style={styles.count}>{summary.reviewCount} {summary.reviewCount === 1 ? "review" : "reviews"}</Text></View>
            <View style={styles.metrics}>
              <Metric label="Difficulty" value={summary.averageDifficulty === null ? "—" : `${summary.averageDifficulty.toFixed(1)}/5`} />
              <Metric label="Workload" value={summary.averageWorkload === null ? "—" : `${summary.averageWorkload.toFixed(1)}/5`} />
              <Metric label="Recommend" value={summary.recommendPercent === null ? "—" : `${Math.round(summary.recommendPercent)}%`} />
            </View>
            {summary.reviewCount === 0 ? <Text style={styles.body}>No reviews yet. Share your experience to help other students.</Text> : <Text style={styles.caption}>Higher scores mean a harder course or a heavier workload.</Text>}
            {summary.topTags.length > 0 && <View style={styles.tags}>{summary.topTags.map(({ tag, count }) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag} ({count})</Text></View>)}</View>}
          </View>

          <GradeChart grades={summary.gradeCounts} />

          {summary.myReviews.length > 0 && <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your reviews</Text>
            {summary.myReviews.map((review) => <View key={review.id} style={styles.ownReview}>
              <View style={{ flexShrink: 1 }}><Text style={styles.ownTerm}>{review.termName}</Text><Text style={styles.caption}>Your review from {reviewDate(review.updatedAt)}</Text>
                {review.isHidden && <Text style={styles.caption}>Hidden by moderation. Edit to publish a revision, or delete and start again.</Text>}
              </View>
              <Pressable style={styles.textButton} accessibilityRole="button" accessibilityLabel={`Edit your ${review.termName} review`} disabled={busy} onPress={() => openEditor(review)}><Text style={styles.actionText}>Edit</Text></Pressable>
              <Pressable style={styles.textButton} accessibilityRole="button" accessibilityLabel={`Delete your ${review.termName} review`} disabled={busy} onPress={() => { setPendingDelete(review); setDeleteError(null); }}><Text style={styles.actionText}>Delete</Text></Pressable>
            </View>)}
          </View>}

          {pendingDelete && <View style={styles.messageBox} accessibilityLiveRegion="polite">
            <Text style={styles.ownTerm}>Delete your {pendingDelete.termName} review?</Text>
            <Text style={styles.body}>{pendingDelete.isHidden ? "Delete this hidden review and start again? Moderators keep the original record." : "Its ratings and grade will also be removed from the course summary."}</Text>
            {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
            <View style={styles.actions}>
              <Pressable style={styles.secondaryButton} disabled={busy} accessibilityRole="button" onPress={() => setPendingDelete(null)}><Text style={styles.actionText}>Keep review</Text></Pressable>
              <Pressable style={styles.primaryButton} disabled={busy} accessibilityRole="button" onPress={() => void confirmDelete()}>{busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.primaryButtonText}>Delete review</Text>}</Pressable>
            </View>
          </View>}

          {editor && <View style={styles.card} onLayout={(event) => {
            if (!scrollToEditor.current) return;
            scrollToEditor.current = false;
            scroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 12), animated: true });
          }}>
            <Text style={styles.sectionTitle}>{editor.reviewId ? "Edit your review" : "Write a review"}</Text>
            <Text style={styles.body}>Your name is hidden from other students. Avoid identifying details in your review.</Text>
            {editor.isHidden && <Text style={styles.body}>Address the moderation feedback. Your revision will be public; the original stays hidden.</Text>}
            <Text style={styles.label}>Term taken</Text>
            {editor.reviewId ? <Text style={styles.ownTerm}>{editor.termName}</Text> : <>
              {availableTerms.length > 0 && !editor.choosingPastTerm && <View style={styles.chips}>
                {availableTerms.map(term => <Choice key={term.id} label={term.displayName}
                  selected={editor.draft.termId === term.id} disabled={busy} onPress={() => selectTerm(term, false)} />)}
                {hasPastTerm && <Choice label="Choose a past term" selected={false} disabled={busy} onPress={() => selectTerm(null, true)} />}
              </View>}
              {editor.choosingPastTerm && <>
                <PastTermPicker terms={summary.pastTerms} reviewedTerms={reviewedTerms}
                  selectedId={editor.draft.termId} disabled={busy} onSelect={term => selectTerm(term, true)} />
                {availableTerms.length > 0 && <Pressable style={styles.textButton} accessibilityRole="button" disabled={busy} onPress={() => selectTerm(availableTerms[0], false)}>
                  <Text style={styles.actionText}>Use a term from my courses</Text>
                </Pressable>}
              </>}
            </>}
            <RatingInput label="Difficulty" hint="1 is very easy, 5 is very hard" value={editor.draft.difficulty} disabled={busy} onChange={(difficulty) => updateDraft({ difficulty })} />
            <RatingInput label="Workload" hint="1 is very light, 5 is very heavy" value={editor.draft.workload} disabled={busy} onChange={(workload) => updateDraft({ workload })} />
            <Text style={styles.label}>Would you recommend this course?</Text>
            <View style={styles.chips}><Choice label="Yes" selected={editor.draft.recommend === true} disabled={busy} onPress={() => updateDraft({ recommend: true })} /><Choice label="No" selected={editor.draft.recommend === false} disabled={busy} onPress={() => updateDraft({ recommend: false })} /></View>
            <Text style={styles.label}>Grade received (optional)</Text>
            <Text style={styles.caption}>Use a grade you received, or leave blank.</Text>
            <View style={styles.chips}><Choice label="Not sharing / not graded" selected={editor.draft.grade === null} disabled={busy} onPress={() => updateDraft({ grade: null })} />{COURSE_GRADES.map((grade) => <Choice key={grade} label={grade} selected={editor.draft.grade === grade} disabled={busy} onPress={() => updateDraft({ grade })} />)}</View>
            <Text style={styles.label}>Your review</Text>
            <TextInput accessibilityLabel="Your course review" style={[styles.input, styles.multiline]} value={editor.draft.comment} onChangeText={(comment) => updateDraft({ comment })} placeholder="What should another student know about this course?" placeholderTextColor={COLORS.muted} multiline maxLength={2000} editable={!busy} textAlignVertical="top" />
            <Text style={styles.counter}>{editor.draft.comment.length}/2,000 (minimum 10 characters)</Text>
            <Text style={styles.label}>Study tips (optional)</Text>
            <TextInput accessibilityLabel="Study tips" style={[styles.input, styles.multiline]} value={editor.draft.tips} onChangeText={(tips) => updateDraft({ tips })} placeholder="Share helpful study habits, without posting exam answers." placeholderTextColor={COLORS.muted} multiline maxLength={1000} editable={!busy} textAlignVertical="top" />
            <Text style={styles.counter}>{editor.draft.tips.length}/1,000</Text>
            <Text style={styles.label}>Instructor (optional)</Text>
            <TextInput accessibilityLabel="Course instructor" style={styles.input} value={editor.draft.instructor} onChangeText={(instructor) => updateDraft({ instructor })} placeholder="Instructor's name" placeholderTextColor={COLORS.muted} maxLength={120} editable={!busy} />
            <Text style={styles.label}>Describe the course (up to 3 tags)</Text>
            <View style={styles.chips}>{COURSE_REVIEW_TAGS.map((tag) => {
              const selected = editor.draft.tags.includes(tag);
              return <Choice key={tag} label={tag} selected={selected} disabled={busy || (!selected && editor.draft.tags.length >= 3)} onPress={() => updateDraft({ tags: selected ? editor.draft.tags.filter((item) => item !== tag) : [...editor.draft.tags, tag] })} />;
            })}</View>
            {formError && <Text style={styles.errorText} accessibilityLiveRegion="polite">{formError}</Text>}
            <View style={styles.actions}>
              <Pressable style={styles.secondaryButton} accessibilityRole="button" disabled={busy} onPress={() => { setEditor(null); setFormError(null); }}><Text style={styles.actionText}>Cancel</Text></Pressable>
              <Pressable style={styles.primaryButton} accessibilityRole="button" disabled={busy} onPress={() => void save()}>{busy ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.primaryButtonText}>Save review</Text>}</Pressable>
            </View>
          </View>}

          <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Reviews from all terms</Text></View>
          {reviews.length === 0 ? <View style={styles.card}><Ionicons name="chatbubble-ellipses-outline" size={28} color={COLORS.primary} /><Text style={styles.body}>No reviews yet. Experiences from current and past terms will appear here.</Text></View> : reviews.map((review) => <ReviewCard key={review.id} review={review}
            reportDisabled={!active || busy} onReport={() => openReviewReport(review.id)}
            onModerate={admin.allowed && !review.isMine ? () => {
              if (focused.current && foreground.current && !mutationBusy.current && currentReviews.current.some(item => item.id === review.id && !item.isMine)) admin.open('course_review', review.id);
            } : undefined} />)}
          {olderError && <Text style={styles.errorText} accessibilityLiveRegion="polite">{olderError}</Text>}
          {nextCursor && <Pressable style={styles.secondaryButton} accessibilityRole="button" disabled={loading || loadingOlder || busy} onPress={() => void loadOlder()}>{loadingOlder ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.actionText}>{olderError ? "Retry older reviews" : "Load older reviews"}</Text>}</Pressable>}
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.caption}>{label}</Text></View>;
}

function GradeChart({ grades }: { grades: CourseReviewSummary["gradeCounts"] }) {
  const counts = new Map(grades.map((item) => [item.grade, item.count]));
  const total = grades.reduce((sum, item) => sum + item.count, 0);
  const maximum = Math.max(1, ...grades.map((item) => item.count));
  return <View style={styles.card}>
    <Text style={styles.sectionTitle}>Grade distribution</Text>
    <Text style={styles.body}>Student-reported grades, not official SFU results.</Text>
    {total > 0 ? <>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.chart}>
        {COURSE_GRADES.map((grade) => {
          const count = counts.get(grade) ?? 0;
          return <View key={grade} style={styles.gradeColumn} accessible accessibilityLabel={`${grade}: ${count} ${count === 1 ? "review" : "reviews"}`}>
            <Text style={styles.gradeCount}>{count}</Text>
            <View style={styles.gradeTrack}><View style={[styles.gradeBar, { height: (count / maximum) * 112 }]} /></View>
            <Text style={styles.gradeLabel}>{grade}</Text>
          </View>;
        })}
      </ScrollView>
      <Text style={styles.caption}>{total} {total === 1 ? "reported grade" : "reported grades"}. Reviews without a grade are excluded.</Text>
    </> : <View style={styles.chartEmpty}><Ionicons name="bar-chart-outline" size={28} color={COLORS.primary} /><Text style={styles.body}>No grades shared yet. This chart updates as students add or edit their reviews.</Text></View>}
  </View>;
}

function PastTermPicker({ terms, reviewedTerms, selectedId, disabled, onSelect }: {
  terms: PastReviewTerm[]; reviewedTerms: Set<string>; selectedId: string; disabled: boolean;
  onSelect(term: PastReviewTerm | null): void;
}) {
  const [year, setYear] = useState<number | null>(null);
  const [decade, setDecade] = useState<number | null>(null);
  const years = [...new Set(terms.map(term => term.year))].sort((a, b) => b - a);
  const decades = [...new Set(years.map(value => Math.floor(value / 10) * 10))];
  const shownYears = years.filter(value => decade !== null && value >= decade && value < decade + 10);
  const decadeIndex = decade === null ? -1 : decades.indexOf(decade);
  const seasons = ["spring", "summer", "fall"];
  const termsInYear = terms.filter(term => term.year === year)
    .sort((a, b) => seasons.indexOf(a.season) - seasons.indexOf(b.season));
  return <View style={styles.termPicker}>
    <Pressable style={styles.yearButton} accessibilityRole="button" disabled={disabled}
      accessibilityLabel={year === null ? "Choose year" : `Change year from ${year}`}
      accessibilityState={{ expanded: decade !== null, disabled }}
      onPress={() => setDecade(decade === null ? Math.floor((year ?? years[0]) / 10) * 10 : null)}>
      <Text style={styles.actionText}>{year ?? "Choose year"}</Text>
      <Ionicons name={decade !== null ? "chevron-up" : "chevron-down"} size={18} color={COLORS.primary} />
    </Pressable>
    {decade !== null ? <>
      <View style={styles.sectionHeading}>
        <Pressable accessibilityRole="button" accessibilityLabel="Earlier years" style={styles.iconButton}
          disabled={disabled || decadeIndex === decades.length - 1} onPress={() => setDecade(decades[decadeIndex + 1])}>
          <Ionicons name="chevron-back" size={22} color={decadeIndex === decades.length - 1 ? COLORS.border : COLORS.primary} />
        </Pressable>
        <Text style={styles.ownTerm} accessibilityLiveRegion="polite">{shownYears[shownYears.length - 1]}–{shownYears[0]}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="More recent years" style={styles.iconButton}
          disabled={disabled || decadeIndex <= 0} onPress={() => setDecade(decades[decadeIndex - 1])}>
          <Ionicons name="chevron-forward" size={22} color={decadeIndex <= 0 ? COLORS.border : COLORS.primary} />
        </Pressable>
      </View>
      <View style={styles.chips}>{shownYears.map(option => <Choice key={option} label={String(option)}
        selected={option === year} disabled={disabled} onPress={() => {
          if (year !== option) onSelect(null);
          setYear(option);
          setDecade(null);
        }} />)}</View>
    </> : year !== null && <View style={styles.chips}>
      {termsInYear.map(term => <Choice key={term.id} label={reviewedTerms.has(term.id) ? `${term.displayName} (reviewed)` : term.displayName}
        selected={term.id === selectedId} disabled={disabled || reviewedTerms.has(term.id)} onPress={() => onSelect(term)} />)}
    </View>}
  </View>;
}

function Choice({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable style={[styles.choice, selected && styles.choiceSelected, disabled && !selected && styles.disabled]} accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function RatingInput({ label, hint, value, disabled, onChange }: { label: string; hint: string; value: number | null; disabled: boolean; onChange: (rating: number) => void }) {
  return <View><Text style={styles.label}>{label}</Text><Text style={styles.caption}>{hint}</Text><View style={styles.chips}>{[1, 2, 3, 4, 5].map((rating) => <Pressable key={rating} style={[styles.ratingChoice, value === rating && styles.choiceSelected]} accessibilityRole="button" accessibilityLabel={`${label} ${rating} out of 5`} accessibilityState={{ selected: value === rating, disabled }} disabled={disabled} onPress={() => onChange(rating)}><Text style={[styles.choiceText, value === rating && styles.choiceTextSelected]}>{rating}</Text></Pressable>)}</View></View>;
}

function ReviewCard({ review, reportDisabled, onReport, onModerate }: { review: CourseReview; reportDisabled: boolean; onReport: () => void; onModerate?: () => void }) {
  return <View style={styles.card}>
    <View style={styles.sectionHeading}><Text style={styles.ownTerm}>{review.isMine ? "Your review" : "Anonymous student"}</Text><Text style={styles.caption}>{reviewDate(review.createdAt)}</Text></View>
    <Text style={styles.termLabel}>{review.termName}</Text>
    {!!review.instructor && <Text style={styles.termLabel}>Instructor: {review.instructor}</Text>}
    <View style={styles.tags}>
      <View style={styles.tag}><Text style={styles.tagText}>Difficulty {review.difficulty}/5</Text></View>
      <View style={styles.tag}><Text style={styles.tagText}>Workload {review.workload}/5</Text></View>
      <View style={styles.tag}><Text style={styles.tagText}>{review.recommend ? "Recommends" : "Doesn't recommend"}</Text></View>
      {review.grade && <View style={styles.tag}><Text style={styles.tagText}>Grade {review.grade}</Text></View>}
    </View>
    <Text style={styles.reviewText}>{review.comment}</Text>
    {!!review.tips && <View style={styles.tips}><Text style={styles.ownTerm}>Study tips</Text><Text style={styles.reviewText}>{review.tips}</Text></View>}
    {review.tags.length > 0 && <View style={styles.tags}>{review.tags.map((tag) => <Text key={tag} style={styles.tagText}>#{tag.replace(/ /g, "")}</Text>)}</View>}
    {review.updatedAt !== review.createdAt && <Text style={styles.caption}>Updated {reviewDate(review.updatedAt)}</Text>}
    {review.isMine === false && <Pressable style={styles.reportButton} accessibilityRole="button"
      accessibilityLabel="Report review" accessibilityHint="Opens a private report about this anonymous review"
      testID={`report-review-${review.id}`} disabled={reportDisabled} accessibilityState={{ disabled: reportDisabled }}
      onPress={onReport}><Text style={styles.actionText}>Report review</Text></Pressable>}
    {onModerate && <Pressable accessibilityRole="button" style={styles.secondaryButton} disabled={reportDisabled} onPress={onModerate}><Text style={styles.actionText}>Admin actions</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  flex: { flex: 1 },
  headerTitle: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 20, fontWeight: "900", color: COLORS.white },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 16 },
  intro: { gap: 5, paddingVertical: 4 },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  courseCode: { color: COLORS.text, fontSize: 30, fontWeight: "900" },
  courseTitle: { color: COLORS.text, fontSize: 18, fontWeight: "700", marginBottom: 5 },
  card: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, gap: 10, backgroundColor: COLORS.white },
  reportButton: { minWidth: 48, minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 8 },
  sectionHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sectionTitle: { color: COLORS.text, fontSize: 18, fontWeight: "800" },
  count: { color: COLORS.primary, fontSize: 12, fontWeight: "700" },
  body: { color: COLORS.muted, fontSize: 13, lineHeight: 20 },
  caption: { color: COLORS.muted, fontSize: 11, lineHeight: 17 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { flexGrow: 1, flexBasis: 120, alignItems: "center", paddingVertical: 13, paddingHorizontal: 6, backgroundColor: COLORS.pink, borderRadius: 12, gap: 4 },
  metricValue: { color: COLORS.primary, fontSize: 20, fontWeight: "900" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 3 },
  tag: { maxWidth: "100%", backgroundColor: COLORS.pale, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  tagText: { fontSize: 11, fontWeight: "700", color: COLORS.primary },
  chart: { flexDirection: "row", flexGrow: 1, alignItems: "flex-end", gap: 4, paddingVertical: 10 },
  gradeColumn: { flexGrow: 1, minWidth: 44, gap: 5, alignItems: "center" },
  gradeTrack: { width: 18, height: 112, backgroundColor: COLORS.pale, justifyContent: "flex-end", borderRadius: 4, overflow: "hidden" },
  gradeBar: { backgroundColor: COLORS.primary, width: "100%", borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  gradeCount: { color: COLORS.muted, fontSize: 10, fontWeight: "700" },
  gradeLabel: { color: COLORS.text, fontSize: 11, fontWeight: "700" },
  chartEmpty: { borderRadius: 12, backgroundColor: COLORS.pale, padding: 16, gap: 8 },
  ownReview: { alignItems: "stretch", gap: 8, borderTopColor: COLORS.border, borderTopWidth: 1, paddingTop: 10 },
  ownTerm: { color: COLORS.text, fontSize: 13, fontWeight: "800", lineHeight: 20 },
  primaryButton: { backgroundColor: COLORS.primary, minHeight: 48, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: "800", textAlign: "center" },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, minHeight: 48, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  textButton: { paddingHorizontal: 10, paddingVertical: 10, minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  actionText: { color: COLORS.primary, fontSize: 13, fontWeight: "800", textAlign: "center" },
  messageBox: { borderRadius: 14, padding: 15, backgroundColor: COLORS.pink, gap: 10 },
  errorText: { color: COLORS.primary, fontSize: 13, lineHeight: 20, fontWeight: "600" },
  noticeText: { color: COLORS.primary, fontSize: 13, lineHeight: 20, fontWeight: "600" },
  empty: { minHeight: 160, justifyContent: "center", alignItems: "center", gap: 14 },
  label: { fontSize: 13, fontWeight: "800", color: COLORS.text, marginTop: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 5 },
  termPicker: { gap: 6 },
  yearButton: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12 },
  choice: { maxWidth: "100%", paddingHorizontal: 12, minWidth: 48, minHeight: 48, paddingVertical: 10, borderRadius: 22, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  choiceSelected: { backgroundColor: COLORS.pink, borderColor: COLORS.primary },
  choiceText: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: COLORS.primary },
  disabled: { opacity: 0.45 },
  ratingChoice: { minWidth: 48, minHeight: 48, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  input: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.pale, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 46, color: COLORS.text, fontSize: 14 },
  multiline: { minHeight: 110, lineHeight: 21 },
  counter: { color: COLORS.muted, fontSize: 10, textAlign: "right" },
  actions: { gap: 10, marginTop: 10 },
  termLabel: { color: COLORS.primary, fontSize: 12, fontWeight: "700", lineHeight: 18 },
  reviewText: { color: COLORS.text, fontSize: 14, lineHeight: 22 },
  tips: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, gap: 5 },
});
