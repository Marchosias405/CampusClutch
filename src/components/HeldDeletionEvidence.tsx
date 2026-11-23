import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ModerationButton, moderationStyles as styles } from './ModerationShell';
import { moderationAccessLost } from '../lib/moderation';
import { loadDeletionEvidence } from '../lib/retentionHolds';
import type { EvidenceItem, TargetKind } from '../lib/retentionHolds';

export default function HeldDeletionEvidence({ user, kind, id, invalidate }: {
  user: string; kind: TargetKind; id: string; invalidate(): void;
}) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [older, setOlder] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function open(before?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      const next = await loadDeletionEvidence(user, kind, id, before);
      if (alive.current) { setItems(next); setOlder(Boolean(before)); }
    } catch (cause) {
      if (!alive.current) return;
      setItems(null); setOlder(false);
      if (moderationAccessLost(cause)) invalidate();
      else setError(true);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <View style={styles.card}>
    <Text style={styles.subheading}>Evidence from account deletion</Text>
    {error && <Text accessibilityLiveRegion="polite" style={styles.error}>Couldn’t load the evidence. Try again.</Text>}
    {items === null && <ModerationButton title={busy ? 'Loading evidence…' : 'View held evidence'}
      disabled={busy} onPress={() => { void open(); }} />}
    {items !== null && <>
      {items.length === 0 && <Text style={styles.body}>{older ? 'End of evidence.' : 'No deletion evidence is available for these holds.'}</Text>}
      {items.map(item => <View key={item.id} style={{ gap: 4 }}>
        <Text style={styles.subheading}>{item.label}</Text>
        <Text style={styles.small}>Saved {new Date(item.captured_at).toLocaleString()}</Text>
        {Object.entries(item.fields).map(([name, value]) => <View key={name}>
          <Text style={styles.small}>{name}</Text>
          <Text style={styles.value}>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</Text>
        </View>)}
      </View>)}
      {items.length === 20 && <ModerationButton title="Older evidence" disabled={busy}
        onPress={() => { void open(items[items.length - 1].id); }} />}
      {older && <ModerationButton title="Most recent evidence" disabled={busy} onPress={() => { void open(); }} />}
      <ModerationButton title="Hide evidence" disabled={busy} onPress={() => { setItems(null); setOlder(false); }} />
    </>}
  </View>;
}
