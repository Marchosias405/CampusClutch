import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
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
};

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp, resendVerification } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password || !confirmPassword) {
      setErrorMessage("Complete all required fields.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Your password must contain at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("The passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setMessage(null);

    const result = await signUp(normalizedEmail, password);

    if (result.error) {
      setErrorMessage(
        result.error.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "Unable to create the account. Check your information and try again."
      );
      setIsSubmitting(false);
      return;
    }

    if (result.verificationRequired) {
      setVerificationEmail(normalizedEmail);
      setMessage(
        "Check your email and open the verification link before signing in."
      );
      setIsSubmitting(false);
      return;
    }

    router.replace("/" as never);
  };

  const handleResendVerification = async () => {
    if (!verificationEmail) {
      return;
    }

    setIsResending(true);
    setErrorMessage(null);
    setMessage(null);

    const error = await resendVerification(verificationEmail);

    if (error) {
      setErrorMessage(
        error.status === 429
          ? "Please wait before requesting another email."
          : "Unable to resend the verification email."
      );
    } else {
      setMessage("A new verification email was requested.");
    }

    setIsResending(false);
  };

  if (verificationEmail) {
    return (
      <View
        style={[
          styles.verificationScreen,
          {
            paddingTop: Math.max(insets.top + 32, 56),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
      >
        <View style={styles.brandIcon}>
          <Ionicons name="mail-outline" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Verify your email</Text>

        <Text style={styles.subtitle}>
          We created an account for:
        </Text>

        <Text style={styles.verificationEmail}>{verificationEmail}</Text>

        {message ? (
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        ) : null}

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
            isResending && styles.primaryButtonDisabled,
          ]}
          onPress={() => {
            void handleResendVerification();
          }}
          disabled={isResending}
        >
          {isResending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>
              Resend Verification Email
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace("/sign-in" as never)}
        >
          <Text style={styles.secondaryButtonText}>Return to Sign In</Text>
        </Pressable>
      </View>
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
            paddingTop: Math.max(insets.top + 24, 44),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandIcon}>
          <Ionicons name="school" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.brandName}>CampusClutch</Text>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>
          Join your campus community and connect with other students.
        </Text>

        <Text style={styles.label}>Email address</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="student@example.com"
          placeholderTextColor={COLORS.mutedText}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          editable={!isSubmitting}
        />

        <Text style={[styles.label, styles.spacedLabel]}>Password</Text>

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
            accessibilityLabel={
              passwordVisible ? "Hide password" : "Show password"
            }
          >
            <Ionicons
              name={passwordVisible ? "eye-off-outline" : "eye-outline"}
              size={21}
              color={COLORS.mutedText}
            />
          </Pressable>
        </View>

        <Text style={[styles.label, styles.spacedLabel]}>
          Confirm password
        </Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Enter your password again"
          placeholderTextColor={COLORS.mutedText}
          secureTextEntry={!passwordVisible}
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!isSubmitting}
          returnKeyType="done"
          onSubmitEditing={() => {
            void handleSignUp();
          }}
        />

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
            void handleSignUp();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Create Account</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace("/sign-in" as never)}
          disabled={isSubmitting}
        >
          <Text style={styles.secondaryButtonText}>
            Already have an account? Sign In
          </Text>
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
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  verificationScreen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: COLORS.background,
  },

  brandIcon: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    marginBottom: 16,
  },

  brandName: {
    alignSelf: "center",
    marginBottom: 24,
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.primary,
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

  verificationEmail: {
    marginTop: -16,
    marginBottom: 20,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textDark,
    textAlign: "center",
  },

  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
  },

  spacedLabel: {
    marginTop: 17,
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

  passwordInputContainer: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.inputBackground,
  },

  passwordInput: {
    flex: 1,
    height: "100%",
    paddingLeft: 16,
    fontSize: 16,
    color: COLORS.textDark,
  },

  visibilityButton: {
    width: 52,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  messageBox: {
    marginBottom: 16,
    padding: 13,
    borderRadius: 10,
    backgroundColor: COLORS.successBackground,
  },

  messageText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: COLORS.primary,
    textAlign: "center",
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