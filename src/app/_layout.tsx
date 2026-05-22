import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="courses/add" />
        <Stack.Screen name="courses/classmates" />
        <Stack.Screen name="requests/create" />
        <Stack.Screen name="students/[id]" />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
