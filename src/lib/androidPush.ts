import Constants from 'expo-constants';
import { Platform } from 'react-native';

export async function androidPushToken(prompt: boolean, devicePushToken?: import('expo-notifications').DevicePushToken) {
  if (Platform.OS !== 'android') return null;
  const notifications = await import('expo-notifications');
  for (const [id, name] of [['messages', 'Direct messages'], ['requests', 'Requests and offers']]) {
    await notifications.setNotificationChannelAsync(id, { name, importance: notifications.AndroidImportance.DEFAULT });
  }
  let permission = await notifications.getPermissionsAsync();
  if (!permission.granted && prompt && permission.canAskAgain) permission = await notifications.requestPermissionsAsync();
  if (!permission.granted) return null;
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Missing Expo project configuration');
  return (await notifications.getExpoPushTokenAsync({ projectId, devicePushToken })).data;
}
