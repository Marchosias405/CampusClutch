import React, { createContext, useContext, useMemo, useState } from "react";
import { mockRequests } from "../constants/mockData";
import type { CampusRequest } from "../types";

type NewCampusRequest = Omit<CampusRequest, "id">;

type RequestsContextValue = {
  requests: CampusRequest[];
  addRequest: (request: NewCampusRequest) => CampusRequest;
};

const RequestsContext = createContext<RequestsContextValue | undefined>(
  undefined
);

export function RequestsProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<CampusRequest[]>(mockRequests);

  const addRequest = (request: NewCampusRequest) => {
    const newRequest: CampusRequest = {
      id: `request-${Date.now()}`,
      ...request,
    };

    setRequests((currentRequests) => [newRequest, ...currentRequests]);

    return newRequest;
  };

  const value = useMemo(() => {
    return {
      requests,
      addRequest,
    };
  }, [requests]);

  return (
    <RequestsContext.Provider value={value}>
      {children}
    </RequestsContext.Provider>
  );
}

export function useRequests() {
  const context = useContext(RequestsContext);

  if (!context) {
    throw new Error("useRequests must be used inside RequestsProvider");
  }

  return context;
}