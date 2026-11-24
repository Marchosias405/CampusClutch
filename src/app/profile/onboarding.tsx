import LegalLinks from "@/components/LegalLinks";
import { MotionPressable as Pressable } from '@/components/motion';
import { DeleteAccountButton } from "@/context/AccountDeletionProvider";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";

import {
  deleteProfileAvatar,
  getProfileAvatarSignedUrl,
  uploadProfileAvatar,
} from "@/lib/avatars";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useProfile } from "@/context/ProfileContext";
import {
  getProfileSocialLinks,
  replaceProfileInterests,
  replaceProfileSocialLinks,
} from "@/lib/profiles";
import InterestPicker from "@/components/InterestPicker";
import { useInterestSelection } from "@/hooks/useInterestSelection";
import { useAuth } from "@/context/AuthContext";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#E8DDDF",
  inputBackground: "#FBF8F8",
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
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

export default function ProfileOnboardingScreen() {
  const { user } = useAuth();
  const { profile } = useProfile();
  if (!user || profile?.id !== user.id) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color="#9B1C31" /></View>;
  return <ProfileForm key={user.id} />;
}

function ProfileForm() {
  const insets = useSafeAreaInsets();
  const { profile, saveProfile } = useProfile();
  const profileId = profile?.id;
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);
  const [selectedAvatar, setSelectedAvatar] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(
    Boolean(profile?.avatarPath)
  );
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [major, setMajor] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState<number | null>(null);
  const [isDiscoverable, setIsDiscoverable] = useState(false);

  const { interests, selectedInterestIds, setSelectedInterestIds,
    isLoadingInterests, interestError, loadInterests } = useInterestSelection(profileId);

  const [linkedinValue, setLinkedinValue] = useState("");
  const [linkedinVisible, setLinkedinVisible] = useState(false);
  const [instagramValue, setInstagramValue] = useState("");
  const [instagramVisible, setInstagramVisible] = useState(false);
  const [isLoadingSocialLinks, setIsLoadingSocialLinks] = useState(true);
  const [socialLinksError, setSocialLinksError] = useState<string | null>(null);

  const saving = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSocialLinks = useCallback(async () => {
    if (!profileId) {
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
      const socialLinks = await getProfileSocialLinks(profileId);

      setLinkedinValue(socialLinks.linkedin?.value ?? "");
      setLinkedinVisible(socialLinks.linkedin?.isVisible ?? false);

      setInstagramValue(socialLinks.instagram?.value ?? "");
      setInstagramVisible(socialLinks.instagram?.isVisible ?? false);
    } catch {
      setSocialLinksError("Unable to load social profiles.");
    } finally {
      setIsLoadingSocialLinks(false);
    }
  }, [profileId]);





  useEffect(() => {
    let isActive = true;

    const loadAvatar = async () => {
      if (!profile?.avatarPath) {
        if (isActive) {
          setAvatarSignedUrl(null);
          setAvatarError(null);
          setIsLoadingAvatar(false);
        }

        return;
      }

      setIsLoadingAvatar(true);
      setAvatarError(null);

      try {
        const signedUrl = await getProfileAvatarSignedUrl(
          profile.avatarPath
        );

        if (isActive) {
          setAvatarSignedUrl(signedUrl);
        }
      } catch {
        if (isActive) {
          setAvatarSignedUrl(null);
          setAvatarError("Unable to load your profile photo.");
        }
      } finally {
        if (isActive) {
          setIsLoadingAvatar(false);
        }
      }
    };

    void loadAvatar();

    return () => {
      isActive = false;
    };
  }, [profile?.avatarPath]);



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
  };




  const handleChooseAvatar = async () => {
    setErrorMessage(null);

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setErrorMessage(
          "Allow photo access to choose a profile picture."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];

      if (!asset) {
        return;
      }

      if (!asset.mimeType) {
        setErrorMessage(
          "The image type could not be determined. Choose a JPEG, PNG, or WebP image."
        );
        return;
      }

      setSelectedAvatar(asset);
      setAvatarError(null);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };







  const handleSubmit = async () => {
    if (saving.current) return;
    const normalizedName = displayName.trim();
    const normalizedLinkedin = linkedinValue.trim();
    const normalizedInstagram = instagramValue.trim();

    if (!normalizedName) {
      setErrorMessage("Enter your display name.");
      return;
    }

    if (normalizedName.length > 80) {
      setErrorMessage("Display name must be 80 characters or fewer.");
      return;
    }

    const normalizedMajor = major.trim();

    if (normalizedMajor.length > 120) {
      setErrorMessage("Major must be 120 characters or fewer.");
      return;
    }


    if (
      normalizedLinkedin &&
      !LINKEDIN_PROFILE_URL_PATTERN.test(normalizedLinkedin)
    ) {
      setErrorMessage(
        "Enter a valid LinkedIn profile URL, such as https://www.linkedin.com/in/username."
      );
      return;
    }

    if (
      normalizedInstagram &&
      !INSTAGRAM_USERNAME_PATTERN.test(normalizedInstagram)
    ) {
      setErrorMessage(
        "Instagram usernames can contain only letters, numbers, periods, and underscores."
      );
      return;
    }





    if (!profile) {
      setErrorMessage("Profile unavailable. Try again.");
      return;
    }

    if (isLoadingInterests || isLoadingSocialLinks) {
      setErrorMessage("Wait for your profile details to finish loading.");
      return;
    }

    if (interestError) {
      setErrorMessage("Retry loading interests before continuing.");
      return;
    }

    if (socialLinksError) {
      setErrorMessage("Retry loading social profiles before continuing.");
      return;
    }

    saving.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    let uploadedAvatarPath: string | null = null;

    try {
      // Save related profile data before saveProfile(). Completing the core
      // profile causes Stack.Protected to remove the onboarding route.
      await replaceProfileInterests(profile.id, selectedInterestIds);

      await replaceProfileSocialLinks(profile.id, {
        linkedinValue: normalizedLinkedin,
        linkedinVisible:
          Boolean(normalizedLinkedin) && linkedinVisible,
        instagramValue: normalizedInstagram,
        instagramVisible:
          Boolean(normalizedInstagram) && instagramVisible,
      });

      if (selectedAvatar) {
        uploadedAvatarPath = await uploadProfileAvatar(
          profile.id,
          selectedAvatar.uri,
          selectedAvatar.mimeType
        );
      }

      const oldAvatarPath = profile.avatarPath;

      await saveProfile({
        displayName: normalizedName,
        major: normalizedMajor || null,
        yearOfStudy,
        avatarPath: uploadedAvatarPath ?? oldAvatarPath,
        isDiscoverable,
      });

      // At this point the new avatar path is confirmed in the profile row.
      // Cleanup failure should not undo a successfully completed profile.
      if (
        uploadedAvatarPath &&
        oldAvatarPath &&
        oldAvatarPath !== uploadedAvatarPath
      ) {
        try {
          await deleteProfileAvatar(profile.id, oldAvatarPath);
        } catch {
          // A private old object remaining behind is safer than reverting
          // a profile that has already completed onboarding.
        }
      }
    } catch (error) {
      // If the new upload was created but the final profile update failed,
      // remove the orphan and preserve the previous avatar.
      if (uploadedAvatarPath) {
        try {
          await deleteProfileAvatar(
            profile.id,
            uploadedAvatarPath
          );
        } catch {
          // Preserve the original error shown to the user.
        }
      }

      setErrorMessage(getErrorMessage(error));
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 24, 44),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandIcon}>
          <Ionicons name="person" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Set up your profile</Text>

        <Text style={styles.subtitle}>
          Tell other students a little about yourself. You can change these
          details later.
        </Text>
        <View style={styles.avatarSection}>
          <View style={styles.avatarPreview}>
            {selectedAvatar?.uri || avatarSignedUrl ? (
              <Image
                source={{
                  uri: selectedAvatar?.uri ?? avatarSignedUrl ?? "",
                }}
                style={styles.avatarImage}
                contentFit="cover"
              />
            ) : isLoadingAvatar ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Ionicons
                name="person"
                size={42}
                color={COLORS.mutedText}
              />
            )}
          </View>

          <Pressable
            accessibilityRole="button"
            style={styles.avatarButton}
            accessibilityLabel="Choose profile photo"
            accessibilityState={{ disabled: isSubmitting }}
            onPress={() => {
              void handleChooseAvatar();
            }}
            disabled={isSubmitting}
          >
            <Ionicons
              name="image-outline"
              size={18}
              color={COLORS.primary}
            />

            <Text style={styles.avatarButtonText}>
              {profile?.avatarPath || selectedAvatar
                ? "Change profile photo"
                : "Choose profile photo"}
            </Text>
          </Pressable>

          <Text style={styles.avatarHelperText}>
            JPEG, PNG, or WebP. Maximum 5 MB.
          </Text>

          {avatarError ? (
            <Text style={styles.avatarErrorText}>
              {avatarError}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.label, { fontSize: 22, marginBottom: 8 }]}>The basics</Text>
        <Text style={[styles.helperText, { marginBottom: 18 }]}>Only your display name is required. Add what you’d like other students to know.</Text>
        <Text style={styles.label}>Display name *</Text>

        <TextInput
          accessibilityLabel="Display name"
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

        <Text style={[styles.label, styles.spacedLabel]}>Major (optional)</Text>

        <TextInput
          accessibilityLabel="Major (optional)"
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
          Year of study (optional)
        </Text>

        <View style={styles.optionsWrap}>
          {YEARS.map((year) => {
            const isSelected = yearOfStudy === year;

            return (
              <Pressable
                key={year}
                accessibilityRole="button"
                accessibilityLabel={`Year ${year}`}
                accessibilityState={{ selected: isSelected, disabled: isSubmitting }}
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

        <Text style={[styles.label, styles.spacedLabel]}>Interests</Text>

        <Text style={styles.helperText}>
          Find your people through shared hobbies and everyday favorites.
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
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>{interestError}</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              style={styles.retryButton}
              onPress={() => {
                void loadInterests();
              }}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <InterestPicker interests={interests} selectedIds={selectedInterestIds}
            onToggle={toggleInterest} disabled={isSubmitting} />
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
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {socialLinksError}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
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
              accessibilityLabel="LinkedIn URL"
              style={styles.input}
              value={linkedinValue}
              onChangeText={(value) => {
                setLinkedinValue(value);

                if (!value.trim()) {
                  setLinkedinVisible(false);
                }
              }}
              placeholder="LinkedIn profile URL"
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
                accessibilityLabel="Show my LinkedIn"
                style={styles.switchControl}
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
              accessibilityLabel="Instagram username"
              style={styles.input}
              value={instagramValue}
              onChangeText={(value) => {
                setInstagramValue(value);

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
                accessibilityLabel="Show my Instagram"
                style={styles.switchControl}
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
              You can change this setting later.
            </Text>
          </View>

          <Switch
            accessibilityLabel="Show me to other students"
            style={styles.switchControl}
            value={isDiscoverable}
            onValueChange={setIsDiscoverable}
            disabled={isSubmitting}
            trackColor={{
              false: "#D8D0D1",
              true: "#C98B95",
            }}
            thumbColor={isDiscoverable ? COLORS.primary : "#FFFFFF"}
          />
        </View>

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={COLORS.errorText}
            />
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
            style={[
              styles.primaryButton,
              isSubmitting && styles.primaryButtonDisabled,
            ]}
            onPress={() => {
              void handleSubmit();
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
          <DeleteAccountButton />
        </View>
        <LegalLinks disabled={isSubmitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },

  brandIcon: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    marginBottom: 18,
  },

  title: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  subtitle: {
    marginTop: 9,
    marginBottom: 28,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.mutedText,
    textAlign: "center",
  },

  avatarSection: {
    alignItems: "center",
    marginBottom: 28,
  },

  avatarPreview: {
    width: 112,
    height: 112,
    borderRadius: 56,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.inputBackground,
  },

  avatarImage: {
    width: "100%",
    height: "100%",
  },

  avatarButton: {
    marginTop: 14,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 9,
  },

  avatarButtonText: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
  },

  avatarHelperText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.mutedText,
  },

  avatarErrorText: {
    marginTop: 7,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.errorText,
    textAlign: "center",
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
    minHeight: 54,
    paddingVertical: 14,
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
    minWidth: 48,
    minHeight: 48,
    padding: 10,
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 4,
  },

  socialVisibilityText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 180,
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
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.mutedText,
  },

  retryButton: {
    minHeight: 48,
    minWidth: 48,
    paddingVertical: 12,
    justifyContent: "center",
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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 15,
    backgroundColor: COLORS.inputBackground,
  },

  discoverabilityText: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 180,
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

  switchControl: { minHeight: 48, minWidth: 48 },

  actions: {
    marginTop: 24,
    gap: 16,
  },

  primaryButton: {
    paddingVertical: 14,
    minHeight: 54,
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
    textAlign: "center",
  },
});
