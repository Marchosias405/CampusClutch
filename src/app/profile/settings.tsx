import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import ScreenHeader from "@/components/ScreenHeader";
import { useProfile } from "@/context/ProfileContext";
import {
  getCampuses,
  getInterests,
  getProfileInterests,
  getProfileSocialLinks,
  replaceProfileInterests,
  replaceProfileSocialLinks,
} from "@/lib/profiles";
import type { Campus, Interest } from "@/types";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  border: "#E8DDDF",
  inputBackground: "#FBF8F8",
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
  successBackground: "#F7ECEE",
  selectedBackground: "#F7E7EA",
};

const YEARS = [1, 2, 3, 4, 5, 6, 7, 8];

const LINKEDIN_PROFILE_URL_PATTERN =
  /^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/in\/[^\s]+$/i;

const INSTAGRAM_USERNAME_PATTERN = /^[A-Za-z0-9._]+$/;

function getErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unable to save your profile. Try again.";
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { profile, saveProfile } = useProfile();

  const [displayName, setDisplayName] = useState(
    profile?.displayName ?? ""
  );
  const [major, setMajor] = useState(profile?.major ?? "");
  const [yearOfStudy, setYearOfStudy] = useState<number | null>(
    profile?.yearOfStudy ?? null
  );
  const [campusId, setCampusId] = useState<string | null>(
    profile?.campusId ?? null
  );
  const [isDiscoverable, setIsDiscoverable] = useState(
    profile?.isDiscoverable ?? false
  );

  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [isLoadingCampuses, setIsLoadingCampuses] = useState(true);
  const [campusError, setCampusError] = useState<string | null>(null);

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [isLoadingInterests, setIsLoadingInterests] = useState(true);
  const [interestError, setInterestError] = useState<string | null>(null);

  const [linkedinValue, setLinkedinValue] = useState("");
  const [linkedinVisible, setLinkedinVisible] = useState(false);
  const [instagramValue, setInstagramValue] = useState("");
  const [instagramVisible, setInstagramVisible] = useState(false);
  const [isLoadingSocialLinks, setIsLoadingSocialLinks] = useState(true);
  const [socialLinksError, setSocialLinksError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadCampuses = async () => {
    setIsLoadingCampuses(true);
    setCampusError(null);

    try {
      const nextCampuses = await getCampuses();
      setCampuses(nextCampuses);
    } catch {
      setCampusError("Unable to load campuses.");
    } finally {
      setIsLoadingCampuses(false);
    }
  };

  const loadInterests = useCallback(async () => {
    if (!profile) {
      setInterests([]);
      setSelectedInterestIds([]);
      setInterestError("Profile unavailable.");
      setIsLoadingInterests(false);
      return;
    }

    setIsLoadingInterests(true);
    setInterestError(null);

    try {
      const [nextInterests, currentInterests] = await Promise.all([
        getInterests(),
        getProfileInterests(profile.id),
      ]);

      setInterests(nextInterests);
      setSelectedInterestIds(
        currentInterests.map((interest) => interest.id)
      );
    } catch {
      setInterestError("Unable to load interests.");
    } finally {
      setIsLoadingInterests(false);
    }
  }, [profile]);

  const loadSocialLinks = useCallback(async () => {
    if (!profile) {
      setLinkedinValue("");
      setLinkedinVisible(false);
      setInstagramValue("");
      setInstagramVisible(false);
      setSocialLinksError("Profile unavailable.");
      setIsLoadingSocialLinks(false);
      return;
    }

    setIsLoadingSocialLinks(true);
    setSocialLinksError(null);

    try {
      const socialLinks = await getProfileSocialLinks(profile.id);

      setLinkedinValue(socialLinks.linkedin?.value ?? "");
      setLinkedinVisible(socialLinks.linkedin?.isVisible ?? false);

      setInstagramValue(socialLinks.instagram?.value ?? "");
      setInstagramVisible(socialLinks.instagram?.isVisible ?? false);
    } catch {
      setSocialLinksError("Unable to load social profiles.");
    } finally {
      setIsLoadingSocialLinks(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadCampuses();
  }, []);

  useEffect(() => {
    void loadInterests();
  }, [loadInterests]);

  useEffect(() => {
    void loadSocialLinks();
  }, [loadSocialLinks]);

  const toggleInterest = (interestId: string) => {
    setSelectedInterestIds((current) => {
      if (current.includes(interestId)) {
        return current.filter((id) => id !== interestId);
      }

      return [...current, interestId];
    });

    setSuccessMessage(null);
  };

  const handleSave = async () => {
    const normalizedName = displayName.trim();
    const normalizedMajor = major.trim();
    const normalizedLinkedin = linkedinValue.trim();
    const normalizedInstagram = instagramValue.trim();

    if (!normalizedName) {
      setErrorMessage("Enter your display name.");
      setSuccessMessage(null);
      return;
    }

    if (normalizedName.length > 80) {
      setErrorMessage("Display name must be 80 characters or fewer.");
      setSuccessMessage(null);
      return;
    }

    if (normalizedMajor.length > 120) {
      setErrorMessage("Major must be 120 characters or fewer.");
      setSuccessMessage(null);
      return;
    }

    if (
      normalizedLinkedin &&
      !LINKEDIN_PROFILE_URL_PATTERN.test(normalizedLinkedin)
    ) {
      setErrorMessage(
        "Enter a valid LinkedIn profile URL, such as https://www.linkedin.com/in/username."
      );
      setSuccessMessage(null);
      return;
    }

    if (
      normalizedInstagram &&
      !INSTAGRAM_USERNAME_PATTERN.test(normalizedInstagram)
    ) {
      setErrorMessage(
        "Instagram usernames can contain only letters, numbers, periods, and underscores."
      );
      setSuccessMessage(null);
      return;
    }

    if (!profile) {
      setErrorMessage("Profile unavailable. Try again.");
      setSuccessMessage(null);
      return;
    }

    if (isLoadingInterests || isLoadingSocialLinks) {
      setErrorMessage("Wait for your profile details to finish loading.");
      setSuccessMessage(null);
      return;
    }

    if (interestError) {
      setErrorMessage("Retry loading interests before saving.");
      setSuccessMessage(null);
      return;
    }

    if (socialLinksError) {
      setErrorMessage("Retry loading social profiles before saving.");
      setSuccessMessage(null);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await replaceProfileInterests(profile.id, selectedInterestIds);

      await replaceProfileSocialLinks(profile.id, {
        linkedinValue: normalizedLinkedin,
        linkedinVisible:
          Boolean(normalizedLinkedin) && linkedinVisible,
        instagramValue: normalizedInstagram,
        instagramVisible:
          Boolean(normalizedInstagram) && instagramVisible,
      });

      await saveProfile({
        displayName: normalizedName,
        major: normalizedMajor || null,
        yearOfStudy,
        campusId,
        isDiscoverable,
      });

      setSuccessMessage("Profile updated.");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScreenHeader>
        <Pressable
          style={styles.backRow}
          hitSlop={10}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          <Text style={styles.headerTitle}>Edit Profile</Text>
        </Pressable>

        <View />
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.label}>Display name *</Text>

        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Alex Rivera"
          placeholderTextColor={COLORS.mutedText}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={80}
          editable={!isSubmitting}
        />

        <Text style={[styles.label, styles.spacedLabel]}>Major</Text>

        <TextInput
          style={styles.input}
          value={major}
          onChangeText={setMajor}
          placeholder="Computing Science"
          placeholderTextColor={COLORS.mutedText}
          autoCapitalize="words"
          maxLength={120}
          editable={!isSubmitting}
        />

        <Text style={[styles.label, styles.spacedLabel]}>
          Year of study
        </Text>

        <View style={styles.optionsWrap}>
          {YEARS.map((year) => {
            const isSelected = yearOfStudy === year;

            return (
              <Pressable
                key={year}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionButtonSelected,
                ]}
                onPress={() =>
                  setYearOfStudy((current) =>
                    current === year ? null : year
                  )
                }
                disabled={isSubmitting}
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}
                >
                  {year}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, styles.spacedLabel]}>Campus</Text>

        {isLoadingCampuses ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.inlineLoadingText}>
              Loading campuses...
            </Text>
          </View>
        ) : campusError ? (
          <View>
            <View style={styles.errorBox}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={COLORS.errorText}
              />
              <Text style={styles.errorText}>{campusError}</Text>
            </View>

            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void loadCampuses();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.campusList}>
            {campuses.map((campus) => {
              const isSelected = campusId === campus.id;

              return (
                <Pressable
                  key={campus.id}
                  style={[
                    styles.campusButton,
                    isSelected && styles.campusButtonSelected,
                  ]}
                  onPress={() =>
                    setCampusId((current) =>
                      current === campus.id ? null : campus.id
                    )
                  }
                  disabled={isSubmitting}
                >
                  <Ionicons
                    name="location-outline"
                    size={18}
                    color={
                      isSelected
                        ? COLORS.primary
                        : COLORS.mutedText
                    }
                  />

                  <Text
                    style={[
                      styles.campusText,
                      isSelected && styles.campusTextSelected,
                    ]}
                  >
                    {campus.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={[styles.label, styles.spacedLabel]}>Interests</Text>

        <Text style={styles.helperText}>
          Choose the things you are interested in.
        </Text>

        {isLoadingInterests ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.inlineLoadingText}>
              Loading interests...
            </Text>
          </View>
        ) : interestError ? (
          <View>
            <View style={styles.errorBox}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={COLORS.errorText}
              />
              <Text style={styles.errorText}>{interestError}</Text>
            </View>

            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void loadInterests();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.interestsWrap}>
            {interests.map((interest) => {
              const isSelected = selectedInterestIds.includes(interest.id);

              return (
                <Pressable
                  key={interest.id}
                  style={[
                    styles.interestButton,
                    isSelected && styles.interestButtonSelected,
                  ]}
                  onPress={() => toggleInterest(interest.id)}
                  disabled={isSubmitting}
                >
                  {isSelected ? (
                    <Ionicons
                      name="checkmark"
                      size={15}
                      color={COLORS.primary}
                    />
                  ) : null}

                  <Text
                    style={[
                      styles.interestText,
                      isSelected && styles.interestTextSelected,
                    ]}
                  >
                    {interest.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={[styles.label, styles.spacedLabel]}>
          Social profiles
        </Text>

        <Text style={styles.helperText}>
          Optional. Choose whether other students can see each account.
        </Text>

        {isLoadingSocialLinks ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.inlineLoadingText}>
              Loading social profiles...
            </Text>
          </View>
        ) : socialLinksError ? (
          <View>
            <View style={styles.errorBox}>
              <Ionicons
                name="alert-circle-outline"
                size={18}
                color={COLORS.errorText}
              />
              <Text style={styles.errorText}>
                {socialLinksError}
              </Text>
            </View>

            <Pressable
              style={styles.retryButton}
              onPress={() => {
                void loadSocialLinks();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.socialLabel}>LinkedIn URL</Text>

            <TextInput
              style={styles.input}
              value={linkedinValue}
              onChangeText={(value) => {
                setLinkedinValue(value);
                setSuccessMessage(null);

                if (!value.trim()) {
                  setLinkedinVisible(false);
                }
              }}
              placeholder="https://www.linkedin.com/in/username"
              placeholderTextColor={COLORS.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={255}
              editable={!isSubmitting}
            />

            <View style={styles.socialVisibilityRow}>
              <View style={styles.socialVisibilityText}>
                <Text style={styles.socialVisibilityTitle}>
                  Show my LinkedIn
                </Text>
                <Text style={styles.socialVisibilitySubtitle}>
                  Visible only when your overall profile is discoverable.
                </Text>
              </View>

              <Switch
                value={
                  Boolean(linkedinValue.trim()) && linkedinVisible
                }
                onValueChange={setLinkedinVisible}
                disabled={
                  isSubmitting || !linkedinValue.trim()
                }
                trackColor={{
                  false: "#D8D0D1",
                  true: "#C98B95",
                }}
                thumbColor={
                  linkedinVisible
                    ? COLORS.primary
                    : "#FFFFFF"
                }
              />
            </View>

            <Text style={[styles.socialLabel, styles.socialLabelSpaced]}>
              Instagram username
            </Text>

            <TextInput
              style={styles.input}
              value={instagramValue}
              onChangeText={(value) => {
                setInstagramValue(value);
                setSuccessMessage(null);

                if (!value.trim()) {
                  setInstagramVisible(false);
                }
              }}
              placeholder="username"
              placeholderTextColor={COLORS.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              editable={!isSubmitting}
            />

            <View style={styles.socialVisibilityRow}>
              <View style={styles.socialVisibilityText}>
                <Text style={styles.socialVisibilityTitle}>
                  Show my Instagram
                </Text>
                <Text style={styles.socialVisibilitySubtitle}>
                  Visible only when your overall profile is discoverable.
                </Text>
              </View>

              <Switch
                value={
                  Boolean(instagramValue.trim()) && instagramVisible
                }
                onValueChange={setInstagramVisible}
                disabled={
                  isSubmitting || !instagramValue.trim()
                }
                trackColor={{
                  false: "#D8D0D1",
                  true: "#C98B95",
                }}
                thumbColor={
                  instagramVisible
                    ? COLORS.primary
                    : "#FFFFFF"
                }
              />
            </View>
          </>
        )}

        <View style={styles.discoverabilityRow}>
          <View style={styles.discoverabilityText}>
            <Text style={styles.discoverabilityTitle}>
              Show me to other students
            </Text>

            <Text style={styles.discoverabilitySubtitle}>
              Turn this off to hide your profile from general student
              discovery.
            </Text>
          </View>

          <Switch
            value={isDiscoverable}
            onValueChange={setIsDiscoverable}
            disabled={isSubmitting}
            trackColor={{
              false: "#D8D0D1",
              true: "#C98B95",
            }}
            thumbColor={
              isDiscoverable ? COLORS.primary : "#FFFFFF"
            }
          />
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={COLORS.errorText}
            />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {successMessage ? (
          <View style={styles.successBox}>
            <Ionicons
              name="checkmark-circle-outline"
              size={18}
              color={COLORS.primary}
            />
            <Text style={styles.successText}>
              {successMessage}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.primaryButton,
            isSubmitting && styles.primaryButtonDisabled,
          ]}
          onPress={() => {
            void handleSave();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>
              Save Changes
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
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

  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
  },

  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  spacedLabel: {
    marginTop: 19,
  },

  helperText: {
    marginTop: -2,
    marginBottom: 11,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.mutedText,
  },

  input: {
    height: 54,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.inputBackground,
    fontSize: 16,
    color: COLORS.textDark,
  },

  optionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  optionButton: {
    width: 46,
    height: 42,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.inputBackground,
  },

  optionButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.selectedBackground,
  },

  optionText: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.mutedText,
  },

  optionTextSelected: {
    color: COLORS.primary,
  },

  campusList: {
    gap: 10,
  },

  campusButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: COLORS.inputBackground,
  },

  campusButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.selectedBackground,
  },

  campusText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  campusTextSelected: {
    color: COLORS.primary,
  },

  interestsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  interestButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.inputBackground,
  },

  interestButtonSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.selectedBackground,
  },

  interestText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textDark,
  },

  interestTextSelected: {
    color: COLORS.primary,
  },

  socialLabel: {
    marginTop: 4,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  socialLabelSpaced: {
    marginTop: 18,
  },

  socialVisibilityRow: {
    minHeight: 62,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 4,
  },

  socialVisibilityText: {
    flex: 1,
  },

  socialVisibilityTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  socialVisibilitySubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.mutedText,
  },

  inlineLoading: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  inlineLoadingText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  retryButton: {
    alignSelf: "flex-start",
    marginTop: 10,
  },

  retryText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
  },

  discoverabilityRow: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 15,
    backgroundColor: COLORS.inputBackground,
  },

  discoverabilityText: {
    flex: 1,
  },

  discoverabilityTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  discoverabilitySubtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.mutedText,
  },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.errorBackground,
  },

  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: COLORS.errorText,
  },

  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.successBackground,
  },

  successText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: COLORS.primary,
  },

  primaryButton: {
    minHeight: 54,
    marginTop: 24,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },

  primaryButtonDisabled: {
    opacity: 0.65,
  },

  primaryButtonText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
});