import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Keyboard, Modal } from 'react-native';
import LegalDocumentScreen from '@/components/LegalDocumentScreen';
import type { LegalDocumentId } from '@/content/legalDocuments';
import { useMotionAllowed } from '@/lib/motionPreference';

type LegalDocuments = { open(id: LegalDocumentId): void };
const Context = createContext<LegalDocuments | null>(null);

// Public, bundled reading screens. Keeping the underlying tree mounted preserves
// form drafts and leaves all session, deletion and suspension gates in place.
export function LegalDocumentsProvider({ children }: { children: React.ReactNode }) {
  const [documentId, setDocumentId] = useState<LegalDocumentId | null>(null);
  const motionAllowed = useMotionAllowed();
  const open = useCallback((id: LegalDocumentId) => {
    Keyboard.dismiss();
    setDocumentId(id);
  }, []);
  const close = useCallback(() => setDocumentId(null), []);
  const value = useMemo(() => ({ open }), [open]);
  return <Context.Provider value={value}>
    {children}
    {documentId !== null && <Modal visible presentationStyle="fullScreen" animationType={motionAllowed ? 'fade' : 'none'}
      statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <LegalDocumentScreen key={documentId} documentId={documentId} onClose={close} onDocument={open} />
    </Modal>}
  </Context.Provider>;
}

export function useLegalDocuments() {
  const context = useContext(Context);
  if (!context) throw new Error('LegalDocumentsProvider is required.');
  return context;
}
