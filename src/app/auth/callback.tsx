import { Ionicons } from "@expo/vector-icons";
import {
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
};

export default function AuthCallbackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    code,
    error_description: errorDescription,
  } = useLocalSearchParams<{
    code?: string;
    error_description?: string;
  }>();

  const { isRestoringSession } = useAuth();

  const [errorMessage, setErrorMessage] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (isRestoringSession) {
      return;
    }

    if (errorDescription || (code !== undefined && (typeof code !== "string" || code.length > 2048))) {
      setErrorMessage("This verification link is invalid or has expired.");
      return;
    }

    // Android/Expo may restore this route after the original
    // authentication link has already been consumed.
    //
    // If there is no fresh PKCE code, leave the stale callback
    // route instead of displaying an endless/error verification state.
    if (!code) {
      router.replace("/sign-in" as never);
      return;
    }

    let isCancelled = false;

    const completeAuthentication = async () => {
      setErrorMessage(null);

      const { error } =
        await supabase.auth.exchangeCodeForSession(code);

      if (isCancelled) {
        return;
      }

      if (error) {
        setErrorMessage(
          "CampusClutch could not complete email verification."
        );
        return;
      }
    };

    void completeAuthentication();

    return () => {
      isCancelled = true;
    };
  }, [
    code,
    errorDescription,
    isRestoringSession,
    router,
  ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.background }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brandIcon}>
        <Ionicons
          name={
            errorMessage
              ? "alert-outline"
              : "shield-checkmark-outline"
          }
          size={36}
          color="#FFFFFF"
        />
      </View>

      <Text style={styles.title}>
        {errorMessage
          ? "Verification failed"
          : "Verifying your email"}
      </Text>

      {errorMessage ? (
        <>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              {errorMessage}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            style={styles.button}
            onPress={() =>
              router.replace("/sign-in" as never)
            }
          >
            <Text style={styles.buttonText}>
              Return to Sign In
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator
            style={styles.activityIndicator}
            size="large"
            color={COLORS.primary}
          />

          <Text style={styles.subtitle}>
            Please wait while CampusClutch completes
            authentication.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: COLORS.background,
  },

  brandIcon: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    backgroundColor: COLORS.primary,
  },

  title: {
    fontSize: 27,
    fontWeight: "900",
    color: COLORS.textDark,
    textAlign: "center",
  },

  subtitle: {
    marginTop: 18,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.mutedText,
    textAlign: "center",
  },

  activityIndicator: {
    marginTop: 28,
  },

  errorBox: {
    width: "100%",
    marginTop: 24,
    padding: 14,
    borderRadius: 10,
    backgroundColor: COLORS.errorBackground,
  },

  errorText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: COLORS.errorText,
    textAlign: "center",
  },

  button: {
    width: "100%",
    minHeight: 54,
    marginTop: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },

  buttonText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
});
