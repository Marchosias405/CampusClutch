import { MotionPressable as Pressable, MotionReveal, MotionChevron } from '@/components/motion';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Secondary guidance stays nearby without competing with the main task. */
export default function DetailsDisclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
      <Text style={styles.label}>{title}</Text>
      <MotionChevron expanded={expanded} style={styles.indicator} />
    </Pressable>
    {expanded && <MotionReveal style={styles.details}>{children}</MotionReveal>}
  </View>;
}

const styles = StyleSheet.create({
  control: { minHeight: 48, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, color: '#9B1C31', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  indicator: { color: '#9B1C31', fontSize: 22, lineHeight: 26 },
  pressed: { opacity: 0.65 },
  details: { gap: 10, paddingBottom: 12 },
});
