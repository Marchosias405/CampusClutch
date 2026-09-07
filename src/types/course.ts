export type AcademicTermSeason =
  | "spring"
  | "summer"
  | "fall";

export type AcademicTermStatus =
  | "upcoming"
  | "current"
  | "past";

export type CourseCatalogStatus =
  | "active"
  | "closed"
  | "archived";

export type CourseMembershipStatus =
  | "enrolled"
  | "completed"
  | "left";

export type CourseJoinResult =
  | "joined"
  | "already_enrolled"
  | "rejoined";

export type CourseLeaveResult =
  | "left"
  | "already_left";

export type AcademicTerm = {
  id: string;
  code: string;
  displayName: string;
  year: number;
  season: AcademicTermSeason;
  startsOn: string;
  endsOn: string;
  status: AcademicTermStatus;
};

export type CourseCatalogItem = {
  id: string;
  code: string;
  title: string;

  status: CourseCatalogStatus;

  term: AcademicTerm;

  campusId: string | null;
  campusDisplayName: string | null;
};

export type MyCourse = CourseCatalogItem & {
  membershipStatus: CourseMembershipStatus;
  joinedAt: string;
  endedAt: string | null;
};

export type CourseClassmate = {
  profileId: string;
  displayName: string;

  major: string | null;
  yearOfStudy: number | null;

  campusId: string | null;
  campusDisplayName: string | null;

  avatarPath: string | null;

  sharedInterests: string[];
  sharedInterestCount: number;

  sameCampus: boolean;
};
