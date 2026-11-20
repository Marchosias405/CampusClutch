import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { AppState } from 'react-native';
import { useModerationAccess } from './useModerationAccess';
import type { DirectTarget } from './directModeration';

// One live role check per screen, even when it contains many review cards.
export function useDirectAdmin(userId: string) {
  const access = useModerationAccess(userId);
  const router = useRouter();
  const allowed = access.status === 'allowed' && access.role === 'admin';
  const latest = useRef(allowed);
  latest.current = allowed;
  return { allowed, open(target: DirectTarget, id: string) {
    if (!latest.current || (AppState.currentState && AppState.currentState !== 'active')) return;
    router.push({ pathname: '/moderation/direct', params: { targetType: target, targetId: id } });
  } };
}
