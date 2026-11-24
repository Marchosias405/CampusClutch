import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "@/context/AuthContext";
import { getProfileById, updateProfile } from "@/lib/profiles";
import type { Profile, ProfileUpdateInput } from "@/types";

type ProfileContextValue = {
  profile: Profile | null;
  isLoadingProfile: boolean;
  profileError: string | null;
  isProfileComplete: boolean;
  refreshProfile: () => Promise<void>;
  saveProfile: (input: ProfileUpdateInput) => Promise<Profile>;
};

const ProfileContext = createContext<ProfileContextValue | undefined>(
  undefined
);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Unable to load your profile.";
}

export function ProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isRestoringSession } = useAuth();
  const userId = user?.id ?? null;
  const account = useMemo(() => ({ userId, active: true, read: 0 }), [userId]);
  const [result, setResult] = useState<{
    account: typeof account;
    profile: Profile | null;
    error: string | null;
    loading: boolean;
  } | null>(null);

  const loadProfile = useCallback(async () => {
    if (!account.active || !account.userId) return;
    const read = ++account.read;
    setResult(previous => ({
      account,
      profile: previous?.account === account ? previous.profile : null,
      error: null,
      loading: true,
    }));
    let profile: Profile | null = null;
    let error: string | null = null;
    try {
      profile = await getProfileById(account.userId);
    } catch (cause) {
      error = getErrorMessage(cause);
    }
    if (account.active && account.read === read) {
      setResult({ account, profile, error, loading: false });
    }
  }, [account]);

  useEffect(() => {
    account.active = true;
    if (!account.userId) setResult(null);
    else if (!isRestoringSession) void loadProfile();
    return () => {
      account.active = false;
      account.read++;
    };
  }, [account, isRestoringSession, loadProfile]);

  const saveProfile = useCallback(
    async (input: ProfileUpdateInput) => {
      if (!account.active || !account.userId) {
        throw new Error("You must be signed in to update your profile.");
      }

      const updatedProfile = await updateProfile(account.userId, input);
      if (account.active) {
        // A read started before this save may still return the previous profile.
        account.read++;
        setResult({ account, profile: updatedProfile, error: null, loading: false });
      }

      return updatedProfile;
    },
    [account]
  );
  const current = result?.account === account ? result : null;
  const profile = current?.profile ?? null;
  const profileError = current?.error ?? null;
  const isLoadingProfile = Boolean(userId) && (current?.loading ?? true);
  const isProfileComplete = Boolean(
    profile?.onboardingCompletedAt && profile.displayName
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoadingProfile,
      profileError,
      isProfileComplete,
      refreshProfile: loadProfile,
      saveProfile,
    }),
    [
      profile,
      isLoadingProfile,
      profileError,
      isProfileComplete,
      loadProfile,
      saveProfile,
    ]
  );

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error("useProfile must be used inside ProfileProvider");
  }

  return context;
}
