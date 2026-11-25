import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMotionAllowed } from '@/lib/motionPreference';
import { LEGAL_DRAFT_DATE, LEGAL_DRAFT_NOTICE, legalDocuments, privacyEmail, type LegalDocumentId } from '@/content/legalDocuments';
import ScreenHeader from './ScreenHeader';
import ProfileActionRow from './ProfileActionRow';

export default function LegalDocumentScreen({ documentId, onClose, onDocument }: {
  documentId: LegalDocumentId;
  onClose(): void;
  onDocument(id: LegalDocumentId): void;
}) {
  const document = legalDocuments[documentId];
  const other = documentId === 'privacy' ? 'terms' : 'privacy';
  const insets = useSafeAreaInsets();
  const motionAllowed = useMotionAllowed();
  const scroll = useRef<ScrollView>(null);
  const [mailError, setMailError] = useState(false);
  async function openEmail() {
    if (!privacyEmail) return;
    setMailError(false);
    try {
      const [recipient, domain] = privacyEmail.split('@');
      await Linking.openURL(`mailto:${encodeURIComponent(recipient)}@${domain}?subject=Clu%20privacy%20request`);
    } catch {
      setMailError(true);
    }
  }
  return <View style={styles.screen} accessibilityViewIsModal>
    <StatusBar style="light" />
    <ScreenHeader>
      <Text accessibilityRole="header" style={styles.headerTitle}>{document.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Close ${document.title}`}
        onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
        <Ionicons name="close" size={26} color="#FFFFFF" />
      </Pressable>
    </ScreenHeader>
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={[styles.content,
      { paddingBottom: Math.max(insets.bottom + 24, 40) }]} showsVerticalScrollIndicator>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Preview draft</Text>
        <Text style={styles.noticeText}>{LEGAL_DRAFT_NOTICE}</Text>
        <Text style={styles.version}>Updated {LEGAL_DRAFT_DATE}</Text>
      </View>
      <Text style={styles.introduction}>{document.introduction}</Text>
      {document.sections.map(section => <View key={section.title} style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
        {section.paragraphs.map(paragraph => <Text selectable key={paragraph} style={styles.body}>{paragraph}</Text>)}
        {section.showPrivacyContact && privacyEmail && <>
          <Text selectable style={styles.body}>{privacyEmail}</Text>
          <ProfileActionRow label="Email the privacy team" icon="mail-outline" onPress={openEmail} />
          {mailError && <Text accessibilityLiveRegion="polite" style={styles.body}>
            Couldn’t open your email app. Copy the address above into a new email.
          </Text>}
        </>}
      </View>)}
      <View style={styles.footer}>
        <ProfileActionRow label={`Read ${legalDocuments[other].title}`} icon={other === 'privacy' ? 'lock-closed-outline' : 'document-text-outline'}
          onPress={() => onDocument(other)} />
        <ProfileActionRow label="Back to top" icon="arrow-up-outline" chevron={false}
          onPress={() => scroll.current?.scrollTo({ y: 0, animated: motionAllowed })} />
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  headerTitle: { flex: 1, minWidth: 0, color: '#FFFFFF', fontSize: 22, lineHeight: 30, fontWeight: '800' },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  pressed: { opacity: 0.65 },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, gap: 24 },
  notice: { backgroundColor: '#FBF1F3', borderColor: '#E8CDD3', borderWidth: 1, borderRadius: 16, padding: 18, gap: 8 },
  noticeTitle: { color: '#9B1C31', fontSize: 16, lineHeight: 22, fontWeight: '800' },
  noticeText: { color: '#5F4249', fontSize: 15, lineHeight: 23 },
  version: { color: '#635C5C', fontSize: 13, lineHeight: 20 },
  introduction: { color: '#635C5C', fontSize: 16, lineHeight: 25 },
  section: { gap: 12 },
  sectionTitle: { color: '#2B2525', fontSize: 20, lineHeight: 28, fontWeight: '800' },
  body: { color: '#3D3737', fontSize: 16, lineHeight: 26 },
  footer: { gap: 12, paddingTop: 8 },
});
