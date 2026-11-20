export const COURSE_GRADES = ["F", "D", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"] as const;
export type CourseGrade = typeof COURSE_GRADES[number];

export const COURSE_REVIEW_TAGS = [
  "Useful", "Interesting", "Practical skills", "Lots of reading", "Group work",
  "Exam heavy", "Project based", "Participation matters",
] as const;

export type ReviewCursor = { createdAt: string; id: string };

export type CourseReviewInput = {
  termId: string;
  difficulty: number;
  workload: number;
  recommend: boolean;
  grade: CourseGrade | null;
  comment: string;
  tips: string;
  instructor: string;
  tags: string[];
};

export type CourseReview = CourseReviewInput & {
  id: string;
  termName: string;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
  isHidden?: boolean;
};

export type CourseReviewSummary = {
  courseCode: string;
  title: string;
  reviewCount: number;
  averageDifficulty: number | null;
  averageWorkload: number | null;
  recommendPercent: number | null;
  gradeCounts: { grade: CourseGrade; count: number }[];
  topTags: { tag: string; count: number }[];
  eligibleTerms: { id: string; displayName: string }[];
  myReviews: CourseReview[];
};
