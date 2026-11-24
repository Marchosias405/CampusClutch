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
};

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (submitInFlight.current) return;
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setErrorMessage("Enter both your email address and password.");
      return;
    }

    submitInFlight.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);

    const connectionMessage = "Unable to sign in. Check your connection and try again.";
    try {
      const error = await signIn(normalizedEmail, password);
      if (!error) return; // The auth navigator takes over when the session is ready.
      if (error.code === "email_not_confirmed") {
        router.push({
          pathname: "/sign-up",
          params: { verify: "1", email: normalizedEmail.toLowerCase() },
        });
      } else if (error.status === 429) {
        setErrorMessage("Too many sign-in attempts. Wait a moment and try again.");
      } else if (error.status === 0 || error.name === "AuthRetryableFetchError") {
        setErrorMessage(connectionMessage);
      } else {
        setErrorMessage("Unable to sign in. Check your email and password and try again.");
      }
    } catch {
      setErrorMessage(connectionMessage);
    }
    submitInFlight.current = false;
    setIsSubmitting(false);
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
            paddingTop: Math.max(insets.top + 32, 56),
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
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in to connect with classmates and campus opportunities.
        </Text>

        <View style={styles.form}>
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
            returnKeyType="next"
          />

          <View style={styles.passwordHeader}>
            <Text style={[styles.label, styles.passwordHeaderLabel]}>
              Password
            </Text>

            <Pressable
              onPress={() => router.push("/forgot-password" as never)}
              disabled={isSubmitting}
              style={styles.forgotPasswordButton}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.forgotPasswordText}>
                Forgot password?
              </Text>
            </Pressable>
          </View>

          <View style={styles.passwordInputContainer}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={COLORS.mutedText}
              secureTextEntry={!passwordVisible}
              textContentType="password"
              autoComplete="current-password"
              editable={!isSubmitting}
              returnKeyType="done"
              onSubmitEditing={() => {
                void handleSignIn();
              }}
            />



            <Pressable
              style={styles.visibilityButton}
              onPress={() => setPasswordVisible((current) => !current)}
              disabled={isSubmitting}
              accessibilityRole="button"
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
              void handleSignIn();
            }}
            disabled={isSubmitting}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign In</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push("/sign-up" as never)}
            disabled={isSubmitting}
          >
            <Text style={styles.secondaryButtonText}>
              New to CampusClutch? Create Account
            </Text>
          </Pressable>
          <LegalLinks disabled={isSubmitting} />
        </View>
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
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.primary,
    marginBottom: 32,
  },

  title: {
    fontSize: 30,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  subtitle: {
    marginTop: 10,
    marginBottom: 34,
    paddingHorizontal: 10,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.mutedText,
    textAlign: "center",
  },

  form: {
    width: "100%",
  },

  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textDark,
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
    minHeight: 54,
    paddingVertical: 12,
    width: 52,
    alignItems: "center",
    justifyContent: "center",
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
    paddingVertical: 12,
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





  forgotPasswordButton: { minHeight: 48, justifyContent: "center" },

  passwordHeader: {
    flexWrap: "wrap",
    columnGap: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    marginBottom: 8,
  },

  passwordHeaderLabel: {
    marginBottom: 0,
  },

  forgotPasswordText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },





});
