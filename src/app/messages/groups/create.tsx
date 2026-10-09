import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import ScreenHeader from "../../../components/ScreenHeader";
import { useAuth } from "../../../context/AuthContext";
import { env } from "../../../lib/env";
import {
  getCourseClassmates,
  getMyCourses,
  isCurrentCourse,
} from "../../../lib/courses";
import { createGroupConversation } from "../../../lib/groupConversations";
import { validateGroupCreation } from "../../../lib/groupMessagingUi";
import type { CourseClassmate, MyCourse } from "../../../types";

const COLORS = {
  primary: "#9B1C31",
  text: "#2B2525",
  muted: "#766F6F",
  border: "#E9DEDE",
  field: "#F5F2F2",
  pale: "#FBECEC",
  white: "#FFFFFF",
};

type FrozenSubmission = {
  clientCreationId: string;
  courseId: string;
  title: string;
  inviteeIds: string[];
};

type SavedCreation = {
  version: 1;
  title: string;
  courseId: string | null;
  inviteeIds: string[];
  pending: FrozenSubmission | null;
};

const EMPTY_SAVED: SavedCreation = {
  version: 1,
  title: "",
  courseId: null,
  inviteeIds: [],
  pending: null,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageQueues = new Map<string, Promise<unknown>>();

function inStorageOrder<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (storageQueues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  storageQueues.set(key, next);
  void next.finally(() => {
    if (storageQueues.get(key) === next) storageQueues.delete(key);
  }).catch(() => undefined);
  return next;
}

function parseSavedCreation(raw: string | null): SavedCreation {
  if (raw === null) return { ...EMPTY_SAVED };
  const value = JSON.parse(raw) as Partial<SavedCreation> | null;
  if (!value || value.version !== 1 || typeof value.title !== "string"
    || (value.courseId !== null && (typeof value.courseId !== "string" || !UUID.test(value.courseId)))
    || !Array.isArray(value.inviteeIds)
    || value.inviteeIds.some(id => typeof id !== "string" || !UUID.test(id))) {
    throw new Error("Invalid saved group creation");
  }
  const inviteeIds = value.inviteeIds.map(id => id.toLowerCase());
  if (new Set(inviteeIds).size !== inviteeIds.length) throw new Error("Invalid saved group creation");

  let pending: FrozenSubmission | null = null;
  if (value.pending !== null && value.pending !== undefined) {
    const candidate = value.pending;
    if (typeof candidate !== "object" || !UUID.test(candidate.clientCreationId)
      || !UUID.test(candidate.courseId) || typeof candidate.title !== "string"
      || !Array.isArray(candidate.inviteeIds)
      || candidate.inviteeIds.some(id => typeof id !== "string" || !UUID.test(id))) {
      throw new Error("Invalid saved group creation");
    }
    pending = {
      clientCreationId: candidate.clientCreationId.toLowerCase(),
      courseId: candidate.courseId.toLowerCase(),
      title: candidate.title,
      inviteeIds: candidate.inviteeIds.map(id => id.toLowerCase()),
    };
    if (new Set(pending.inviteeIds).size !== pending.inviteeIds.length) {
      throw new Error("Invalid saved group creation");
    }
  }

  // A pending request is immutable. Its exact fingerprint wins over an older
  // draft so a lost response can always be retried safely after reopening.
  return pending ? {
    version: 1,
    title: pending.title,
    courseId: pending.courseId,
    inviteeIds: pending.inviteeIds,
    pending,
  } : {
    version: 1,
    title: value.title,
    courseId: value.courseId?.toLowerCase() ?? null,
    inviteeIds,
    pending: null,
  };
}

function creationError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Unable to confirm the group. Check your connection and retry with the same saved details.";
}

export default function CreateGroupRoute() {
  const { user } = useAuth();
  if (!user) return null;
  return <CreateGroupScreen key={user.id} userId={user.id.toLowerCase()} />;
}

function CreateGroupScreen({ userId }: { userId: string }) {
  const router = useRouter();
  const { courseId } = useLocalSearchParams<{ courseId?: string | string[] }>();
  const requestedCourseId = typeof courseId === "string" && UUID.test(courseId)
    ? courseId.toLowerCase()
    : null;
  const storageKey = useMemo(
    () => `campusclutch:group-creation:v1:${encodeURIComponent(env.supabaseUrl)}:${userId}`,
    [userId],
  );

  const [courses, setCourses] = useState<MyCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState("");
  const [classmates, setClassmates] = useState<CourseClassmate[]>([]);
  const [classmatesLoading, setClassmatesLoading] = useState(false);
  const [classmatesError, setClassmatesError] = useState("");
  const [title, setTitle] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingVersion, setPendingVersion] = useState(0);
  const [active, setActive] = useState(false);

  const mounted = useRef(true);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const activeRef = useRef(false);
  const coursesEpoch = useRef(0);
  const classmatesEpoch = useRef(0);
  const submitEpoch = useRef(0);
  const submitBusy = useRef(false);
  const pendingRef = useRef<FrozenSubmission | null>(null);
  const confirmedRef = useRef(false);

  useEffect(() => () => { mounted.current = false; }, []);

  const savedValue = useCallback((pending = pendingRef.current): SavedCreation => ({
    version: 1,
    title: pending?.title ?? title,
    courseId: pending?.courseId ?? selectedCourseId,
    inviteeIds: [...(pending?.inviteeIds ?? selectedInviteeIds)],
    pending,
  }), [selectedCourseId, selectedInviteeIds, title]);

  const writeSaved = useCallback((value: SavedCreation) => inStorageOrder(storageKey, async () => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(value));
  }), [storageKey]);

  useEffect(() => {
    let cancelled = false;
    void inStorageOrder(storageKey, async () => parseSavedCreation(await AsyncStorage.getItem(storageKey)))
      .then(saved => {
        if (cancelled || !mounted.current) return;
        const initialCourse = saved.courseId ?? requestedCourseId;
        pendingRef.current = saved.pending;
        setTitle(saved.title);
        setSelectedCourseId(initialCourse);
        setSelectedInviteeIds(saved.inviteeIds);
        setPendingVersion(value => value + 1);
        setStorageError("");
        setRestored(true);
      })
      .catch(() => {
        if (cancelled || !mounted.current) return;
        setStorageError("Unable to restore the saved group form on this device. You can continue, but creation stays disabled until saving succeeds.");
        setSelectedCourseId(requestedCourseId);
        setRestored(true);
      });
    return () => { cancelled = true; };
  }, [requestedCourseId, storageKey]);

  useEffect(() => {
    if (!restored || confirmedRef.current) return;
    const value = savedValue();
    void writeSaved(value).then(() => {
      if (mounted.current) setStorageError("");
    }).catch(() => {
      if (mounted.current) setStorageError("Unable to save this group form on your device. Retry storage before creating the group.");
    });
  }, [pendingVersion, restored, savedValue, writeSaved]);

  const setLifecycleActive = useCallback((value: boolean) => {
    activeRef.current = value;
    setActive(value);
    if (!value) {
      coursesEpoch.current += 1;
      classmatesEpoch.current += 1;
      submitEpoch.current += 1;
      setCoursesLoading(false);
      setClassmatesLoading(false);
    }
  }, []);

  const loadCourses = useCallback(async () => {
    if (!activeRef.current) return;
    const ticket = ++coursesEpoch.current;
    setCoursesLoading(true);
    setCoursesError("");
    try {
      const rows = (await getMyCourses()).filter(isCurrentCourse);
      if (!activeRef.current || ticket !== coursesEpoch.current) return;
      setCourses(rows);
      setSelectedCourseId(current => {
        if (pendingRef.current) return current;
        if (current && rows.some(row => row.id.toLowerCase() === current)) return current;
        const requested = requestedCourseId && rows.some(row => row.id.toLowerCase() === requestedCourseId)
          ? requestedCourseId
          : null;
        const next = requested ?? (rows.length === 1 ? rows[0].id.toLowerCase() : null);
        if (current !== next) setSelectedInviteeIds([]);
        return next;
      });
    } catch {
      if (activeRef.current && ticket === coursesEpoch.current) {
        setCoursesError("Unable to load your current courses. Check your connection and retry.");
      }
    } finally {
      if (activeRef.current && ticket === coursesEpoch.current) setCoursesLoading(false);
    }
  }, [requestedCourseId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    foreground.current = AppState.currentState === "active";
    setLifecycleActive(foreground.current);
    if (foreground.current && restored) void loadCourses();
    return () => {
      focused.current = false;
      setLifecycleActive(false);
    };
  }, [loadCourses, restored, setLifecycleActive]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => {
      foreground.current = next === "active";
      const nextActive = focused.current && foreground.current;
      setLifecycleActive(nextActive);
      if (nextActive && restored) void loadCourses();
    });
    return () => subscription.remove();
  }, [loadCourses, restored, setLifecycleActive]);

  useEffect(() => {
    if (!active || !restored || !selectedCourseId) {
      if (!selectedCourseId) setClassmates([]);
      return;
    }
    const ticket = ++classmatesEpoch.current;
    setClassmatesLoading(true);
    setClassmatesError("");
    void getCourseClassmates(selectedCourseId).then(rows => {
      if (!activeRef.current || ticket !== classmatesEpoch.current) return;
      setClassmates(rows.filter(row => row.profileId.toLowerCase() !== userId));
    }).catch(() => {
      if (activeRef.current && ticket === classmatesEpoch.current) {
        setClassmatesError("Unable to load classmates for this course. Check your connection and retry.");
      }
    }).finally(() => {
      if (activeRef.current && ticket === classmatesEpoch.current) setClassmatesLoading(false);
    });
  }, [active, restored, selectedCourseId, userId]);

  const invalidatePending = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = null;
    setPendingVersion(value => value + 1);
    setSubmitError("");
  }, []);

  const chooseCourse = (id: string) => {
    if (submitting || pendingRef.current) return;
    const normalized = id.toLowerCase();
    if (selectedCourseId === normalized) return;
    setSelectedCourseId(normalized);
    setSelectedInviteeIds([]);
    setSubmitError("");
  };

  const changeTitle = (value: string) => {
    if (submitting || pendingRef.current) return;
    setTitle(value);
    setSubmitError("");
  };

  const toggleClassmate = (profileId: string) => {
    if (submitting || pendingRef.current) return;
    const id = profileId.toLowerCase();
    setSelectedInviteeIds(current => {
      if (current.includes(id)) return current.filter(value => value !== id);
      if (current.length >= 19) {
        setSubmitError("A group can start with no more than 19 invited classmates.");
        return current;
      }
      setSubmitError("");
      return [...current, id];
    });
  };

  const retryStorage = async () => {
    try {
      await writeSaved(savedValue());
      if (mounted.current) setStorageError("");
    } catch {
      if (mounted.current) setStorageError("Unable to save this group form on your device. Check available storage and retry.");
    }
  };

  const unlockPending = () => Alert.alert(
    "Change this saved request?",
    "The group may already have been created. Retrying is safest. Changing details starts a new request identity and could create a second group.",
    [
      { text: "Keep saved request", style: "cancel" },
      { text: "Change details", style: "destructive", onPress: invalidatePending },
    ],
  );

  const submit = async () => {
    if (!activeRef.current || !restored || submitBusy.current || storageError) return;
    const existing = pendingRef.current;
    let operation = existing;
    if (!operation) {
      if (!selectedCourseId || !courses.some(course => course.id.toLowerCase() === selectedCourseId)) {
        setSubmitError("Choose one of your current courses.");
        return;
      }
      const validation = validateGroupCreation(title, selectedInviteeIds, userId);
      if (!validation.isValid) {
        setSubmitError(validation.titleError ?? validation.inviteesError ?? "Check the group details.");
        return;
      }
      const available = new Set(classmates.map(item => item.profileId.toLowerCase()));
      if (validation.normalizedInviteeIds.some(id => !available.has(id))) {
        setSubmitError("Refresh the classmate list and choose currently available classmates.");
        return;
      }
      operation = {
        clientCreationId: globalThis.crypto.randomUUID().toLowerCase(),
        courseId: selectedCourseId,
        title: validation.normalizedTitle,
        inviteeIds: validation.normalizedInviteeIds,
      };
      pendingRef.current = operation;
      setTitle(operation.title);
      setSelectedInviteeIds(operation.inviteeIds);
      setPendingVersion(value => value + 1);
    }

    submitBusy.current = true;
    const ticket = ++submitEpoch.current;
    setSubmitting(true);
    setSubmitError("");
    try {
      // Persist the exact UUID and fingerprint before the network can commit.
      await writeSaved({
        version: 1,
        title: operation.title,
        courseId: operation.courseId,
        inviteeIds: operation.inviteeIds,
        pending: operation,
      });
      if (!activeRef.current || ticket !== submitEpoch.current) return;
      setStorageError("");
      const conversationId = await createGroupConversation(userId, operation);
      if (!activeRef.current || ticket !== submitEpoch.current) return;
      confirmedRef.current = true;
      pendingRef.current = null;
      setPendingVersion(value => value + 1);
      try { await writeSaved({ ...EMPTY_SAVED }); } catch { /* An exact retry remains harmless. */ }
      if (!activeRef.current || ticket !== submitEpoch.current) return;
      router.replace({ pathname: "/messages/[id]", params: { id: conversationId } });
    } catch (error) {
      if (activeRef.current && ticket === submitEpoch.current) setSubmitError(creationError(error));
    } finally {
      submitBusy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const pending = pendingRef.current;
  const validation = validateGroupCreation(title, selectedInviteeIds, userId);
  const titleLength = Array.from(title).length;
  const selectedCourse = courses.find(course => course.id.toLowerCase() === selectedCourseId);
  const canSubmit = active && restored && !storageError && !submitting
    && (pending !== null || (!!selectedCourse && validation.isValid && !classmatesLoading));

  return <View style={styles.screen}>
    <ScreenHeader>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to messages" hitSlop={10}
        style={styles.headerBack} onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/messages")}>
        <Ionicons name="arrow-back" size={24} color={COLORS.white} />
      </Pressable>
      <Text style={styles.headerTitle}>New Group</Text>
      <View style={styles.headerSpacer} />
    </ScreenHeader>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Create a private conversation for classmates in one of your current courses.</Text>

        {!!storageError && <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => { void retryStorage(); }}>
            <Text style={styles.secondaryText}>Retry storage</Text>
          </Pressable>
        </View>}

        {pending && <View style={styles.savedNotice}>
          <Text style={styles.sectionTitle}>Saved creation attempt</Text>
          <Text style={styles.muted}>Retry uses the same protected request ID and unchanged details, so a lost response cannot create a duplicate.</Text>
          <Pressable accessibilityRole="button" disabled={submitting} onPress={unlockPending}>
            <Text style={styles.link}>Change details instead</Text>
          </Pressable>
        </View>}

        <Text style={styles.label}>Group title</Text>
        <View style={[styles.inputWrap, titleLength > 80 && styles.invalidField]}>
          <TextInput accessibilityLabel="Group title" value={title} onChangeText={changeTitle}
            editable={restored && !submitting && !pending} placeholder="Example: CMPT 125 study group"
            placeholderTextColor={COLORS.muted} style={styles.input} returnKeyType="done" />
          <Text style={[styles.counter, titleLength > 80 && styles.error]}>{titleLength} / 80</Text>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Course</Text>
          {coursesLoading && <ActivityIndicator color={COLORS.primary} />}
        </View>
        {!!coursesError && <View style={styles.inlineError}>
          <Text accessibilityRole="alert" style={styles.error}>{coursesError}</Text>
          <Pressable accessibilityRole="button" disabled={coursesLoading} onPress={() => { void loadCourses(); }}>
            <Text style={styles.link}>Retry courses</Text>
          </Pressable>
        </View>}
        {!coursesLoading && !coursesError && courses.length === 0 && <View style={styles.notice}>
          <Text style={styles.muted}>Join a current course before creating a group.</Text>
          <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => router.push("/(tabs)/courses")}>
            <Text style={styles.secondaryText}>View courses</Text>
          </Pressable>
        </View>}
        <View style={styles.choiceList}>
          {courses.map(course => {
            const selected = course.id.toLowerCase() === selectedCourseId;
            return <Pressable key={course.id} accessibilityRole="button"
              accessibilityLabel={`${course.code}, ${course.title}`}
              accessibilityState={{ selected, disabled: !!pending || submitting }}
              disabled={!!pending || submitting} onPress={() => chooseCourse(course.id)}
              style={[styles.choice, selected && styles.choiceSelected]}>
              <View style={styles.choiceBody}>
                <Text style={[styles.choiceTitle, selected && styles.choiceTitleSelected]}>{course.code}</Text>
                <Text style={[styles.choiceSubtitle, selected && styles.choiceSubtitleSelected]} numberOfLines={2}>{course.title}</Text>
              </View>
              <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={22}
                color={selected ? COLORS.white : COLORS.primary} />
            </Pressable>;
          })}
        </View>

        {!!selectedCourseId && <>
          <View style={styles.sectionHeading}>
            <View>
              <Text style={styles.sectionTitle}>Invite classmates</Text>
              <Text style={styles.muted}>{selectedInviteeIds.length} selected · 19 maximum</Text>
            </View>
            {classmatesLoading && <ActivityIndicator color={COLORS.primary} />}
          </View>
          {!!classmatesError && <View style={styles.inlineError}>
            <Text accessibilityRole="alert" style={styles.error}>{classmatesError}</Text>
            <Text style={styles.muted}>Choose the course again or return to this screen to retry.</Text>
          </View>}
          {!classmatesLoading && !classmatesError && classmates.length === 0 && !pending &&
            <Text style={styles.muted}>No discoverable classmates are currently available for this course.</Text>}
          <View style={styles.classmateList}>
            {classmates.map(classmate => {
              const id = classmate.profileId.toLowerCase();
              const selected = selectedInviteeIds.includes(id);
              return <Pressable key={classmate.profileId} accessibilityRole="checkbox"
                accessibilityLabel={`Invite ${classmate.displayName}`}
                accessibilityState={{ checked: selected, disabled: !!pending || submitting }}
                disabled={!!pending || submitting} onPress={() => toggleClassmate(id)}
                style={[styles.classmate, selected && styles.classmateSelected]}>
                <View style={[styles.avatar, selected && styles.avatarSelected]}>
                  <Text style={[styles.avatarText, selected && styles.avatarTextSelected]}>
                    {classmate.displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}
                  </Text>
                </View>
                <View style={styles.choiceBody}>
                  <Text style={styles.classmateName} numberOfLines={1}>{classmate.displayName}</Text>
                  <Text style={styles.muted} numberOfLines={1}>{classmate.major || "Classmate"}</Text>
                </View>
                <Ionicons name={selected ? "checkbox" : "square-outline"} size={23} color={COLORS.primary} />
              </Pressable>;
            })}
          </View>
        </>}

        {!!submitError && <Text accessibilityRole="alert" style={styles.submitError}>{submitError}</Text>}
        <Pressable accessibilityRole="button"
          accessibilityLabel={pending ? "Retry creating group" : "Create group"}
          accessibilityState={{ disabled: !canSubmit, busy: submitting }} disabled={!canSubmit}
          style={[styles.primaryButton, !canSubmit && styles.disabled]} onPress={() => { void submit(); }}>
          {submitting ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.primaryText}>{pending ? "Retry Creating Group" : "Create Group"}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.white },
  flex: { flex: 1 },
  headerBack: { minWidth: 44, minHeight: 44, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { color: COLORS.white, fontWeight: "900", fontSize: 20 },
  headerSpacer: { width: 44 },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  intro: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 4 },
  notice: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 14, gap: 10 },
  savedNotice: { backgroundColor: COLORS.pale, borderRadius: 14, padding: 14, gap: 6 },
  inlineError: { gap: 4 },
  error: { color: COLORS.primary, fontSize: 13, lineHeight: 19 },
  submitError: { color: COLORS.primary, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  muted: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  link: { color: COLORS.primary, fontWeight: "800", paddingVertical: 8 },
  label: { color: COLORS.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
  inputWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, backgroundColor: COLORS.field, paddingHorizontal: 14, paddingVertical: 8 },
  invalidField: { borderColor: COLORS.primary },
  input: { minHeight: 42, color: COLORS.text, fontSize: 16 },
  counter: { alignSelf: "flex-end", color: COLORS.muted, fontSize: 11 },
  sectionHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 8 },
  sectionTitle: { color: COLORS.text, fontSize: 17, fontWeight: "900" },
  choiceList: { gap: 8 },
  choice: { minHeight: 62, padding: 13, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  choiceSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  choiceBody: { flex: 1 },
  choiceTitle: { color: COLORS.text, fontSize: 15, fontWeight: "900" },
  choiceTitleSelected: { color: COLORS.white },
  choiceSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  choiceSubtitleSelected: { color: "rgba(255,255,255,0.85)" },
  classmateList: { gap: 8 },
  classmate: { minHeight: 64, padding: 11, borderWidth: 1, borderColor: COLORS.border, borderRadius: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  classmateSelected: { borderColor: COLORS.primary, backgroundColor: "#FFF8F8" },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.pale },
  avatarSelected: { backgroundColor: COLORS.primary },
  avatarText: { color: COLORS.primary, fontSize: 13, fontWeight: "900" },
  avatarTextSelected: { color: COLORS.white },
  classmateName: { color: COLORS.text, fontSize: 15, fontWeight: "800" },
  primaryButton: { minHeight: 52, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: COLORS.white, fontSize: 16, fontWeight: "900" },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: COLORS.primary, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.5 },
});
