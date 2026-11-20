import { supabase } from "@/lib/supabase";
import { COURSE_GRADES, COURSE_REVIEW_TAGS } from "@/types/courseReview";
import type { CourseGrade, CourseReview, CourseReviewInput, CourseReviewSummary, ReviewCursor } from "@/types/courseReview";

export const COURSE_REVIEWS_PAGE_SIZE = 20;

type ReviewRow = {
  id: string; term_id: string; term_name: string; difficulty: number; workload: number;
  recommend: boolean; grade: CourseGrade | null; comment: string; tips: string | null;
  instructor: string | null; tags: string[]; created_at: string; updated_at: string; is_mine: boolean; is_hidden?: boolean;
};
type SummaryRow = {
  course_code: string; title: string; review_count: number; average_difficulty: number | null;
  average_workload: number | null; recommend_percent: number | null;
  grade_counts: { grade: CourseGrade; count: number }[];
  top_tags: { tag: string; count: number }[];
  eligible_terms: { id: string; display_name: string }[]; my_reviews: ReviewRow[];
};

function mapReview(row: ReviewRow): CourseReview {
  return {
    id: row.id, termId: row.term_id, termName: row.term_name,
    difficulty: row.difficulty, workload: row.workload, recommend: row.recommend,
    grade: row.grade, comment: row.comment, tips: row.tips ?? "", instructor: row.instructor ?? "",
    tags: row.tags ?? [], createdAt: row.created_at, updatedAt: row.updated_at, isMine: row.is_mine,
    isHidden: row.is_hidden === true,
  };
}

function normalizeCode(code: string) {
  const normalized = code.trim().replace(/\s+/g, " ").toUpperCase();
  if (normalized.length < 2 || normalized.length > 32) throw new Error("Choose a valid course.");
  return normalized;
}

async function reviewSession(expectedUserId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!expectedUserId || data.session?.user.id.toLowerCase() !== expectedUserId.toLowerCase()
    || !data.session.access_token) {
    throw new Error("Your account changed. Reopen this screen before continuing.");
  }
  return data.session.access_token;
}

async function reviewRpc(name: string, args: Record<string, unknown>, expectedUserId: string) {
  // Pin the dispatch to the account that opened this screen, then reject stale responses.
  const token = await reviewSession(expectedUserId);
  const { data, error } = await supabase.rpc(name, args).setHeader("Authorization", `Bearer ${token}`);
  await reviewSession(expectedUserId);
  if (error) {
    if (["22023", "42501", "P0001"].includes(error.code)) throw new Error(error.message);
    throw new Error("We couldn't confirm this action. Check your connection and retry; your review will not be added twice.");
  }
  return data;
}

export async function getCourseReviewSummary(code: string, userId: string): Promise<CourseReviewSummary> {
  const row = await reviewRpc("get_course_review_summary", { p_course_code: normalizeCode(code) }, userId) as SummaryRow;
  if (!row || !Array.isArray(row.grade_counts) || !Array.isArray(row.my_reviews)
    || !Array.isArray(row.eligible_terms) || !Array.isArray(row.top_tags)) {
    throw new Error("We couldn't load this course's review summary. Please retry.");
  }
  return {
    courseCode: row.course_code, title: row.title, reviewCount: Number(row.review_count),
    averageDifficulty: row.average_difficulty === null ? null : Number(row.average_difficulty),
    averageWorkload: row.average_workload === null ? null : Number(row.average_workload),
    recommendPercent: row.recommend_percent === null ? null : Number(row.recommend_percent),
    gradeCounts: COURSE_GRADES.map(grade => ({ grade, count: Number(row.grade_counts.find(item => item.grade === grade)?.count ?? 0) })),
    topTags: row.top_tags.map(item => ({ tag: item.tag, count: Number(item.count) })),
    eligibleTerms: row.eligible_terms.map(term => ({ id: term.id, displayName: term.display_name })),
    myReviews: row.my_reviews.map(mapReview),
  };
}

export async function getCourseReviews(code: string, userId: string, cursor: ReviewCursor | null = null) {
  const rows = await reviewRpc("list_course_reviews", {
    p_course_code: normalizeCode(code), p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null, p_limit: COURSE_REVIEWS_PAGE_SIZE + 1,
  }, userId) as ReviewRow[];
  if (!Array.isArray(rows)) throw new Error("We couldn't load these reviews. Please retry.");
  const reviews = rows.slice(0, COURSE_REVIEWS_PAGE_SIZE).map(mapReview);
  const last = reviews[reviews.length - 1];
  return {
    reviews,
    nextCursor: rows.length > COURSE_REVIEWS_PAGE_SIZE && last
      ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export function validateCourseReview(input: CourseReviewInput): string | null {
  if (!input.termId) return "Choose the term when you took this course.";
  if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 5) return "Choose a difficulty from 1 to 5.";
  if (!Number.isInteger(input.workload) || input.workload < 1 || input.workload > 5) return "Choose a workload from 1 to 5.";
  if (typeof input.recommend !== "boolean") return "Choose whether you recommend this course.";
  if (input.grade !== null && !COURSE_GRADES.includes(input.grade)) return "Choose a grade from the list, or leave it blank.";
  const length = Array.from(input.comment.trim()).length;
  if (length < 10 || length > 2000) return "Write a review between 10 and 2,000 characters.";
  if (Array.from(input.tips.trim()).length > 1000) return "Keep study tips to 1,000 characters or fewer.";
  if (Array.from(input.instructor.trim()).length > 120) return "Keep the instructor's name to 120 characters or fewer.";
  if (input.tags.length > 3 || new Set(input.tags).size !== input.tags.length
    || input.tags.some(tag => !(COURSE_REVIEW_TAGS as readonly string[]).includes(tag))) return "Choose up to three different tags from the list.";
  return null;
}

export async function saveCourseReview(code: string, userId: string, input: CourseReviewInput): Promise<string> {
  const problem = validateCourseReview(input);
  if (problem) throw new Error(problem);
  const id = await reviewRpc("save_my_course_review", {
    p_course_code: normalizeCode(code), p_term_id: input.termId, p_difficulty: input.difficulty,
    p_workload: input.workload, p_recommend: input.recommend, p_grade: input.grade,
    p_comment: input.comment.trim(), p_tips: input.tips.trim(), p_instructor: input.instructor.trim(), p_tags: input.tags,
  }, userId);
  if (typeof id !== "string" || !id) throw new Error("We couldn't confirm your review was saved. Retry with the same term to avoid duplicates.");
  return id;
}

export async function deleteCourseReview(id: string, userId: string): Promise<void> {
  const result = await reviewRpc("delete_my_course_review", { p_review_id: id }, userId);
  if (result !== true && result !== false) throw new Error("We couldn't confirm your review was removed. Please retry.");
}
