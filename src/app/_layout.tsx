import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProfileProvider, useProfile } from "@/context/ProfileContext";
import { RequestsProvider } from "@/context/RequestsContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={DefaultTheme}>
        <AuthProvider>
          <ProfileProvider>
            <RequestsProvider>
              <RootNavigator />
            </RequestsProvider>
          </ProfileProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const {
    session,
    isRestoringSession,
    isPasswordRecovery,
  } = useAuth();

  const {
    profile,
    isLoadingProfile,
    profileError,
    isProfileComplete,
    refreshProfile,
  } = useProfile();

  const shouldLoadProfile =
    Boolean(session) && !isPasswordRecovery;

  if (
    isRestoringSession ||
    (shouldLoadProfile && isLoadingProfile)
  ) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#9B1C31" />

        <Text style={styles.loadingText}>
          {isRestoringSession
            ? "Restoring your session..."
            : "Loading your profile..."}
        </Text>
      </View>
    );
  }

  if (shouldLoadProfile && profileError) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />

        <Text style={styles.stateTitle}>
          Unable to load your profile
        </Text>

        <Text style={styles.stateMessage}>
          Check your connection and try again.
        </Text>

        <Pressable
          style={styles.retryButton}
          onPress={() => {
            void refreshProfile();
          }}
        >
          <Text style={styles.retryButtonText}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (
    shouldLoadProfile &&
    !isLoadingProfile &&
    !profile
  ) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />

        <Text style={styles.stateTitle}>
          Profile unavailable
        </Text>

        <Text style={styles.stateMessage}>
          Your account is signed in, but its CampusClutch profile could not be
          found.
        </Text>

        <Pressable
          style={styles.retryButton}
          onPress={() => {
            void refreshProfile();
          }}
        >
          <Text style={styles.retryButtonText}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected
          guard={
            Boolean(session) &&
            !isPasswordRecovery &&
            isProfileComplete
          }
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="courses/add" />
          <Stack.Screen name="courses/classmates" />
          <Stack.Screen name="requests/create" />
          <Stack.Screen name="requests/[id]" />
          <Stack.Screen name="students/[id]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="messages/[id]" />
          <Stack.Screen name="profile/settings" />
        </Stack.Protected>

        <Stack.Protected
          guard={
            Boolean(session) &&
            !isPasswordRecovery &&
            Boolean(profile) &&
            !isProfileComplete
          }
        >
          <Stack.Screen name="profile/onboarding" />
        </Stack.Protected>

        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        <Stack.Screen name="auth/callback" />
        <Stack.Screen name="auth/reset-password" />
      </Stack>

      <StatusBar
        style={
          session && isProfileComplete
            ? "light"
            : "dark"
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 24,
  },

  loadingText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#8C8585",
    textAlign: "center",
  },

  stateTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#2B2525",
    textAlign: "center",
  },

  stateMessage: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#8C8585",
    textAlign: "center",
  },

  retryButton: {
    minWidth: 120,
    minHeight: 46,
    marginTop: 4,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9B1C31",
  },

  retryButtonText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
  },
});