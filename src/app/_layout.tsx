import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RequestsProvider } from "../context/RequestsContext";

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={DefaultTheme}>
        <RequestsProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="courses/add" />
            <Stack.Screen name="courses/classmates" />
            <Stack.Screen name="requests/create" />
            <Stack.Screen name="requests/[id]" />
            <Stack.Screen name="students/[id]" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="messages/[id]" />
          </Stack>

          <StatusBar style="light" />
        </RequestsProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

