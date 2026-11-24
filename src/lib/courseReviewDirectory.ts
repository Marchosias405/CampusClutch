import { supabase } from "@/lib/supabase";

export type ReviewCourse = { course_code: string; title: string };
export type ReviewDirectoryPage = { courses: ReviewCourse[]; nextCode: string | null };

const pageSize = 25;

export function exactReviewCourseCode(value: string): string | null {
  const match = /^([A-Z]{2,5})\s*([0-9]{3}[A-Z]?)$/.exec(value.trim().toUpperCase());
  return match ? `${match[1]} ${match[2]}` : null;
}

export async function searchReviewCourses(query: string, afterCode: string | null): Promise<ReviewDirectoryPage> {
  const { data, error } = await supabase.rpc("search_review_courses", {
    p_query: query.trim(), p_after_code: afterCode, p_limit: pageSize + 1,
  });
  if (error || !Array.isArray(data)) throw new Error("Course search is unavailable.");
  const courses = (data as ReviewCourse[]).slice(0, pageSize);
  return { courses, nextCode: data.length > pageSize ? courses[pageSize - 1].course_code : null };
}
