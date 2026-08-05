import { supabase } from "@/lib/supabase";
import type {
  Campus,
  Interest,
  Profile,
  ProfileUpdateInput,
} from "@/types";

type ProfileRow = {
  id: string;
  display_name: string | null;
  major: string | null;
  year_of_study: number | null;
  campus_id: string | null;
  avatar_path: string | null;
  is_discoverable: boolean;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type CampusRow = {
  id: string;
  slug: string;
  display_name: string;
};

type InterestRow = {
  id: string;
  slug: string;
  display_name: string;
  is_active: boolean;
};

const PROFILE_SELECT = `
  id,
  display_name,
  major,
  year_of_study,
  campus_id,
  avatar_path,
  is_discoverable,
  onboarding_completed_at,
  created_at,
  updated_at
`;


function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    major: row.major,
    yearOfStudy: row.year_of_study,
    campusId: row.campus_id,
    avatarPath: row.avatar_path,
    isDiscoverable: row.is_discoverable,
    onboardingCompletedAt: row.onboarding_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCampus(row: CampusRow): Campus {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
  };
}

function mapInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    isActive: row.is_active,
  };
}

export async function getProfileById(
  profileId: string
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapProfile(data as ProfileRow) : null;
}

export async function updateProfile(
  profileId: string,
  input: ProfileUpdateInput
): Promise<Profile> {
  const payload: Record<string, unknown> = {};

  if (input.displayName !== undefined) {
    payload.display_name = input.displayName;
  }

  if (input.major !== undefined) {
    payload.major = input.major;
  }

  if (input.yearOfStudy !== undefined) {
    payload.year_of_study = input.yearOfStudy;
  }

  if (input.campusId !== undefined) {
    payload.campus_id = input.campusId;
  }

  if (input.avatarPath !== undefined) {
    payload.avatar_path = input.avatarPath;
  }

  if (input.isDiscoverable !== undefined) {
    payload.is_discoverable = input.isDiscoverable;
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("id", profileId)
    .select(PROFILE_SELECT)
    .single();

  if (error) {
    throw error;
  }

  return mapProfile(data as ProfileRow);
}

export async function getCampuses(): Promise<Campus[]> {
  const { data, error } = await supabase
    .from("campuses")
    .select("id, slug, display_name")
    .order("display_name");

  if (error) {
    throw error;
  }

  return (data as CampusRow[]).map(mapCampus);
}

export async function getInterests(): Promise<Interest[]> {
  const { data, error } = await supabase
    .from("interests")
    .select("id, slug, display_name, is_active")
    .eq("is_active", true)
    .order("display_name");

  if (error) {
    throw error;
  }

  return (data as InterestRow[]).map(mapInterest);
}

export async function getProfileInterests(
  profileId: string
): Promise<Interest[]> {
  const { data, error } = await supabase
    .from("profile_interests")
    .select(
      `
        interests (
          id,
          slug,
          display_name,
          is_active
        )
      `
    )
    .eq("profile_id", profileId);

  if (error) {
    throw error;
  }

  return data.flatMap((row) => {
    const interest = row.interests;

    if (!interest || Array.isArray(interest)) {
      return [];
    }

    return [mapInterest(interest as InterestRow)];
  });
}

export async function replaceProfileInterests(
  profileId: string,
  interestIds: string[]
): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user || user.id !== profileId) {
    throw new Error("You can only update your own profile interests.");
  }

  const uniqueInterestIds = [...new Set(interestIds)];

  const { error } = await supabase.rpc("replace_my_profile_interests", {
    p_interest_ids: uniqueInterestIds,
  });

  if (error) {
    throw error;
  }
}