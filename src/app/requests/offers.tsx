import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import RequestOffers from '../../components/RequestOffers';
import { useAuth } from '../../context/AuthContext';

export default function OffersScreen() {
  const router = useRouter();
  const { user } = useAuth();
  return <View style={{ flex: 1, backgroundColor: 'white' }}>
    <ScreenHeader>
      <Pressable accessibilityLabel="Back to requests" hitSlop={12} onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color="white" /></Pressable>
      <Text style={{ color: 'white', fontSize: 20, fontWeight: '800' }}>My offers</Text>
      <View style={{ width: 24 }} />
    </ScreenHeader>
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}><RequestOffers key={user?.id} /></ScrollView>
  </View>;
}
