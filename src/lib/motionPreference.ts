import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// One native subscription for the whole app, including large groups of chips.
// Until the device preference is known, render the complete static interface.
let allowed = false;
let version = 0;
let nativeSubscription: { remove(): void } | undefined;
const listeners = new Set<() => void>();

function update(reduced: boolean) {
  const next = reduced === false;
  if (allowed === next) return;
  allowed = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const ticket = ++version;
    nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      ++version; // A live change wins over a slower initial preference read.
      update(reduced);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (ticket === version && listeners.size > 0) update(reduced);
    }).catch(() => { /* Keep the static interface if the preference is unavailable. */ });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      ++version;
      nativeSubscription?.remove();
      nativeSubscription = undefined;
      allowed = false;
    }
  };
}

export function useMotionAllowed() {
  return useSyncExternalStore(subscribe, () => allowed, () => false);
}
