import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getModerationAccess } from './moderation';
import type { StaffRole } from './moderation';

type Access = { status: 'checking' | 'allowed' | 'denied' | 'unavailable' | 'hidden'; role: StaffRole | null };
export function useModerationAccess(userId: string) {
  const [access, setAccess] = useState<Access>({ status: 'checking', role: null });
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const invalidate = useCallback(() => {
    ++epoch.current;
    setAccess({ status: 'unavailable', role: null });
  }, []);
  useFocusEffect(useCallback(() => {
    // Changing this value deliberately restarts the focused access check.
    void retry;
    let focused = true;
    let running = false;
    let current = ++epoch.current;
    const foreground = () => !AppState.currentState || AppState.currentState === 'active';
    const check = async (initial: boolean) => {
      if (!focused || !foreground() || running || current !== epoch.current) return;
      running = true;
      const ticket = current;
      if (initial) setAccess({ status: 'checking', role: null });
      try {
        const role = await getModerationAccess(userId);
        if (focused && foreground() && ticket === epoch.current) setAccess({ status: role ? 'allowed' : 'denied', role });
      } catch {
        if (focused && foreground() && ticket === epoch.current) setAccess({ status: 'unavailable', role: null });
      } finally { if (ticket === current) running = false; }
    };
    const subscription = AppState.addEventListener('change', next => {
      current = ++epoch.current;
      running = false;
      setAccess({ status: 'hidden', role: null });
      if (next === 'active') void check(true);
    });
    setAccess({ status: foreground() ? 'checking' : 'hidden', role: null });
    void check(true);
    const timer = setInterval(() => { void check(false); }, 30000);
    return () => {
      focused = false; ++epoch.current;
      clearInterval(timer); subscription.remove();
      setAccess({ status: 'hidden', role: null });
    };
  }, [userId, retry]));
  return { ...access, invalidate, retry: () => setRetry(value => value + 1) };
}
