import { LoadingSkeleton } from '@/components/LoadingState';
import { useDirectAdmin } from '../../lib/useDirectAdmin';
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";
import RatingSummary from "../../components/RatingSummary";
import BlockStudentControl from "../../components/BlockStudentControl";
import type { StudentBlockState } from "../../lib/studentBlocks";
import { mockStudents } from "../../constants/mockData";
import { actionButton, actionButtonText } from "../../constants/actionStyles";

import { useProfile } from "@/context/ProfileContext";
import { useAuth } from "@/context/AuthContext";
import { startDirectConversation } from "@/lib/messages";
import { getProfileAvatarSignedUrl } from "@/lib/avatars";
import {
  getProfileById,
  getProfileInterests,
  getProfileSocialLinks,
} from "@/lib/profiles";
import type { Profile } from "@/types";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  cardWhite: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#EFE1E1",
  softPink: "#FBECEC",
  tagGray: "#F4F1F1",
  green: "#34A853",
  disabled: "#C8BFC1",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RealStudentProfile = {
  profile: Profile;
  interests: string[];
  sharedInterests: string[];
  avatarSignedUrl: string | null;
  linkedinUrl: string | null;
  instagramUsername: string | null;
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

export default function StudentProfileScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const routeId = typeof id === "string" ? id : "";
  return <StudentProfileContent key={`${user?.id}:${routeId}`} routeId={routeId} viewerId={user?.id} />;
}

function StudentProfileContent({ routeId, viewerId }: { routeId: string; viewerId?: string }) {
  const router = useRouter();
  const { profile: currentProfile } = useProfile();
  const admin = useDirectAdmin(viewerId ?? '');
  const viewerProfile = currentProfile?.id === viewerId ? currentProfile : null;
  const viewerProfileId = viewerProfile?.id;
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const focusEpoch = useRef(0);
  const generation = useRef(0);
  const opening = useRef<object | null>(null);
  const [openingMessage, setOpeningMessage] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [blockState, setBlockState] = useState<StudentBlockState | null>(null);
  const latestBlockState = useRef<StudentBlockState | null>(null);
  const updateBlockState = useCallback((next: StudentBlockState | null) => {
    latestBlockState.current = next;
    setBlockState(next);
  }, []);

  const legacyStudent = mockStudents.find(
    (item) => item.id === routeId
  );

  const isLegacyStudent = Boolean(legacyStudent);
  const isUuidRoute = UUID_PATTERN.test(routeId);

  const [realStudent, setRealStudent] =
    useState<RealStudentProfile | null>(null);

  const [isLoadingRealStudent, setIsLoadingRealStudent] =
    useState(Boolean(viewerId && isUuidRoute && !isLegacyStudent));

  const [realStudentError, setRealStudentError] =
    useState<string | null>(null);

  const loadRealStudent = useCallback(async () => {
    if (!focused.current || !foreground.current) return;
    const ticket = ++generation.current;
    if (
      !viewerId ||
      !routeId ||
      isLegacyStudent ||
      !isUuidRoute
    ) {
      setRealStudent(null);
      setRealStudentError(null);
      setIsLoadingRealStudent(false);
      return;
    }

    setIsLoadingRealStudent(true);
    setRealStudentError(null);

    try {
      const targetProfile = await getProfileById(routeId);

      if (!focused.current || ticket !== generation.current) return;
      if (!targetProfile) {
        setRealStudent(null);
        return;
      }

      const avatarPromise = targetProfile.avatarPath
        ? getProfileAvatarSignedUrl(
            targetProfile.avatarPath
          ).catch(() => null)
        : Promise.resolve(null);

      const [
        targetInterests,
        currentInterests,
        socialLinks,
        avatarSignedUrl,
      ] = await Promise.all([
        getProfileInterests(targetProfile.id),
        viewerProfileId
          ? getProfileInterests(viewerProfileId)
          : Promise.resolve([]),
        getProfileSocialLinks(targetProfile.id),
        avatarPromise,
      ]);

      const currentInterestIds = new Set(
        currentInterests.map((interest) => interest.id)
      );

      const sharedInterests = targetInterests
        .filter((interest) =>
          currentInterestIds.has(interest.id)
        )
        .map((interest) => interest.displayName);

      if (!focused.current || ticket !== generation.current) return;
      setRealStudent({
        profile: targetProfile,
        interests: targetInterests.filter(interest => interest.isActive).map(interest => interest.displayName),
        sharedInterests,
        avatarSignedUrl,
        linkedinUrl:
          socialLinks.linkedin?.value ?? null,
        instagramUsername:
          socialLinks.instagram?.value ?? null,
      });
    } catch {
      if (focused.current && ticket === generation.current) {
        setRealStudent(null);
        setRealStudentError("Unable to load this student profile.");
      }
    } finally {
      if (focused.current && ticket === generation.current) setIsLoadingRealStudent(false);
    }
  }, [
    routeId,
    isLegacyStudent,
    isUuidRoute,
    viewerId,
    viewerProfileId,
  ]);

  const invalidatePendingWork = useCallback(() => {
    ++focusEpoch.current;
    ++generation.current;
    opening.current = null;
    setOpeningMessage(false);
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    ++focusEpoch.current;
    setMessageError("");
    void loadRealStudent();
    return () => {
      focused.current = false;
      invalidatePendingWork();
    };
  }, [invalidatePendingWork, loadRealStudent]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (!foreground.current) invalidatePendingWork();
      else if (focused.current) void loadRealStudent();
    });
    return () => subscription.remove();
  }, [invalidatePendingWork, loadRealStudent]);

  const handleMessage = async () => {
    const target = realStudent?.profile;
    if (!viewerId || !viewerProfile?.onboardingCompletedAt || !target?.onboardingCompletedAt
      || target.id === viewerId || target.id.toLowerCase() !== routeId.toLowerCase()
      || !latestBlockState.current || latestBlockState.current.interaction_blocked
      || legacyStudent || !focused.current || !foreground.current || opening.current || isLoadingRealStudent) return;
    const operation = {};
    const epoch = focusEpoch.current;
    opening.current = operation; setOpeningMessage(true); setMessageError("");
    try {
      const conversationId = await startDirectConversation(viewerId, target.id);
      if (focused.current && foreground.current && focusEpoch.current === epoch) {
        router.push({ pathname: "/messages/[id]", params: { id: conversationId } });
      }
    } catch {
      if (focused.current && foreground.current && focusEpoch.current === epoch) {
        setMessageError("Unable to open this chat. Check your connection and try again.");
      }
    } finally {
      if (opening.current === operation) { opening.current = null; setOpeningMessage(false); }
    }
  };

  const renderHeader = () => (
    <ScreenHeader>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back from Student Profile"
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
          Student Profile
        </Text>
      </Pressable>

      <View />
    </ScreenHeader>
  );

  const renderBlockControl = () => viewerId && isUuidRoute && !isLegacyStudent
    && routeId.toLowerCase() !== viewerId.toLowerCase() && !!viewerProfile?.onboardingCompletedAt ? (
      <BlockStudentControl userId={viewerId} profileId={routeId}
        displayName={realStudent?.profile.displayName ?? undefined}
        onState={updateBlockState} onChanged={() => { void loadRealStudent(); }} />
    ) : null;

  const renderReportControl = () => viewerId && isUuidRoute && !isLegacyStudent
    && routeId.toLowerCase() !== viewerId.toLowerCase() && !!viewerProfile?.onboardingCompletedAt ? (
      <Pressable accessibilityRole="button" accessibilityLabel="Report student" style={styles.reportButton}
        onPress={() => {
          if (!focused.current || !foreground.current) return;
          router.push({ pathname: "/safety/report", params: { targetType: "student", targetId: routeId } });
        }}><Text style={styles.reportButtonText}>Report student</Text></Pressable>
    ) : null;

  if (isLoadingRealStudent) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <LoadingSkeleton variant="profile" label="Loading student profile" />
          {renderBlockControl()}
        </ScrollView>
      </View>
    );
  }

  if (realStudentError) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <ScrollView contentContainerStyle={styles.notFoundContent}>
          <Ionicons
            name="alert-circle-outline"
            size={64}
            color={COLORS.primary}
          />

          <Text style={styles.notFoundTitle}>
            Unable to load profile
          </Text>

          <Text style={styles.notFoundText}>
            {realStudentError}
          </Text>

          <Pressable
            accessibilityRole="button"
            style={styles.backToClassmatesButton}
            onPress={() => {
              void loadRealStudent();
            }}
          >
            <Text style={styles.backToClassmatesText}>
              Retry
            </Text>
          </Pressable>
          {renderBlockControl()}
        </ScrollView>
      </View>
    );
  }

  if (
    !legacyStudent &&
    (!isUuidRoute || !realStudent || blockState?.interaction_blocked)
  ) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <ScrollView contentContainerStyle={styles.notFoundContent}>
          <Ionicons
            name="person-circle-outline"
            size={72}
            color={COLORS.mutedText}
          />

          <Text style={styles.notFoundTitle}>
            Student not found
          </Text>

          <Text style={styles.notFoundText}>
            This student profile is unavailable.
          </Text>

          <Pressable
            accessibilityRole="button"
            style={styles.backToClassmatesButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backToClassmatesText}>
              Go Back
            </Text>
          </Pressable>
          {renderBlockControl()}
          {renderReportControl()}
          {admin.allowed && viewerId && isUuidRoute && !isLegacyStudent && routeId !== viewerId && <Pressable accessibilityRole="button" style={styles.reportButton}
            onPress={() => { if (focused.current && foreground.current) admin.open('student', routeId); }}><Text style={styles.reportButtonText}>Admin actions</Text></Pressable>}
        </ScrollView>
      </View>
    );
  }

  const isMock = Boolean(legacyStudent);
  const isSelf = !!viewerId && routeId.toLowerCase() === viewerId.toLowerCase();
  const canMessage = !isMock && !isSelf && !!viewerProfile?.onboardingCompletedAt
    && !!realStudent?.profile.onboardingCompletedAt && !!blockState && !blockState.interaction_blocked;

  const name = legacyStudent
    ? legacyStudent.name
    : realStudent?.profile.displayName ?? "Student";

  const major = legacyStudent
    ? legacyStudent.major
    : realStudent?.profile.major ?? "Major not added";

  const year = legacyStudent
    ? legacyStudent.year
    : formatYear(
        realStudent?.profile.yearOfStudy ?? null
      );

  const avatarUri = legacyStudent
    ? legacyStudent.avatar
    : realStudent?.avatarSignedUrl ?? null;

  const sharedInterests = legacyStudent
    ? legacyStudent.sharedInterests
    : realStudent?.sharedInterests ?? [];

  const interests = legacyStudent ? legacyStudent.sharedInterests : realStudent?.interests ?? [];

  const matchLabel =
    legacyStudent?.matchLabel ?? null;

  const activityNote = legacyStudent
    ? legacyStudent.sharedCourseNote ||
      legacyStudent.activityNote
    : null;

  const isRecentlyActive =
    legacyStudent?.isRecentlyActive ?? false;

  const initials = getInitials(name);

  const linkedinUrl =
    realStudent?.linkedinUrl ?? null;

  const instagramUsername =
    realStudent?.instagramUsername ?? null;

  const hasSocialLinks =
    !isMock &&
    Boolean(linkedinUrl || instagramUsername);

  return (
    <View style={styles.safeArea}>
      {renderHeader()}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <View style={styles.avatarWrap}>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>
                  {initials || "S"}
                </Text>
              </View>
            )}

            {isRecentlyActive ? (
              <View style={styles.onlineDot} />
            ) : null}
          </View>

          <Text style={styles.studentName}>
            {name}
          </Text>

          <Text style={styles.studentMeta}>
            {major}, {year}
          </Text>


          {matchLabel ? (
            <View style={styles.matchBadge}>
              <Ionicons
                name="star"
                size={14}
                color={COLORS.primary}
              />

              <Text style={styles.matchBadgeText}>
                {matchLabel}
              </Text>
            </View>
          ) : null}

          {!isSelf && <Pressable
            accessibilityRole="button"
            style={[
              styles.messageButton,
              (!canMessage || openingMessage) && styles.messageButtonDisabled,
            ]}
            onPress={() => { void handleMessage(); }}
            accessibilityState={{ disabled: !canMessage || openingMessage, busy: openingMessage }}
            disabled={!canMessage || openingMessage}
          >
            <Ionicons
              name="chatbubble-ellipses"
              size={18}
              color="#FFFFFF"
            />

            <Text style={styles.messageButtonText}>
              {isMock ? "Demo profile (messaging unavailable)" : openingMessage ? "Opening chat…"
                : canMessage ? messageError ? "Retry Message" : "Message" : "Messaging unavailable"}
            </Text>
          </Pressable>}
          {!!messageError && <Text accessibilityRole="alert" style={styles.messageError}>{messageError}</Text>}
          {renderReportControl()}
          {admin.allowed && viewerId && isUuidRoute && !isLegacyStudent && routeId !== viewerId && <Pressable accessibilityRole="button" style={styles.reportButton}
            onPress={() => { if (focused.current && foreground.current) admin.open('student', routeId); }}><Text style={styles.reportButtonText}>Admin actions</Text></Pressable>}
          {renderBlockControl()}
        </View>

        {!isMock && realStudent && <RatingSummary key={realStudent.profile.id} profileId={realStudent.profile.id} />}

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Student Details
          </Text>

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons
                name="school"
                size={18}
                color={COLORS.primary}
              />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                Program
              </Text>

              <Text style={styles.detailValue}>
                {major}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons
                name="calendar"
                size={18}
                color={COLORS.primary}
              />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                Year
              </Text>

              <Text style={styles.detailValue}>
                {year}
              </Text>
            </View>
          </View>

        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Interests
          </Text>

          {interests.length > 0 ? (
            <View style={styles.interestsRow}>
              {interests.map((interest) => (
                <View
                  key={interest}
                  style={styles.interestTag}
                >
                  <Text style={styles.interestText}>
                    {interest}{sharedInterests.includes(interest) && !isSelf ? " (In common)" : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptySectionText}>
              No interests added yet.
            </Text>
          )}
        </View>

        {hasSocialLinks ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              Social Profiles
            </Text>

            {linkedinUrl ? (
              <Pressable
                accessibilityRole="link"
                style={styles.socialRow}
                onPress={() => {
                  void Linking.openURL(linkedinUrl);
                }}
              >
                <View style={styles.socialIcon}>
                  <Ionicons
                    name="logo-linkedin"
                    size={21}
                    color={COLORS.primary}
                  />
                </View>

                <View style={styles.socialContent}>
                  <Text style={styles.socialLabel}>
                    LinkedIn
                  </Text>

                  <Text
                    style={styles.socialValue}
                  >
                    {linkedinUrl}
                  </Text>
                </View>

                <Ionicons
                  name="open-outline"
                  size={18}
                  color={COLORS.mutedText}
                />
              </Pressable>
            ) : null}

            {linkedinUrl && instagramUsername ? (
              <View style={styles.divider} />
            ) : null}

            {instagramUsername ? (
              <Pressable
                accessibilityRole="link"
                style={styles.socialRow}
                onPress={() => {
                  void Linking.openURL(
                    `https://www.instagram.com/${instagramUsername}/`
                  );
                }}
              >
                <View style={styles.socialIcon}>
                  <Ionicons
                    name="logo-instagram"
                    size={21}
                    color={COLORS.primary}
                  />
                </View>

                <View style={styles.socialContent}>
                  <Text style={styles.socialLabel}>
                    Instagram
                  </Text>

                  <Text style={styles.socialValue}>
                    @{instagramUsername}
                  </Text>
                </View>

                <Ionicons
                  name="open-outline"
                  size={18}
                  color={COLORS.mutedText}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {activityNote ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              Connection
            </Text>

            <View style={styles.connectionBox}>
              <Ionicons
                name={
                  legacyStudent?.activityNote
                    ? "time"
                    : "school"
                }
                size={19}
                color={COLORS.primary}
              />

              <Text style={styles.connectionText}>
                {activityNote}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  reportButton: {
    ...actionButton,
    alignSelf: "stretch",
    marginTop: 12,
  },
  reportButtonText: actionButtonText,
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  backRow: {
    minHeight: 48,
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    padding: 20,
    paddingBottom: 40,
  },

  profileCard: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 26,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
  },

  avatarWrap: {
    width: 112,
    height: 112,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: COLORS.softPink,
  },

  avatarFallback: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softPink,
  },

  avatarInitials: {
    fontSize: 32,
    fontWeight: "900",
    color: COLORS.primary,
  },

  onlineDot: {
    position: "absolute",
    right: 4,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: COLORS.cardWhite,
    backgroundColor: COLORS.green,
  },

  studentName: {
    fontSize: 27,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  studentMeta: {
    marginTop: 5,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.mutedText,
    textAlign: "center",
  },



  matchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: COLORS.softPink,
  },

  matchBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.primary,
  },

  messageButton: {
    ...actionButton,
    width: "100%",
    marginTop: 22,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  messageButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },

  messageButtonText: {
    ...actionButtonText,
    flexShrink: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  messageError: { marginTop: 12, color: COLORS.primary, fontSize: 14, lineHeight: 21, textAlign: "center" },

  sectionCard: {
    marginTop: 18,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardWhite,
  },

  sectionTitle: {
    marginBottom: 16,
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.textDark,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  detailIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softPink,
  },

  detailContent: {
    flex: 1,
  },

  detailLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  detailValue: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  divider: {
    height: 1,
    marginVertical: 13,
    backgroundColor: COLORS.border,
  },

  interestsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  interestTag: {
    maxWidth: "100%",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.tagGray,
  },

  interestText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#676060",
  },

  emptySectionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  socialRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
  },

  socialIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.softPink,
  },

  socialContent: {
    flex: 1,
    marginRight: 10,
  },

  socialLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  socialValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
  },

  connectionBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.softPink,
  },

  connectionText: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: "#7C6666",
  },

  notFoundContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  notFoundTitle: {
    marginTop: 14,
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  notFoundText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    color: COLORS.mutedText,
  },

  backToClassmatesButton: {
    minHeight: 48,
    justifyContent: "center",
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },

  backToClassmatesText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
