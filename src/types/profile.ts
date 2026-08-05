export type Campus = {
  id: string;
  slug: string;
  displayName: string;
};

export type Interest = {
  id: string;
  slug: string;
  displayName: string;
  isActive: boolean;
};

export type Profile = {
  id: string;
  displayName: string | null;
  major: string | null;
  yearOfStudy: number | null;
  campusId: string | null;
  avatarPath: string | null;
  isDiscoverable: boolean;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileUpdateInput = {
  displayName?: string;
  major?: string | null;
  yearOfStudy?: number | null;
  campusId?: string | null;
  avatarPath?: string | null;
  isDiscoverable?: boolean;
};

export type SocialPlatform = "linkedin" | "instagram";

export type ProfileSocialLink = {
  profileId: string;
  platform: SocialPlatform;
  value: string;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProfileSocialLinks = {
  linkedin: ProfileSocialLink | null;
  instagram: ProfileSocialLink | null;
};

export type ProfileSocialLinksInput = {
  linkedinValue: string;
  linkedinVisible: boolean;
  instagramValue: string;
  instagramVisible: boolean;
};