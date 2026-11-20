import { updateProfile } from "@/lib/profiles";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};


export type ReplaceProfileAvatarResult = {
  profile: Profile;
  oldAvatarCleanupFailed: boolean;
};

async function requireOwnProfile(profileId: string) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user || user.id !== profileId) {
    throw new Error("You can only manage your own profile photo.");
  }
}

function normalizeMimeType(mimeType: string | null | undefined) {
  const normalized = mimeType?.trim().toLowerCase();

  if (!normalized || !AVATAR_EXTENSIONS[normalized]) {
    throw new Error(
      "Choose a JPEG, PNG, or WebP image."
    );
  }

  return normalized;
}

function createAvatarPath(profileId: string, mimeType: string) {
  const extension = AVATAR_EXTENSIONS[mimeType];

  const uniquePart =
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${profileId}/${uniquePart}.${extension}`;
}

function assertOwnedAvatarPath(profileId: string, avatarPath: string) {
  if (!avatarPath.startsWith(`${profileId}/`)) {
    throw new Error("Invalid profile photo path.");
  }
}

export async function uploadProfileAvatar(
  profileId: string,
  imageUri: string,
  mimeType: string | null | undefined
): Promise<string> {
  await requireOwnProfile(profileId);

  const normalizedMimeType = normalizeMimeType(mimeType);

  const response = await fetch(imageUri);
  const arrayBuffer = await response.arrayBuffer();

  if (arrayBuffer.byteLength === 0) {
    throw new Error("The selected image is empty.");
  }

  if (arrayBuffer.byteLength > MAX_AVATAR_BYTES) {
    throw new Error("Profile photos must be 5 MB or smaller.");
  }

  const avatarPath = createAvatarPath(
    profileId,
    normalizedMimeType
  );

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(avatarPath, arrayBuffer, {
      contentType: normalizedMimeType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return data.path;
}

export async function deleteProfileAvatar(
  profileId: string,
  avatarPath: string
): Promise<void> {
  await requireOwnProfile(profileId);
  assertOwnedAvatarPath(profileId, avatarPath);

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .remove([avatarPath]);

  if (error) {
    throw error;
  }
}

export async function getProfileAvatarSignedUrl(
  avatarPath: string,
  expiresInSeconds = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(avatarPath, expiresInSeconds);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function replaceProfileAvatar(
  profileId: string,
  currentAvatarPath: string | null,
  imageUri: string,
  mimeType: string | null | undefined
): Promise<ReplaceProfileAvatarResult> {
  const newAvatarPath = await uploadProfileAvatar(
    profileId,
    imageUri,
    mimeType
  );

  let updatedProfile: Profile;

  try {
    updatedProfile = await updateProfile(profileId, {
      avatarPath: newAvatarPath,
    });

    if (updatedProfile.avatarPath !== newAvatarPath) {
      throw new Error(
        "The profile photo update could not be confirmed."
      );
    }
  } catch (error) {
    try {
      await deleteProfileAvatar(profileId, newAvatarPath);
    } catch (cleanupError) {
      const originalMessage =
        error instanceof Error
          ? error.message
          : "Profile photo update failed.";

      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : "Uploaded file cleanup failed.";

      throw new Error(
        `${originalMessage} The new upload could not be cleaned up: ${cleanupMessage}`
      );
    }

    throw error;
  }

  let oldAvatarCleanupFailed = false;

  if (
    currentAvatarPath &&
    currentAvatarPath !== newAvatarPath
  ) {
    try {
      await deleteProfileAvatar(
        profileId,
        currentAvatarPath
      );
    } catch {
      // The new avatar is already safely stored and confirmed in the
      // profile row. An old private object remaining behind should not
      // make the successful profile update appear to have failed.
      oldAvatarCleanupFailed = true;
    }
  }

  return {
    profile: updatedProfile,
    oldAvatarCleanupFailed,
  };
}