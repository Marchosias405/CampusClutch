import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";

import { getProfileAvatarSignedUrl } from "@/lib/avatars";
import {
  getCourseClassmates,
  getMyCourses,
  isCurrentCourse,
} from "@/lib/courses";
import type {
  CourseClassmate,
  MyCourse,
} from "@/types";

type MatchFilter =
  | "MOST_SHARED"
  | "SAME_CAMPUS";

type DisplayClassmate = CourseClassmate & {
  avatarSignedUrl: string | null;
};

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  tagGray: "#F4F1F1",
  softPink: "#FBECEC",
  disabled: "#C8BFC1",
};

const filters: {
  id: MatchFilter;
  label: string;
}[] = [
  {
    id: "MOST_SHARED",
    label: "Most shared interests",
  },
  {
    id: "SAME_CAMPUS",
    label: "Same campus",
  },
];

function formatYear(year: number | null) {
  if (!year) {
    return "Year not added";
  }

  const suffix =
    year === 1
      ? "st"
      : year === 2
        ? "nd"
        : year === 3
          ? "rd"
          : "th";

  return `${year}${suffix} year`;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getConnectionNote(
  classmate: DisplayClassmate
) {
  const sharedCount =
    classmate.sharedInterestCount;

  if (
    sharedCount > 0 &&
    classmate.sameCampus
  ) {
    return `${sharedCount} shared ${
      sharedCount === 1 ? "interest" : "interests"
    }, same campus`;
  }

  if (sharedCount > 0) {
    return `${sharedCount} shared ${
      sharedCount === 1 ? "interest" : "interests"
    }`;
  }

  if (classmate.sameCampus) {
    return "Same campus";
  }

  return "Enrolled in this course with you";
}

export default function ClassmateMatchesScreen() {
  const router = useRouter();

  const params = useLocalSearchParams<{
    courseId?: string | string[];
  }>();

  const routeCourseId = Array.isArray(
    params.courseId
  )
    ? params.courseId[0] ?? ""
    : params.courseId ?? "";

  const [selectedFilter, setSelectedFilter] =
    useState<MatchFilter>("MOST_SHARED");

  const [course, setCourse] =
    useState<MyCourse | null>(null);

  const [classmates, setClassmates] = useState<
    DisplayClassmate[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState<string | null>(null);

  const loadClassmates = useCallback(
    async () => {
      if (!routeCourseId) {
        setCourse(null);
        setClassmates([]);
        setErrorMessage(
          "No course was selected."
        );
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const myCourses = await getMyCourses();

        const selectedCourse =
          myCourses.find(
            (item) =>
              item.id === routeCourseId
          ) ?? null;

        if (
          !selectedCourse ||
          !isCurrentCourse(selectedCourse)
        ) {
          setCourse(null);
          setClassmates([]);

          setErrorMessage(
            "This course is not available for current classmate discovery."
          );

          return;
        }

        setCourse(selectedCourse);

        const result =
          await getCourseClassmates(
            selectedCourse.id
          );

        const displayClassmates =
          await Promise.all(
            result.map(async (classmate) => {
              if (!classmate.avatarPath) {
                return {
                  ...classmate,
                  avatarSignedUrl: null,
                };
              }

              try {
                const signedUrl =
                  await getProfileAvatarSignedUrl(
                    classmate.avatarPath
                  );

                return {
                  ...classmate,
                  avatarSignedUrl: signedUrl,
                };
              } catch {
                return {
                  ...classmate,
                  avatarSignedUrl: null,
                };
              }
            })
          );

        setClassmates(displayClassmates);
      } catch (error) {
        console.error(
          "Failed to load classmates:",
          error
        );

        setClassmates([]);

        setErrorMessage(
          "We couldn't load classmates for this course. Please try again."
        );
      } finally {
        setIsLoading(false);
      }
    },
    [routeCourseId]
  );

  useEffect(() => {
    void loadClassmates();
  }, [loadClassmates]);

  const visibleClassmates = useMemo(() => {
    const source =
      selectedFilter === "SAME_CAMPUS"
        ? classmates.filter(
            (classmate) =>
              classmate.sameCampus
          )
        : classmates;

    return [...source].sort(
      (a, b) =>
        b.sharedInterestCount -
          a.sharedInterestCount ||
        a.displayName.localeCompare(
          b.displayName
        )
    );
  }, [classmates, selectedFilter]);

  const handleViewProfile = (
    profileId: string
  ) => {
    router.push({
      pathname: "/students/[id]",
      params: {
        id: profileId,
      },
    } as any);
  };

  const emptyMessage =
    selectedFilter === "SAME_CAMPUS"
      ? "No discoverable classmates from your campus are enrolled in this course yet."
      : "No discoverable classmates are enrolled in this course yet.";

  return (
    <View style={styles.safeArea}>
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
              Classmates
            </Text>
          </Pressable>

          <View />
        </ScreenHeader>

        {isLoading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator
              size="large"
              color={COLORS.primary}
            />

            <Text style={styles.stateText}>
              Loading classmates...
            </Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={56}
              color={COLORS.primary}
            />

            <Text style={styles.stateTitle}>
              Unable to load classmates
            </Text>

            <Text style={styles.stateText}>
              {errorMessage}
            </Text>

            <Pressable
              style={styles.retryButton}
              onPress={() =>
                void loadClassmates()
              }
            >
              <Text
                style={styles.retryButtonText}
              >
                Try Again
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={
              styles.scrollContent
            }
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.pageTitle}>
              {course?.code ?? "Course"}{" "}
              Classmates
            </Text>

            <Text style={styles.subtitle}>
              {course
                ? `Find discoverable students enrolled with you in ${course.title}.`
                : "Find discoverable students enrolled with you."}
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={
                false
              }
              contentContainerStyle={
                styles.filtersRow
              }
            >
              {filters.map((filter) => {
                const isActive =
                  selectedFilter === filter.id;

                return (
                  <Pressable
                    key={filter.id}
                    style={[
                      styles.filterPill,
                      isActive &&
                        styles.activeFilterPill,
                    ]}
                    onPress={() =>
                      setSelectedFilter(
                        filter.id
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.filterText,
                        isActive &&
                          styles.activeFilterText,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {visibleClassmates.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons
                  name="people-outline"
                  size={48}
                  color={COLORS.inactiveGray}
                />

                <Text style={styles.emptyTitle}>
                  No classmates found
                </Text>

                <Text style={styles.emptyText}>
                  {emptyMessage}
                </Text>
              </View>
            ) : (
              <View style={styles.studentsList}>
                {visibleClassmates.map(
                  (item) => {
                    const initials =
                      getInitials(
                        item.displayName
                      );

                    const year = formatYear(
                      item.yearOfStudy
                    );

                    const major =
                      item.major ??
                      "Major not added";

                    const campus =
                      item.campusDisplayName ??
                      "Campus not added";

                    const connectionNote =
                      getConnectionNote(item);

                    return (
                      <Pressable
                        key={item.profileId}
                        style={
                          styles.studentCard
                        }
                        onPress={() =>
                          handleViewProfile(
                            item.profileId
                          )
                        }
                      >
                        <View
                          style={
                            styles.cardTopRow
                          }
                        >
                          <View
                            style={
                              styles.avatarWrap
                            }
                          >
                            {item.avatarSignedUrl ? (
                              <Image
                                source={{
                                  uri: item.avatarSignedUrl,
                                }}
                                style={
                                  styles.avatar
                                }
                              />
                            ) : (
                              <View
                                style={
                                  styles.avatarFallback
                                }
                              >
                                <Text
                                  style={
                                    styles.avatarInitials
                                  }
                                >
                                  {initials ||
                                    "S"}
                                </Text>
                              </View>
                            )}
                          </View>

                          <View
                            style={
                              styles.studentInfo
                            }
                          >
                            <Text
                              style={
                                styles.studentName
                              }
                              numberOfLines={1}
                            >
                              {
                                item.displayName
                              }
                            </Text>

                            <Text
                              style={
                                styles.studentMeta
                              }
                              numberOfLines={1}
                            >
                              {major}, {year}
                            </Text>

                            <View
                              style={
                                styles.campusRow
                              }
                            >
                              <Ionicons
                                name="location-sharp"
                                size={13}
                                color="#6F6A6A"
                              />

                              <Text
                                style={
                                  styles.campusText
                                }
                                numberOfLines={1}
                              >
                                {campus}
                              </Text>
                            </View>
                          </View>

                          {item.sharedInterestCount >
                            0 && (
                            <View
                              style={
                                styles.matchBadge
                              }
                            >
                              <FontAwesome5
                                name="star"
                                size={10}
                                color={
                                  COLORS.primary
                                }
                                solid
                              />

                              <Text
                                style={
                                  styles.matchBadgeText
                                }
                              >
                                {
                                  item.sharedInterestCount
                                }{" "}
                                shared
                              </Text>
                            </View>
                          )}
                        </View>

                        {item.sharedInterests
                          .length > 0 ? (
                          <View
                            style={
                              styles.interestsRow
                            }
                          >
                            {item.sharedInterests.map(
                              (interest) => (
                                <View
                                  key={
                                    interest
                                  }
                                  style={
                                    styles.interestTag
                                  }
                                >
                                  <Text
                                    style={
                                      styles.interestText
                                    }
                                  >
                                    {
                                      interest
                                    }
                                  </Text>
                                </View>
                              )
                            )}
                          </View>
                        ) : (
                          <Text
                            style={
                              styles.noInterestsText
                            }
                          >
                            No shared interests
                            yet.
                          </Text>
                        )}

                        <View
                          style={styles.noteBox}
                        >
                          <FontAwesome5
                            name="graduation-cap"
                            size={12}
                            color={
                              COLORS.primary
                            }
                            solid
                          />

                          <Text
                            style={
                              styles.noteText
                            }
                            numberOfLines={1}
                          >
                            {connectionNote}
                          </Text>
                        </View>

                        <View
                          style={
                            styles.actionRow
                          }
                        >
                          <Pressable
                            style={
                              styles.actionButton
                            }
                            onPress={() =>
                              handleViewProfile(
                                item.profileId
                              )
                            }
                          >
                            <Text
                              style={
                                styles.viewProfileText
                              }
                            >
                              View Profile
                            </Text>
                          </Pressable>

                          <View
                            style={
                              styles.actionDivider
                            }
                          />

                          <View
                            style={
                              styles.actionButton
                            }
                          >
                            <Text
                              style={
                                styles.messageDisabledText
                              }
                            >
                              Messaging later
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  }
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
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
    paddingTop: 28,
    paddingBottom: 32,
  },

  pageTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.textDark,
    marginBottom: 6,
  },

  subtitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: COLORS.mutedText,
    marginBottom: 21,
  },

  filtersRow: {
    paddingBottom: 24,
  },

  filterPill: {
    height: 36,
    paddingHorizontal: 17,
    borderRadius: 18,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#E7CFCF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  activeFilterPill: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  filterText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7A7373",
  },

  activeFilterText: {
    color: COLORS.cardWhite,
  },

  studentsList: {
    gap: 17,
  },

  studentCard: {
    borderRadius: 13,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 1,
    borderColor: "#F1E6E6",
    overflow: "hidden",
    paddingTop: 18,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
  },

  avatarWrap: {
    width: 72,
    height: 72,
    marginRight: 15,
  },

  avatar: {
    width: 72,
    height: 72,
    borderRadius: 13,
    backgroundColor: COLORS.softPink,
  },

  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softPink,
  },

  avatarInitials: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.primary,
  },

  studentInfo: {
    flex: 1,
  },

  studentName: {
    fontSize: 21,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  studentMeta: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: "#6F6A6A",
  },

  campusRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
  },

  campusText: {
    marginLeft: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#6F6A6A",
  },

  matchBadge: {
    width: 70,
    minHeight: 45,
    borderRadius: 20,
    backgroundColor: "#FFDDE2",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },

  matchBadgeText: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    color: COLORS.primary,
    textAlign: "center",
  },

  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 18,
    marginTop: 15,
    gap: 8,
  },

  interestTag: {
    backgroundColor: COLORS.tagGray,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  interestText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#676060",
  },

  noInterestsText: {
    paddingHorizontal: 18,
    marginTop: 15,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  noteBox: {
    marginHorizontal: 18,
    marginTop: 13,
    borderRadius: 7,
    backgroundColor: COLORS.softPink,
    paddingHorizontal: 11,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },

  noteText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 12,
    fontWeight: "700",
    color: "#8A7474",
  },

  actionRow: {
    marginTop: 16,
    height: 55,
    borderTopWidth: 1,
    borderTopColor: "#F0EAEA",
    flexDirection: "row",
    alignItems: "center",
  },

  actionButton: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  actionDivider: {
    width: 1,
    height: "100%",
    backgroundColor: "#F0EAEA",
  },

  viewProfileText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#6E6262",
  },

  messageDisabledText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.disabled,
  },

  stateContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  stateTitle: {
    marginTop: 14,
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  stateText: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: COLORS.mutedText,
    textAlign: "center",
  },

  retryButton: {
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },

  retryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  emptyContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 48,
  },

  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  emptyText: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    color: COLORS.mutedText,
    textAlign: "center",
  },
});
