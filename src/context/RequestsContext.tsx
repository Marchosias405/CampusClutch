import React, { createContext, useContext, useState, useCallback } from 'react';
import { saveRequest } from '../lib/requests';
import type { CampusRequest } from '../types';
type RequestsContextValue = {
  revision: number;
  invalidate: () => void;
  addRequest: (request: Omit<CampusRequest, 'id'>, id?: string) => Promise<string>;
};
const RequestsContext = createContext<RequestsContextValue | undefined>(undefined);
export function RequestsProvider({ children }: { children: React.ReactNode }) {
  const [revision, setRevision] = useState(0);
  const invalidate = useCallback(() => setRevision(value => value + 1), []);
  const addRequest = async (request: Omit<CampusRequest, 'id'>, id?: string) => {
    const savedId = await saveRequest(request, id);
    invalidate();
    return savedId;
  };
  return <RequestsContext.Provider value={{ revision, invalidate, addRequest }}>{children}</RequestsContext.Provider>;
}
export function useRequests() {
  const context = useContext(RequestsContext);
  if (!context) throw new Error('useRequests must be used inside RequestsProvider');
  return context;
}
