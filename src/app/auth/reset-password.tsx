import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#635C5C",
  border: "#E8DDDF",
  inputBackground: "#FBF8F8",
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const url = Linking.useLinkingURL();
  const {
    updatePassword,
    beginPasswordRecovery,
    endPasswordRecovery,
  } = useAuth();

  const [isPreparing, setIsPreparing] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }

    let isCancelled = false;

    const prepareRecoverySession = async () => {
      const queryStart = url.indexOf("?");
      const hashStart = url.indexOf("#");

      const queryEnd = hashStart >= 0 ? hashStart : url.length;

      const queryParameters = new URLSearchParams(
        queryStart >= 0 ? url.slice(queryStart + 1, queryEnd) : ""
      );

      const code = queryParameters.get("code");
      const errorDescription = queryParameters.get("error_description");

      if (errorDescription || !code || code.length > 2048) {
        if (!isCancelled) {
          setErrorMessage(
            "The password reset link is invalid or has expired."
          );
          setIsPreparing(false);
        }

        return;
      }


      beginPasswordRecovery();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (isCancelled) {
        return;
      }

      if (error) {
        endPasswordRecovery();
        setErrorMessage(
          "CampusClutch could not verify this password reset link."
        );
        setIsPreparing(false);
        return;
      }

      setIsPreparing(false);
    };

    void prepareRecoverySession();

    return () => {
      isCancelled = true;
    };
  }, [beginPasswordRecovery, endPasswordRecovery, url]);

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      setErrorMessage("Enter and confirm your new password.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage(
        "Your password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const error = await updatePassword(password);

    if (error) {
      setErrorMessage(
        error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "Unable to update your password."
      );
      setIsSubmitting(false);
      return;
    }

    router.replace("/" as never);
  };

  if (isPreparing) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.centeredScreen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>
          Verifying your reset link...
        </Text>
      </ScrollView>
    );
  }

  if (errorMessage && !password && !confirmPassword) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.centeredScreen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.brandIcon}>
          <Ionicons name="alert-outline" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Reset link unavailable</Text>

        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          style={styles.primaryButton}
          onPress={() => router.replace("/forgot-password" as never)}
        >
          <Text style={styles.primaryButtonText}>
            Request Another Link
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => router.replace("/sign-in" as never)}
        >
          <Text style={styles.secondaryButtonText}>
            Return to Sign In
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 32, 56),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandIcon}>
          <Ionicons name="lock-closed-outline" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Choose a new password</Text>

        <Text style={styles.subtitle}>
          Enter a new password for your CampusClutch account.
        </Text>

        <Text style={styles.label}>New password</Text>

        <View style={styles.passwordInputContainer}>
          <TextInput
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={COLORS.mutedText}
            secureTextEntry={!passwordVisible}
            textContentType="newPassword"
            autoComplete="new-password"
            editable={!isSubmitting}
          />

          <Pressable
            style={styles.visibilityButton}
            onPress={() => setPasswordVisible((current) => !current)}
            disabled={isSubmitting}
          >
            <Ionicons
              name={
                passwordVisible ? "eye-off-outline" : "eye-outline"
              }
              size={21}
              color={COLORS.mutedText}
            />
          </Pressable>
        </View>

        <Text style={[styles.label, styles.confirmLabel]}>
          Confirm new password
        </Text>

        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Enter your new password again"
          placeholderTextColor={COLORS.mutedText}
          secureTextEntry={!passwordVisible}
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!isSubmitting}
          returnKeyType="done"
          onSubmitEditing={() => {
            void handleUpdatePassword();
          }}
        />

        {errorMessage ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <Pressable
          style={[
            styles.primaryButton,
            isSubmitting && styles.primaryButtonDisabled,
          ]}
          onPress={() => {
            void handleUpdatePassword();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>
              Update Password
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

  centeredScreen: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: COLORS.background,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  brandIcon: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    backgroundColor: COLORS.primary,
  },

  title: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  subtitle: {
    marginTop: 10,
    marginBottom: 30,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.mutedText,
    textAlign: "center",
  },

  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.mutedText,
  },

  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  confirmLabel: {
    marginTop: 18,
  },

  input: {
    minHeight: 54,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.inputBackground,
    fontSize: 16,
    color: COLORS.textDark,
  },

  passwordInputContainer: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.inputBackground,
  },

  passwordInput: {
    flex: 1,
    minHeight: 54,
    paddingVertical: 12,
    paddingLeft: 16,
    fontSize: 16,
    color: COLORS.textDark,
  },

  visibilityButton: {
    alignSelf: "stretch",
    width: 52,
    minHeight: 54,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  errorBox: {
    width: "100%",
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.errorBackground,
  },

  errorText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: COLORS.errorText,
    textAlign: "center",
  },

  primaryButton: {
    width: "100%",
    minHeight: 54,
    marginTop: 24,
    borderRadius: 12,
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

  secondaryButton: {
    minHeight: 48,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
    textAlign: "center",
  },
});
