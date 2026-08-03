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

  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoadingProfileState, setIsLoadingProfile] = useState(false);
  const [loadedProfileUserId, setLoadedProfileUserId] = useState<string | null>(
    null
    );
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user) {
    setProfile(null);
    setProfileError(null);
    setLoadedProfileUserId(null);
    setIsLoadingProfile(false);
    return;
    }

    const profileUserId = user.id;

    setIsLoadingProfile(true);
    setProfileError(null);

    try {
      const nextProfile = await getProfileById(profileUserId);
      setProfile(nextProfile);
    } catch (error) {
      setProfile(null);
      setProfileError(getErrorMessage(error));
    } finally {
      setLoadedProfileUserId(profileUserId);
      setIsLoadingProfile(false);
    }
  }, [user]);

  useEffect(() => {
    if (isRestoringSession) {
      return;
    }

    void loadProfile();
  }, [isRestoringSession, loadProfile]);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const saveProfile = useCallback(
    async (input: ProfileUpdateInput) => {
      if (!user) {
        throw new Error("You must be signed in to update your profile.");
      }

      const updatedProfile = await updateProfile(user.id, input);

      setProfile(updatedProfile);
      setProfileError(null);

      return updatedProfile;
    },
    [user]
  );
  const isLoadingProfile =
    user !== null &&
    (isLoadingProfileState || loadedProfileUserId !== user.id);
  const isProfileComplete = Boolean(
    profile?.onboardingCompletedAt && profile.displayName
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoadingProfile,
      profileError,
      isProfileComplete,
      refreshProfile,
      saveProfile,
    }),
    [
      profile,
      isLoadingProfile,
      profileError,
      isProfileComplete,
      refreshProfile,
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