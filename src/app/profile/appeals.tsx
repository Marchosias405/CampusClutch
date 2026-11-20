import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import React from 'react';
import { View } from 'react-native';
import AccountAppeals from '../../components/AccountAppeals';
import { useAuth } from '../../context/AuthContext';

export default function AccountAppealsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const active = useIsFocused();
  return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>{user && <AccountAppeals key={user.id} userId={user.id} active={active}
    onClose={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')} />}</View>;
}
