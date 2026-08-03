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