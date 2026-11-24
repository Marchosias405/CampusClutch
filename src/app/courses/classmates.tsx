import { LoadingSkeleton, LoadingNotice } from '@/components/LoadingState';
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { startDirectConversation } from "@/lib/messages";
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


type DisplayClassmate = CourseClassmate & {
  avatarSignedUrl: string | null;
};

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#EFE1E1",
  inactiveGray: "#A5AAB3",
  tagGray: "#F4F1F1",
  softPink: "#FBECEC",
  disabled: "#C8BFC1",
};


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

  if (sharedCount > 0) {
    return `${sharedCount} shared ${
      sharedCount === 1 ? "interest" : "interests"
    }`;
  }

  return "Enrolled in this course with you";
}

export default function ClassmateMatchesScreen() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    courseId?: string | string[];
  }>();

  const routeCourseId = Array.isArray(
    params.courseId
  )
    ? params.courseId[0] ?? ""
    : params.courseId ?? "";

  return <ClassmateMatchesContent key={`${user?.id}:${routeCourseId}`} viewerId={user?.id} routeCourseId={routeCourseId} />;
}

function ClassmateMatchesContent({ viewerId, routeCourseId }: { viewerId?: string; routeCourseId: string }) {
  const router = useRouter();
  const { profile } = useProfile();
  const canMessage = !!viewerId && profile?.id === viewerId && !!profile?.onboardingCompletedAt;
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const focusEpoch = useRef(0);
  const generation = useRef(0);
  const opening = useRef<object | null>(null);
  const [openingProfileId, setOpeningProfileId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<{ profileId: string; text: string } | null>(null);


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
      if (!focused.current || !foreground.current) return;
      const ticket = ++generation.current;
      const isCurrent = () => focused.current && foreground.current && ticket === generation.current;
      if (!routeCourseId || !viewerId) {
        setCourse(null);
        setClassmates([]);
        setErrorMessage(
          viewerId ? "No course was selected." : "Sign in to see your classmates."
        );
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const myCourses = await getMyCourses();
        if (!isCurrent()) return;

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
        if (!isCurrent()) return;

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

        if (isCurrent()) setClassmates(displayClassmates);
      } catch {
        if (!isCurrent()) return;

        setClassmates([]);

        setErrorMessage(
          "We couldn't load classmates for this course. Please try again."
        );
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    },
    [routeCourseId, viewerId]
  );

  useFocusEffect(useCallback(() => {
    focused.current = true;
    ++focusEpoch.current;
    setMessageError(null);
    void loadClassmates();
    return () => {
      focused.current = false; ++focusEpoch.current; ++generation.current;
      opening.current = null; setOpeningProfileId(null);
    };
  }, [loadClassmates]));

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      foreground.current = state === "active";
      if (!foreground.current) {
        ++focusEpoch.current; ++generation.current;
        opening.current = null; setOpeningProfileId(null);
      }
      else if (focused.current) void loadClassmates();
    });
    return () => subscription.remove();
  }, [loadClassmates]);

  const visibleClassmates = useMemo(() => {
    return [...classmates].sort(
      (a, b) =>
        b.sharedInterestCount -
          a.sharedInterestCount ||
        a.displayName.localeCompare(
          b.displayName
        )
    );
  }, [classmates]);

  const handleViewProfile = (
    profileId: string
  ) => {
    if (!focused.current || !foreground.current || isLoading || opening.current) return;
    router.push({
      pathname: "/students/[id]",
      params: {
        id: profileId,
      },
    } as any);
  };

  const handleMessage = async (profileId: string) => {
    if (!canMessage || !viewerId || profileId.toLowerCase() === viewerId.toLowerCase()
      || !classmates.some(item => item.profileId === profileId) || !course
      || !focused.current || !foreground.current || opening.current || isLoading) return;
    const operation = {};
    const epoch = focusEpoch.current;
    opening.current = operation;
    setOpeningProfileId(profileId);
    setMessageError(null);
    try {
      const conversationId = await startDirectConversation(viewerId, profileId);
      if (focused.current && foreground.current && focusEpoch.current === epoch) {
        router.push({ pathname: "/messages/[id]", params: { id: conversationId } });
      }
    } catch {
      if (focused.current && foreground.current && focusEpoch.current === epoch) {
        setMessageError({ profileId, text: "Unable to open this chat. Check your connection and try again." });
      }
    } finally {
      if (opening.current === operation) { opening.current = null; setOpeningProfileId(null); }
    }
  };

  const emptyMessage = "No discoverable classmates are enrolled in this course yet.";

  return (
    <View style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader>
          <Pressable
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="Back from classmates"
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

        {isLoading && visibleClassmates.length === 0 && !errorMessage ? (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <LoadingSkeleton variant="people" label="Loading classmates…" />
          </ScrollView>
        ) : errorMessage ? (
          <ScrollView contentContainerStyle={styles.stateContainer} accessibilityLiveRegion="polite">
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
              accessibilityRole="button"
              accessibilityLabel="Retry loading classmates"
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
          </ScrollView>
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

            <Text style={[styles.subtitle, { marginBottom: 16 }]}>Sorted by shared interests</Text>
            {isLoading && <LoadingNotice label="Refreshing classmates…" />}

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


                    const connectionNote =
                      getConnectionNote(item);

                    return (
                      <View
                        key={item.profileId}
                        style={
                          styles.studentCard
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
                            >
                              {
                                item.displayName
                              }
                            </Text>

                            <Text
                              style={
                                styles.studentMeta
                              }
                            >
                              {major}, {year}
                            </Text>


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
                            accessibilityRole="button"
                            accessibilityLabel={`View ${item.displayName}'s profile`}
                            style={
                              styles.actionButton
                            }
                            disabled={isLoading || !!openingProfileId}
                            accessibilityState={{ disabled: isLoading || !!openingProfileId }}
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

                          {item.profileId.toLowerCase() !== viewerId?.toLowerCase() && <>
                          <View
                            style={
                              styles.actionDivider
                            }
                          />

                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Message ${item.displayName}`}
                            disabled={isLoading || !canMessage || !!openingProfileId}
                            accessibilityState={{ disabled: isLoading || !canMessage || !!openingProfileId, busy: openingProfileId === item.profileId }}
                            onPress={() => { void handleMessage(item.profileId); }}
                            style={
                              styles.actionButton
                            }
                          >
                            <Text
                              style={[
                                styles.messageText,
                                (isLoading || !canMessage || !!openingProfileId) && styles.messageDisabledText,
                              ]}
                            >
                              {openingProfileId === item.profileId ? "Opening chat…"
                                : messageError?.profileId === item.profileId ? "Retry Message" : "Message"}
                            </Text>
                          </Pressable>
                          </>}
                        </View>
                        {messageError?.profileId === item.profileId && <Text accessibilityRole="alert" style={styles.messageError}>{messageError.text}</Text>}
                      </View>
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
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
    paddingHorizontal: 18,
  },

  avatarWrap: {
    width: 72,
    height: 72,
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
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 0,
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



  matchBadge: {
    minWidth: 70,
    maxWidth: "100%",
    paddingVertical: 8,
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
    maxWidth: "100%",
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
    color: COLORS.mutedText,
  },

  actionRow: {
    marginTop: 16,
    minHeight: 55,
    borderTopWidth: 1,
    borderTopColor: "#F0EAEA",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },

  actionButton: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 55,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  actionDivider: {
    display: "none",
    backgroundColor: "#F0EAEA",
  },

  viewProfileText: {
    textAlign: "center",
    fontSize: 15,
    fontWeight: "800",
    color: "#6E6262",
  },

  messageText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
    textAlign: "center",
  },

  messageDisabledText: {
    color: COLORS.disabled,
  },

  messageError: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    color: COLORS.primary,
    fontSize: 14,
    lineHeight: 20,
  },

  stateContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 28,
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
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
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
    textAlign: "center",
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
