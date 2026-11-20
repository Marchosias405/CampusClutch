import LegalLinks from "@/components/LegalLinks";
import { MotionPressable as Pressable } from '@/components/motion';
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
  mutedText: "#635C5C",
  border: "#E8DDDF",
  inputBackground: "#FBF8F8",
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
  successBackground: "#F7ECEE",
};

// Email quota and request throttling have different causes. Neither is
// cleared by restarting the app; Auth does not provide an exact retry time.
function signupRateLimitMessage(error: { code?: string; status?: number }) {
  if (error.code === "over_email_send_rate_limit") {
    return "Verification emails are temporarily limited. Please try again later. Restarting the app won't reset this limit.";
  }
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Please wait before trying again. Restarting the app won't reset this limit.";
  }
  return null;
}

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ verify?: string; email?: string }>();
  const insets = useSafeAreaInsets();
  const { signUp, resendVerification } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    params.verify === "1" ? (typeof params.email === "string" ? params.email.trim().toLowerCase() : "") : null
  );
  const requestInFlight = useRef(false);
  const verificationBusy = isResending;
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (requestInFlight.current) return;
    const normalizedEmail = email.trim().toLowerCase();

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

    requestInFlight.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const result = await signUp(normalizedEmail, password);

      if (result.error) {
        const alreadyRegistered =
          result.error.code === "user_already_exists" ||
          result.error.code === "email_exists";
        setErrorMessage(
          signupRateLimitMessage(result.error) ??
            (alreadyRegistered
              ? "This email is already registered. Sign in with your existing password or reset it."
              : "Unable to create the account. Check your information and try again.")
        );
        requestInFlight.current = false;
        setIsSubmitting(false);
        return;
      }

      if (result.verificationRequired) {
        // A no-session response can also hide an existing, verified account.
        // It does not prove a new account was created or an email was sent.
        setVerificationEmail(normalizedEmail);
        setPassword("");
        setConfirmPassword("");
        setPasswordVisible(false);
        setMessage(
          "If this address needs verification, check your inbox and spam folder for a verification link. Open it on any device, then return here to sign in."
        );
        requestInFlight.current = false;
        setIsSubmitting(false);
      }
      // With a session, the auth navigator takes over.
    } catch {
      setErrorMessage(
        "Unable to complete signup. Check your connection and try again."
      );
      requestInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (requestInFlight.current) return;
    const address = verificationEmail?.trim().toLowerCase();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setErrorMessage("Enter the email address you used to sign up.");
      return;
    }
    requestInFlight.current = true;

    setIsResending(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const error = await resendVerification(address);
      if (error) {
        setErrorMessage(
          signupRateLimitMessage(error) ??
            "Unable to resend the verification email."
        );
      } else {
        setMessage(
          "If this address still needs verification, check your inbox and spam folder for a verification link. Open it on any device, then return here to sign in."
        );
      }
    } catch {
      setErrorMessage(
        "Unable to request another email. Check your connection and try again."
      );
    } finally {
      requestInFlight.current = false;
      setIsResending(false);
    }
  };

  if (verificationEmail !== null) {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={styles.screen}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 32, 56),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
      >
        <View style={styles.brandIcon}>
          <Ionicons name="mail-outline" size={34} color="#FFFFFF" />
        </View>

        <Text style={styles.title}>Check your email</Text>

        <Text style={styles.subtitle}>
          Open the verification link on any device. Then return to CampusClutch and sign in.
        </Text>
        <Text style={styles.label}>Email address</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Verification email address"
          value={verificationEmail}
          onChangeText={value => {
            setVerificationEmail(value);
            setErrorMessage(null);
            setMessage(null);
          }}
          placeholder="student@example.com"
          placeholderTextColor={COLORS.mutedText}
          autoCapitalize="none" autoCorrect={false}
          keyboardType="email-address" autoComplete="email"
          editable={!verificationBusy}
        />
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
          style={[styles.primaryButton, verificationBusy && styles.primaryButtonDisabled]}
          accessibilityRole="button"
          disabled={verificationBusy}
          onPress={() => router.replace({ pathname: "/sign-in", params: { email: verificationEmail.trim().toLowerCase() } })}
        >
          <Text style={styles.primaryButtonText}>Return to Sign In</Text>
        </Pressable>

        <Text style={styles.accountGuidance}>
          Already registered? Sign in with your existing password or reset it.
          Verified accounts do not need another verification email.
        </Text>

        <Pressable
          style={[
            styles.secondaryButton,
            verificationBusy && styles.primaryButtonDisabled,
          ]}
          onPress={() => {
            void handleResendVerification();
          }}
          disabled={verificationBusy}
        >
          {isResending ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <Text style={styles.secondaryButtonText}>
              Resend Verification Email
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace("/forgot-password" as never)}
          disabled={verificationBusy}
        >
          <Text style={styles.secondaryButtonText}>Forgot Password?</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            setVerificationEmail(null);
            setMessage(null);
            setErrorMessage(null);
          }}
          disabled={verificationBusy}
        >
          <Text style={styles.secondaryButtonText}>Use a different email</Text>
        </Pressable>
        <LegalLinks disabled={verificationBusy} />
      </ScrollView>
      </KeyboardAvoidingView>
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

        <LegalLinks disabled={isSubmitting} />

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
        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.replace("/forgot-password" as never)}
          disabled={isSubmitting}
        >
          <Text style={styles.secondaryButtonText}>Forgot Password?</Text>
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

  accountGuidance: {
    marginTop: 20,
    fontSize: 14,
    lineHeight: 21,
    color: COLORS.textDark,
    textAlign: "center",
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
