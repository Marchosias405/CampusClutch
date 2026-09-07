import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScreenHeader from "../../components/ScreenHeader";

import {
  getAcademicTerms,
  getAvailableCourses,
  getMyCourses,
  isCurrentCourse,
  joinCourse,
} from "@/lib/courses";
import type {
  AcademicTerm,
  CourseCatalogItem,
  MyCourse,
} from "@/types";

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

export default function AddCourseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState("");

  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [courses, setCourses] = useState<
    CourseCatalogItem[]
  >([]);
  const [myCourses, setMyCourses] = useState<
    MyCourse[]
  >([]);

  const [selectedCourseId, setSelectedCourseId] =
    useState<string | null>(null);
  const [selectedTermId, setSelectedTermId] =
    useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [loadError, setLoadError] = useState<
    string | null
  >(null);
  const [submitMessage, setSubmitMessage] = useState<
    string | null
  >(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [
        termResult,
        courseResult,
        membershipResult,
      ] = await Promise.all([
        getAcademicTerms(),
        getAvailableCourses(),
        getMyCourses(),
      ]);

      setTerms(termResult);
      setCourses(courseResult);
      setMyCourses(membershipResult);

      const defaultTerm =
        termResult.find(
          (term) => term.status === "current"
        ) ??
        termResult.find(
          (term) => term.status === "upcoming"
        ) ??
        termResult[0] ??
        null;

      setSelectedTermId((currentId) => {
        if (
          currentId &&
          termResult.some(
            (term) => term.id === currentId
          )
        ) {
          return currentId;
        }

        return defaultTerm?.id ?? null;
      });
    } catch (error) {
      console.error(
        "Failed to load available courses:",
        error
      );

      setLoadError(
        "We couldn't load the course catalog. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedTerm =
    terms.find(
      (term) => term.id === selectedTermId
    ) ?? null;

  const results = useMemo(() => {
    if (!selectedTermId) {
      return [];
    }

    const q = query.trim().toLowerCase();

    return courses.filter((course) => {
      if (course.term.id !== selectedTermId) {
        return false;
      }

      if (!q) {
        return true;
      }

      return (
        course.code.toLowerCase().includes(q) ||
        course.title.toLowerCase().includes(q)
      );
    });
  }, [courses, query, selectedTermId]);

  const selectedCourse =
    courses.find(
      (course) => course.id === selectedCourseId
    ) ?? null;

  const existingMembership =
    myCourses.find(
      (course) => course.id === selectedCourseId
    ) ?? null;

  const canFindClassmates =
    existingMembership !== null &&
    isCurrentCourse(existingMembership);

  const handleSelectTerm = (termId: string) => {
    setSelectedTermId(termId);
    setSelectedCourseId(null);
    setSubmitMessage(null);
  };

  const handleSelectCourse = (
    courseId: string
  ) => {
    setSelectedCourseId(courseId);
    setSubmitMessage(null);
  };

  const handleAddCourse = async () => {
    if (
      !selectedCourse ||
      isSubmitting ||
      existingMembership
    ) {
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    try {
      const result = await joinCourse(
        selectedCourse.id
      );

      if (result === "already_enrolled") {
        setSubmitMessage(
          "This course is already in your CampusClutch courses."
        );

        await loadData();
        return;
      }

      router.back();
    } catch (error) {
      console.error("Failed to add course:", error);

      setSubmitMessage(
        "We couldn't add this course. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFindClassmates = () => {
    if (!existingMembership) {
      return;
    }

    router.push({
      pathname: "/courses/classmates",
      params: {
        courseId: existingMembership.id,
      },
    } as any);
  };

  const emptyResultMessage = query.trim()
    ? `No courses match "${query.trim()}".`
    : selectedTerm
      ? `No active courses are available for ${selectedTerm.displayName}.`
      : "No courses are available.";

  return (
    <View style={styles.screen}>
      <ScreenHeader>
        <Pressable
          style={styles.backRow}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons
            name="arrow-back"
            size={24}
            color="#FFFFFF"
          />
          <Text style={styles.headerTitle}>
            Add a Course
          </Text>
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
          <Ionicons
            name="search"
            size={19}
            color={COLORS.inactiveGray}
          />

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
            <Pressable
              hitSlop={10}
              onPress={() => setQuery("")}
            >
              <Ionicons
                name="close-circle"
                size={19}
                color={COLORS.inactiveGray}
              />
            </Pressable>
          )}
        </View>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator
              size="small"
              color={COLORS.primary}
            />
            <Text style={styles.stateText}>
              Loading course catalog...
            </Text>
          </View>
        ) : loadError ? (
          <View style={styles.stateContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={28}
              color={COLORS.primary}
            />

            <Text style={styles.stateText}>
              {loadError}
            </Text>

            <Pressable
              style={styles.retryButton}
              onPress={() => void loadData()}
            >
              <Text style={styles.retryButtonText}>
                Try Again
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.smallLabel}>
              ACADEMIC TERM
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
              keyboardShouldPersistTaps="handled"
            >
              {terms.map((term) => {
                const isActive =
                  selectedTermId === term.id;

                return (
                  <Pressable
                    key={term.id}
                    style={[
                      styles.optionPill,
                      isActive &&
                        styles.activeOptionPill,
                    ]}
                    onPress={() =>
                      handleSelectTerm(term.id)
                    }
                  >
                    <Text
                      style={[
                        styles.optionText,
                        isActive &&
                          styles.activeOptionText,
                      ]}
                    >
                      {term.displayName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.smallLabel}>
              RESULTS
            </Text>

            {results.length === 0 ? (
              <Text style={styles.emptyText}>
                {emptyResultMessage}
              </Text>
            ) : (
              <View style={styles.resultList}>
                {results.map((course) => {
                  const isSelected =
                    selectedCourseId === course.id;

                  const isAlreadyAdded =
                    myCourses.some(
                      (membership) =>
                        membership.id === course.id
                    );

                  return (
                    <Pressable
                      key={course.id}
                      style={[
                        styles.resultRow,
                        isSelected &&
                          styles.selectedResultRow,
                      ]}
                      onPress={() =>
                        handleSelectCourse(course.id)
                      }
                    >
                      <View style={styles.resultInfo}>
                        <Text
                          style={styles.resultCode}
                        >
                          {course.code}
                        </Text>

                        <Text
                          style={styles.resultTitle}
                          numberOfLines={1}
                        >
                          {course.title}
                        </Text>

                        {isAlreadyAdded && (
                          <Text
                            style={
                              styles.membershipLabel
                            }
                          >
                            Already added
                          </Text>
                        )}
                      </View>

                      <View
                        style={[
                          styles.radio,
                          isSelected &&
                            styles.radioSelected,
                        ]}
                      >
                        {isSelected && (
                          <Ionicons
                            name="checkmark"
                            size={15}
                            color="#FFFFFF"
                          />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {selectedCourse && (
              <View style={styles.confirmBox}>
                <Ionicons
                  name={
                    existingMembership
                      ? "information-circle"
                      : "checkmark-circle"
                  }
                  size={20}
                  color={COLORS.primary}
                />

                <View
                  style={styles.confirmTextBlock}
                >
                  <Text style={styles.confirmTitle}>
                    {selectedCourse.code} ·{" "}
                    {selectedCourse.term.displayName}
                  </Text>

                  <Text
                    style={styles.confirmSubtitle}
                  >
                    {existingMembership
                      ? "This course is already in your CampusClutch courses."
                      : "This adds a CampusClutch course membership. It does not change your university registration."}
                  </Text>
                </View>
              </View>
            )}

            {submitMessage && (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>
                  {submitMessage}
                </Text>
              </View>
            )}

            {canFindClassmates && (
              <Pressable
                style={styles.findLink}
                onPress={handleFindClassmates}
              >
                <FontAwesome5
                  name="user-friends"
                  size={13}
                  color={COLORS.primary}
                />
                <Text style={styles.findLinkText}>
                  Find classmates in this course
                </Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 14,
          },
        ]}
      >
        <Pressable
          style={[
            styles.addCourseButton,
            (!selectedCourse ||
              existingMembership !== null ||
              isSubmitting ||
              isLoading ||
              loadError !== null) &&
              styles.disabledButton,
          ]}
          onPress={() => void handleAddCourse()}
          disabled={
            !selectedCourse ||
            existingMembership !== null ||
            isSubmitting ||
            isLoading ||
            loadError !== null
          }
        >
          {isSubmitting ? (
            <ActivityIndicator
              size="small"
              color="#FFFFFF"
            />
          ) : (
            <Text
              style={styles.addCourseButtonText}
            >
              {!selectedCourse
                ? "Select a course"
                : existingMembership
                  ? "Already added"
                  : `Add ${selectedCourse.code}`}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
