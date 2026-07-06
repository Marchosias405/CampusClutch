export type CourseStatus = "current" | "previous";

export type Course = {
  id: string;
  code: string;
  title: string;
  term: string;
  status: CourseStatus;
  studentCount: number;
  icon: string;
  classmates?: string[];
};

export type Student = {
  id: string;
  name: string;
  major: string;
  year: string;
  campus: string;
  avatar: string;
  sharedInterests: string[];
  matchLabel?: string;
  sharedCourseNote?: string;
  activityNote?: string;
  isRecentlyActive?: boolean;
};

export type RequestCategory =
  | "ALL"
  | "DELIVERY"
  | "EVENT HELP"
  | "PICKUP"
  | "STUDY HELP";

export type CampusRequest = {
  id: string;
  category: Exclude<RequestCategory, "ALL">;
  secondaryCategory?: string;
  title: string;
  description: string;
  location: string;
  timeLabel: string;
  points: number;
  isUrgent?: boolean;
};