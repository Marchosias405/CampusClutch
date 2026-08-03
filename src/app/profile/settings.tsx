import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
import { getCampuses } from "@/lib/profiles";
import type { Campus } from "@/types";

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

  useEffect(() => {
    void loadCampuses();
  }, []);

  const handleSave = async () => {
    const normalizedName = displayName.trim();
    const normalizedMajor = major.trim();

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

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
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