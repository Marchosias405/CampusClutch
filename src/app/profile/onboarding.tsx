import { Ionicons } from "@expo/vector-icons";

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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useProfile } from "@/context/ProfileContext";
import {
  getCampuses,
  getInterests,
  getProfileInterests,
  replaceProfileInterests,
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
  selectedBackground: "#F7E7EA",
};

const YEARS = [1, 2, 3, 4, 5, 6, 7, 8];

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
  const insets = useSafeAreaInsets();
  const { profile, saveProfile } = useProfile();

  const [displayName, setDisplayName] = useState("");
  const [major, setMajor] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState<number | null>(null);
  const [campusId, setCampusId] = useState<string | null>(null);
  const [isDiscoverable, setIsDiscoverable] = useState(false);

  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [isLoadingCampuses, setIsLoadingCampuses] = useState(true);
  const [campusError, setCampusError] = useState<string | null>(null);

  const [interests, setInterests] = useState<Interest[]>([]);
  const [selectedInterestIds, setSelectedInterestIds] = useState<string[]>([]);
  const [isLoadingInterests, setIsLoadingInterests] = useState(true);
  const [interestError, setInterestError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  useEffect(() => {
    void loadCampuses();
  }, []);

  useEffect(() => {
    void loadInterests();
  }, [loadInterests]);

  const toggleInterest = (interestId: string) => {
    setSelectedInterestIds((current) => {
      if (current.includes(interestId)) {
        return current.filter((id) => id !== interestId);
      }

      return [...current, interestId];
    });
  };

  const handleSubmit = async () => {
    const normalizedName = displayName.trim();

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

    if (!profile) {
      setErrorMessage("Profile unavailable. Try again.");
      return;
    }

    if (isLoadingInterests) {
      setErrorMessage("Wait for interests to finish loading.");
      return;
    }

    if (interestError) {
      setErrorMessage("Retry loading interests before continuing.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      // Save interests first. saveProfile() completes onboarding and causes
      // Stack.Protected to remove this route once the profile becomes complete.
      await replaceProfileInterests(profile.id, selectedInterestIds);

      await saveProfile({
        displayName: normalizedName,
        major: normalizedMajor || null,
        yearOfStudy,
        campusId,
        isDiscoverable,
      });
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
                      isSelected ? COLORS.primary : COLORS.mutedText
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
          Choose the things you are interested in. You can change these later.
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
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
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
    textAlign: "center",
  },
});