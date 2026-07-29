import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";

const COLORS = {
  primary: "#9B1C31",
  background: "#FFFFFF",
  textDark: "#2B2525",
  mutedText: "#8C8585",
  errorBackground: "#FDECEE",
  errorText: "#8F1428",
};

function getCallbackParameters(url: string) {
  const hashStart = url.indexOf("#");
  const queryStart = url.indexOf("?");

  const hashParameters = new URLSearchParams(
    hashStart >= 0 ? url.slice(hashStart + 1) : ""
  );

  const queryEnd = hashStart >= 0 ? hashStart : url.length;

  const queryParameters = new URLSearchParams(
    queryStart >= 0 ? url.slice(queryStart + 1, queryEnd) : ""
  );

  const getParameter = (name: string) =>
    hashParameters.get(name) ?? queryParameters.get(name);

  return {
    code: getParameter("code"),
    accessToken: getParameter("access_token"),
    refreshToken: getParameter("refresh_token"),
    errorDescription: getParameter("error_description"),
  };
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const url = Linking.useLinkingURL();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      return;
    }

    let isCancelled = false;

    const completeAuthentication = async () => {
      const {
        code,
        accessToken,
        refreshToken,
        errorDescription,
      } = getCallbackParameters(url);

      if (errorDescription) {
        if (!isCancelled) {
          setErrorMessage(errorDescription);
        }

        return;
      }


      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (isCancelled) {
          return;
        }

        if (error) {
          setErrorMessage(
            "CampusClutch could not complete email verification."
          );
          return;
        }

        router.replace("/" as never);
        return;
      }






      if (!accessToken || !refreshToken) {
        if (!isCancelled) {
          setErrorMessage(
            "The verification link is invalid or has expired."
          );
        }

        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (isCancelled) {
        return;
      }

      if (error) {
        setErrorMessage(
          "CampusClutch could not complete email verification."
        );
        return;
      }

      router.replace("/" as never);
    };

    void completeAuthentication();

    return () => {
      isCancelled = true;
    };
  }, [router, url]);

  return (
    <View style={styles.screen}>
      <View style={styles.brandIcon}>
        <Ionicons
          name={errorMessage ? "alert-outline" : "shield-checkmark-outline"}
          size={36}
          color="#FFFFFF"
        />
      </View>

      <Text style={styles.title}>
        {errorMessage ? "Verification failed" : "Verifying your email"}
      </Text>

      {errorMessage ? (
        <>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>

          <Pressable
            style={styles.button}
            onPress={() => router.replace("/sign-in" as never)}
          >
            <Text style={styles.buttonText}>Return to Sign In</Text>
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
            Please wait while CampusClutch completes authentication.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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