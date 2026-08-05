import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import ScreenHeader from "../../components/ScreenHeader";
import { mockStudents } from "../../constants/mockData";

import { useProfile } from "@/context/ProfileContext";
import { getProfileAvatarSignedUrl } from "@/lib/avatars";
import {
  getCampuses,
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
  mutedText: "#8C8585",
  border: "#EFE1E1",
  softPink: "#FBECEC",
  tagGray: "#F4F1F1",
  green: "#34A853",
  disabled: "#C8BFC1",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RealStudentProfile = {
  profile: Profile;
  campusName: string | null;
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
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { profile: currentProfile } = useProfile();

  const routeId = typeof id === "string" ? id : "";

  const legacyStudent = mockStudents.find(
    (item) => item.id === routeId
  );

  const isLegacyStudent = Boolean(legacyStudent);
  const isUuidRoute = UUID_PATTERN.test(routeId);

  const [realStudent, setRealStudent] =
    useState<RealStudentProfile | null>(null);

  const [isLoadingRealStudent, setIsLoadingRealStudent] =
    useState(false);

  const [realStudentError, setRealStudentError] =
    useState<string | null>(null);

  const loadRealStudent = useCallback(async () => {
    if (
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
        campuses,
        targetInterests,
        currentInterests,
        socialLinks,
        avatarSignedUrl,
      ] = await Promise.all([
        getCampuses(),
        getProfileInterests(targetProfile.id),
        currentProfile
          ? getProfileInterests(currentProfile.id)
          : Promise.resolve([]),
        getProfileSocialLinks(targetProfile.id),
        avatarPromise,
      ]);

      const campus =
        campuses.find(
          (item) => item.id === targetProfile.campusId
        ) ?? null;

      const currentInterestIds = new Set(
        currentInterests.map((interest) => interest.id)
      );

      const sharedInterests = targetInterests
        .filter((interest) =>
          currentInterestIds.has(interest.id)
        )
        .map((interest) => interest.displayName);

      setRealStudent({
        profile: targetProfile,
        campusName: campus?.displayName ?? null,
        sharedInterests,
        avatarSignedUrl,
        linkedinUrl:
          socialLinks.linkedin?.value ?? null,
        instagramUsername:
          socialLinks.instagram?.value ?? null,
      });
    } catch {
      setRealStudent(null);
      setRealStudentError(
        "Unable to load this student profile."
      );
    } finally {
      setIsLoadingRealStudent(false);
    }
  }, [
    routeId,
    isLegacyStudent,
    isUuidRoute,
    currentProfile,
  ]);

  useEffect(() => {
    void loadRealStudent();
  }, [loadRealStudent]);

  const handleLegacyMessage = () => {
    if (!legacyStudent) {
      return;
    }

    router.push({
      pathname: "/messages/[id]",
      params: {
        id: legacyStudent.id,
      },
    } as any);
  };

  const renderHeader = () => (
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
          Student Profile
        </Text>
      </Pressable>

      <View />
    </ScreenHeader>
  );

  if (isLoadingRealStudent) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <View style={styles.notFoundContent}>
          <ActivityIndicator
            size="large"
            color={COLORS.primary}
          />

          <Text style={styles.loadingText}>
            Loading student profile...
          </Text>
        </View>
      </View>
    );
  }

  if (realStudentError) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <View style={styles.notFoundContent}>
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
            style={styles.backToClassmatesButton}
            onPress={() => {
              void loadRealStudent();
            }}
          >
            <Text style={styles.backToClassmatesText}>
              Retry
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (
    !legacyStudent &&
    (!isUuidRoute || !realStudent)
  ) {
    return (
      <View style={styles.safeArea}>
        {renderHeader()}

        <View style={styles.notFoundContent}>
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
            style={styles.backToClassmatesButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backToClassmatesText}>
              Go Back
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isMock = Boolean(legacyStudent);

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

  const campus = legacyStudent
    ? legacyStudent.campus
    : realStudent?.campusName ?? "Campus not added";

  const avatarUri = legacyStudent
    ? legacyStudent.avatar
    : realStudent?.avatarSignedUrl ?? null;

  const sharedInterests = legacyStudent
    ? legacyStudent.sharedInterests
    : realStudent?.sharedInterests ?? [];

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

          <View style={styles.campusRow}>
            <Ionicons
              name="location-sharp"
              size={17}
              color={COLORS.primary}
            />

            <Text style={styles.campusText}>
              {campus}
            </Text>
          </View>

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

          <Pressable
            style={[
              styles.messageButton,
              !isMock && styles.messageButtonDisabled,
            ]}
            onPress={handleLegacyMessage}
            disabled={!isMock}
          >
            <Ionicons
              name="chatbubble-ellipses"
              size={18}
              color="#FFFFFF"
            />

            <Text style={styles.messageButtonText}>
              {isMock
                ? "Message"
                : "Messaging coming later"}
            </Text>
          </Pressable>
        </View>

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

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons
                name="location"
                size={18}
                color={COLORS.primary}
              />
            </View>

            <View style={styles.detailContent}>
              <Text style={styles.detailLabel}>
                Campus
              </Text>

              <Text style={styles.detailValue}>
                {campus}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Shared Interests
          </Text>

          {sharedInterests.length > 0 ? (
            <View style={styles.interestsRow}>
              {sharedInterests.map((interest) => (
                <View
                  key={interest}
                  style={styles.interestTag}
                >
                  <Text style={styles.interestText}>
                    {interest}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptySectionText}>
              No shared interests yet.
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
                    numberOfLines={1}
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
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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

  campusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 5,
  },

  campusText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
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
    width: "100%",
    height: 48,
    marginTop: 22,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  messageButtonDisabled: {
    backgroundColor: COLORS.disabled,
  },

  messageButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },

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
    flex: 1,
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