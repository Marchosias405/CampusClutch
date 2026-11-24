import { Ionicons } from '@expo/vector-icons';
import { NavigationContext } from '@react-navigation/native';
import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  Animated, AppState, Easing, Platform, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useMotionAllowed } from '@/lib/motionPreference';

/** One native loop per loading group; stop when its route or app is no longer visible. */
function useLoadingPulse() {
  const allowed = useMotionAllowed();
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const phase = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const updateFocus = () => setFocused(navigation?.isFocused() ?? true);
    updateFocus();
    const focus = navigation?.addListener('focus', updateFocus);
    const blur = navigation?.addListener('blur', updateFocus);
    return () => { focus?.(); blur?.(); };
  }, [navigation]);

  useEffect(() => {
    const state = AppState.addEventListener('change', value => setForeground(value === 'active'));
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => setForeground(false)) : undefined;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => setForeground(AppState.currentState === 'active')) : undefined;
    return () => { state.remove(); blur?.remove(); focus?.remove(); };
  }, []);

  useEffect(() => {
    if (!allowed || !focused || !foreground) {
      phase.stopAnimation();
      phase.setValue(0.5);
      return;
    }
    phase.setValue(0);
    // The start/end opacity is identical, so a native loop resets without a flash.
    const loop = Animated.loop(Animated.timing(phase, {
      toValue: 1, duration: 1800, easing: Easing.linear,
      useNativeDriver: true, isInteraction: false,
    }));
    loop.start();
    return () => { loop.stop(); phase.stopAnimation(); phase.setValue(0.5); };
  }, [allowed, focused, foreground, phase]);

  return phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] });
}

export type SkeletonVariant = 'courses' | 'requests' | 'people' | 'inbox' | 'conversation'
  | 'profile' | 'reviews' | 'points' | 'interests' | 'details';

function Block({ width = '100%', height = 14, radius = 7, style }: {
  width?: ViewStyle['width']; height?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.block, { width, height, borderRadius: radius }, style]} />;
}

function Chips() {
  return <View style={styles.wrap}><Block width={88} height={36} radius={18} /><Block width={104} height={36} radius={18} /><Block width={76} height={36} radius={18} /></View>;
}

function Card({ request = false }: { request?: boolean }) {
  return <View style={styles.card}>
    <Block width="42%" height={22} /><Block width="88%" /><Block width="64%" />
    {request ? <View style={styles.wrap}><Block width={84} height={28} /><Block width={72} height={28} /></View>
      : <><Block width="32%" /><Block width={108} height={18} style={styles.footer} /></>}
  </View>;
}

function PersonRow() {
  return <View style={styles.personRow}>
    <Block width={48} height={48} radius={24} />
    <View style={styles.flexLines}><Block width="58%" height={18} /><Block width="86%" /><Block width="38%" height={11} /></View>
  </View>;
}

function SkeletonContent({ variant, rows }: { variant: SkeletonVariant; rows: number }) {
  if (variant === 'interests') return <View style={styles.group}><Chips /><Chips /></View>;
  if (variant === 'points') return <View style={styles.group}>
    <Block width="64%" height={34} />
    <View style={styles.wrap}><Block width={92} height={44} /><Block width={112} height={44} /></View>
    <Block width="45%" height={18} /><PersonRow /><PersonRow />
  </View>;
  if (variant === 'profile') return <View style={styles.group}>
    <View style={styles.profileHero}><Block width={84} height={84} radius={42} /><View style={styles.flexLines}><Block width="72%" height={26} /><Block width="48%" /></View></View>
    <View style={styles.card}><Block width="40%" height={20} /><Chips /><Block width="85%" /><Block width="60%" /></View>
    <View style={styles.card}><Block width="45%" height={20} /><Block width="70%" height={32} /><Block width="90%" /></View>
  </View>;
  if (variant === 'conversation') return <View style={styles.group}>
    {Array.from({ length: Math.min(rows * 2, 8) }, (_, index) => <View key={index} style={[styles.bubbleGroup, index % 2 === 1 && styles.bubbleRight]}>
      <Block width={index % 3 === 0 ? '66%' : '48%'} height={index % 3 === 0 ? 62 : 42} radius={18} />
      <Block width="23%" height={10} />
    </View>)}
  </View>;
  if (variant === 'reviews') return <View style={styles.group}>
    <Block width="36%" height={28} /><Block width="84%" height={18} />
    <View style={styles.card}>
      <Block width="44%" height={20} />
      <View style={styles.metricRow}>{[0, 1, 2].map(index => <View key={index} style={styles.metric}><Block width="68%" height={30} /><Block width="90%" height={12} /></View>)}</View>
      <Block height={96} radius={14} />
    </View>
    {Array.from({ length: rows }, (_, index) => <Card key={index} />)}
  </View>;
  if (variant === 'details') return <View style={styles.group}>
    <Block width="80%" height={28} /><Block width="45%" />
    <View style={styles.card}><Block width="38%" height={18} /><Block /><Block width="92%" /><Block width="72%" /></View>
    <View style={styles.card}><Block width="48%" height={20} /><PersonRow /><Block width="60%" /></View>
  </View>;
  return <View style={styles.group}>{Array.from({ length: rows }, (_, index) =>
    variant === 'people' || variant === 'inbox' ? <PersonRow key={index} /> : <Card key={index} request={variant === 'requests'} />
  )}</View>;
}

/** Layout placeholders only: no fake people, balances, ratings or interactive controls. */
export function LoadingSkeleton({ variant, label, rows = 3, style }: {
  variant: SkeletonVariant; label: string; rows?: number; style?: StyleProp<ViewStyle>;
}) {
  const opacity = useLoadingPulse();
  const count = Number.isFinite(rows) ? Math.max(1, Math.min(5, Math.floor(rows))) : 3;
  return <View style={[styles.skeleton, style]} pointerEvents="none" accessible
    accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <Text style={styles.caption}>{label}</Text>
    <Animated.View style={{ opacity }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SkeletonContent variant={variant} rows={count} />
    </Animated.View>
  </View>;
}

/** A branded buffer for real startup/access checks; never inserts an artificial wait. */
export function LoadingState({ title, detail, fullScreen = false }: {
  title: string; detail?: string; fullScreen?: boolean;
}) {
  const opacity = useLoadingPulse();
  return <View style={[styles.waiting, fullScreen && styles.fullScreen]} accessible
    accessibilityRole="progressbar" accessibilityLabel={detail ? `${title}. ${detail}` : title}
    accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <View style={styles.emblem} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.halo, { opacity }]} />
      <View style={styles.icon}><Ionicons name="school-outline" size={34} color="#9B1C31" /></View>
    </View>
    <Text style={styles.waitingTitle}>{title}</Text>
    {!!detail && <Text style={styles.waitingDetail}>{detail}</Text>}
  </View>;
}

/** Non-blocking feedback while already loaded content remains on screen. */
export function LoadingNotice({ label }: { label: string }) {
  const opacity = useLoadingPulse();
  return <View style={styles.notice} pointerEvents="none" accessible accessibilityRole="progressbar"
    accessibilityLabel={label} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <Animated.View style={{ opacity }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="hourglass-outline" size={18} color="#9B1C31" />
    </Animated.View>
    <Text style={styles.noticeLabel}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  skeleton: { width: '100%', gap: 14, paddingVertical: 8 },
  caption: { color: '#635C5C', fontSize: 14, lineHeight: 21 },
  block: { backgroundColor: '#E9DEE1', maxWidth: '100%' },
  group: { gap: 16 },
  card: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: '#ECE3E3', backgroundColor: '#FFFFFF', gap: 12 },
  footer: { marginTop: 6 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0E8EA' },
  flexLines: { flex: 1, minWidth: 0, gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 14 },
  bubbleGroup: { alignItems: 'flex-start', gap: 8, paddingVertical: 6 },
  bubbleRight: { alignItems: 'flex-end' },
  metricRow: { flexDirection: 'row', gap: 12 }, metric: { flex: 1, minWidth: 0, gap: 8 },
  waiting: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 12 },
  fullScreen: { flex: 1, backgroundColor: '#FFFFFF', width: '100%' },
  emblem: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  halo: { position: 'absolute', width: 104, height: 104, borderRadius: 52, backgroundColor: '#F7E7EB' },
  icon: { width: 76, height: 76, borderRadius: 26, backgroundColor: '#FFF8FA', alignItems: 'center', justifyContent: 'center' },
  waitingTitle: { fontSize: 20, lineHeight: 28, fontWeight: '800', color: '#2B2525', textAlign: 'center' },
  waitingDetail: { maxWidth: 360, fontSize: 15, lineHeight: 23, color: '#635C5C', textAlign: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  noticeLabel: { flex: 1, color: '#635C5C', fontSize: 14, lineHeight: 21 },
});
