import React, { forwardRef, useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Pressable, StyleSheet, View,
  type PressableProps, type StyleProp, type TextStyle, type ViewProps,
} from 'react-native';
import { useMotionAllowed } from '@/lib/motionPreference';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const easeOut = Easing.out(Easing.cubic);

function move(value: Animated.Value, target: number, duration: number, allowed: boolean) {
  value.stopAnimation();
  if (!allowed) value.setValue(target);
  else Animated.timing(value, {
    toValue: target, duration, easing: easeOut, useNativeDriver: true, isInteraction: false,
  }).start();
}

/** Visual feedback only: the original press action runs immediately and exactly once. */
export const MotionPressable = forwardRef<View, PressableProps>(function MotionPressable(
  { style, disabled, onPressIn, onPressOut, onHoverIn, onHoverOut, ...props }, ref,
) {
  const allowed = useMotionAllowed();
  const scale = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!allowed || disabled) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    if (disabled) setPressed(false);
    return () => scale.stopAnimation();
  }, [allowed, disabled, scale]);
  const resolvedStyle = typeof style === 'function' ? style({ pressed: pressed && !disabled, hovered: hovered && !disabled }) : style;
  const transform = StyleSheet.flatten(resolvedStyle)?.transform;
  return <AnimatedPressable {...props} ref={ref} disabled={disabled}
    style={[resolvedStyle, { transform: [...(Array.isArray(transform) ? transform : []), { scale }] }]}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    onPressIn={event => {
      if (disabled) return;
      setPressed(true);
      move(scale, allowed ? 0.98 : 1, 90, allowed);
      onPressIn?.(event);
    }}
    onPressOut={event => {
      setPressed(false);
      move(scale, 1, 140, allowed && !disabled);
      onPressOut?.(event);
    }} />;
});

/** Brief entry cue for newly revealed guidance/badges; no delayed unmount or hidden controls. */
export function MotionReveal({ style, ...props }: ViewProps) {
  const allowed = useMotionAllowed();
  const opacity = useRef(new Animated.Value(allowed ? 0 : 1)).current;
  const entered = useRef(false);
  useEffect(() => {
    if (!entered.current) {
      entered.current = true;
      move(opacity, 1, 160, allowed);
    } else if (!allowed) {
      move(opacity, 1, 0, false);
    }
    return () => opacity.stopAnimation();
  }, [allowed, opacity]);
  return <Animated.View {...props} style={[style, { opacity }]} />;
}

function useSelectionProgress(active: boolean) {
  const allowed = useMotionAllowed();
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    move(progress, active ? 1 : 0, 160, allowed);
    return () => progress.stopAnimation();
  }, [active, allowed, progress]);
  return progress;
}

/** The selected tab changes colour immediately; this adds a small focus cue. */
export function MotionSelection({ active, style, ...props }: ViewProps & { active: boolean }) {
  const progress = useSelectionProgress(active);
  return <Animated.View {...props} style={[style, {
    transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
  }]} />;
}

export function MotionChevron({ expanded, style }: { expanded: boolean; style?: StyleProp<TextStyle> }) {
  const progress = useSelectionProgress(expanded);
  return <Animated.Text accessible={false} importantForAccessibility="no"
    style={[style, { transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }]}>›</Animated.Text>;
}
