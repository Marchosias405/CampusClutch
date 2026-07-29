import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import { RequestsProvider } from "@/context/RequestsContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={DefaultTheme}>
        <AuthProvider>
          <RequestsProvider>
            <RootNavigator />
          </RequestsProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, isRestoringSession } = useAuth();

  if (isRestoringSession) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#9B1C31" />
        <Text style={styles.loadingText}>Restoring your session...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth/callback" />
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="courses/add" />
          <Stack.Screen name="courses/classmates" />
          <Stack.Screen name="requests/create" />
          <Stack.Screen name="requests/[id]" />
          <Stack.Screen name="students/[id]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="messages/[id]" />
        </Stack.Protected>

        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>

      <StatusBar style={session ? "light" : "dark"} />
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
  },

  loadingText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#8C8585",
  },
});