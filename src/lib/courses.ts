import { supabase } from "@/lib/supabase";
import type {
  AcademicTerm,
  AcademicTermSeason,
  AcademicTermStatus,
  CourseCatalogItem,
  CourseCatalogStatus,
  CourseClassmate,
  CourseJoinResult,
  CourseLeaveResult,
  CourseMembershipStatus,
  MyCourse,
} from "@/types";

type AcademicTermRow = {
  id: string;
  code: string;
  display_name: string;
  year: number;
  season: AcademicTermSeason;
  starts_on: string;
  ends_on: string;
  status: AcademicTermStatus;
};

type CampusSummaryRow = {
  id: string;
  display_name: string;
};

type CourseRow = {
  id: string;
  code: string;
  title: string;
  status: CourseCatalogStatus;
  campus_id: string | null;
  units?: number | null;
  degree_level?: string | null;
  delivery_mode?: string | null;
  academic_terms:
    | AcademicTermRow
    | AcademicTermRow[]
    | null;
  campuses:
    | CampusSummaryRow
    | CampusSummaryRow[]
    | null;
};

type CourseMembershipRow = {
  status: CourseMembershipStatus;
  joined_at: string;
  ended_at: string | null;
  courses:
    | CourseRow
    | CourseRow[]
    | null;
};

type CourseClassmateRow = {
  profile_id: string;
  display_name: string;
  major: string | null;
  year_of_study: number | null;
  campus_id: string | null;
  campus_display_name: string | null;
  avatar_path: string | null;
  shared_interests: string[] | null;
  shared_interest_count: number;
  same_campus: boolean;
};

const COURSE_SELECT = `
  id,
  code,
  title,
  status,
  campus_id,
  units,
  degree_level,
  delivery_mode,
  academic_terms!inner (
    id,
    code,
    display_name,
    year,
    season,
    starts_on,
    ends_on,
    status
  ),
  campuses (
    id,
    display_name
  )
`;

function getSingleRelation<T>(
  value: T | T[] | null
): T | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function mapAcademicTerm(
  row: AcademicTermRow
): AcademicTerm {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    year: row.year,
    season: row.season,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
  };
}

function mapCourse(
  row: CourseRow
): CourseCatalogItem {
  const term = getSingleRelation(row.academic_terms);
  const campus = getSingleRelation(row.campuses);

  if (!term) {
    throw new Error(
      `Course ${row.code} is missing its academic term.`
    );
  }

  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    term: mapAcademicTerm(term),
    campusId: row.campus_id,
    campusDisplayName: campus?.display_name ?? null,
    units: row.units ?? null,
    degreeLevel: row.degree_level ?? null,
    deliveryMode: row.delivery_mode ?? null,
  };
}

function mapClassmate(
  row: CourseClassmateRow
): CourseClassmate {
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    major: row.major,
    yearOfStudy: row.year_of_study,
    campusId: row.campus_id,
    campusDisplayName: row.campus_display_name,
    avatarPath: row.avatar_path,
    sharedInterests: row.shared_interests ?? [],
    sharedInterestCount: row.shared_interest_count,
    sameCampus: row.same_campus,
  };
}

export async function getAcademicTerms(): Promise<
  AcademicTerm[]
> {
  const { data, error } = await supabase
    .from("academic_terms")
    .select(
      `
        id,
        code,
        display_name,
        year,
        season,
        starts_on,
        ends_on,
        status
      `
    )
    .order("starts_on", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as AcademicTermRow[]).map(
    mapAcademicTerm
  );
}

export const COURSE_CATALOG_PAGE_SIZE = 30;

export type CourseCatalogCursor = { code: string; id: string };
export type CourseCatalogPage = {
  courses: CourseCatalogItem[];
  nextCursor: CourseCatalogCursor | null;
};

type CatalogSearchRow = Omit<CourseRow, "academic_terms" | "campuses"> & {
  campus_display_name: string | null;
};

export async function searchCourseCatalog(
  term: AcademicTerm,
  query = "",
  after: CourseCatalogCursor | null = null,
): Promise<CourseCatalogPage> {
  const { data, error } = await supabase.rpc("search_course_catalog", {
    p_term_id: term.id,
    p_query: query.trim(),
    p_after_code: after?.code ?? null,
    p_after_id: after?.id ?? null,
    // One extra row tells us whether another page exists without a total-count scan.
    p_limit: COURSE_CATALOG_PAGE_SIZE + 1,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as CatalogSearchRow[];
  const courses = rows.slice(0, COURSE_CATALOG_PAGE_SIZE).map((row) => ({
    id: row.id, code: row.code, title: row.title, status: row.status, term,
    campusId: row.campus_id, campusDisplayName: row.campus_display_name,
    units: row.units ?? null, degreeLevel: row.degree_level ?? null,
    deliveryMode: row.delivery_mode ?? null,
  }));
  const last = courses[courses.length - 1];
  return {
    courses,
    nextCursor: rows.length > COURSE_CATALOG_PAGE_SIZE && last
      ? { code: last.code, id: last.id } : null,
  };
}

async function courseSession(expectedUserId: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id.toLowerCase() !== expectedUserId.toLowerCase()
    || !data.session.access_token) {
    throw new Error("Your account changed. Reopen this screen before continuing.");
  }
  return data.session.access_token;
}

export async function getMyCourses(expectedUserId?: string): Promise<
  MyCourse[]
> {
  const token = expectedUserId ? await courseSession(expectedUserId) : null;
  const request = supabase
    .from("course_memberships")
    .select(
      `
        status,
        joined_at,
        ended_at,
        courses!inner (
          ${COURSE_SELECT}
        )
      `
    )
    .neq("status", "left")
    .order("joined_at", { ascending: false });

  const { data, error } = token
    ? await request.setHeader("Authorization", `Bearer ${token}`) : await request;
  if (expectedUserId) await courseSession(expectedUserId);

  if (error) {
    throw error;
  }

  return (
    data as unknown as CourseMembershipRow[]
  ).flatMap((row) => {
    const course = getSingleRelation(row.courses);

    if (!course) {
      return [];
    }

    return [
      {
        ...mapCourse(course),
        membershipStatus: row.status,
        joinedAt: row.joined_at,
        endedAt: row.ended_at,
      },
    ];
  });
}

export function isCurrentCourse(
  course: MyCourse
): boolean {
  return (
    course.membershipStatus === "enrolled" &&
    course.status !== "archived" &&
    course.term.status === "current"
  );
}

export function isPreviousCourse(
  course: MyCourse
): boolean {
  if (course.membershipStatus === "left") {
    return false;
  }

  return (
    course.membershipStatus === "completed" ||
    course.term.status === "past"
  );
}

export function isUpcomingCourse(course: MyCourse): boolean {
  return course.membershipStatus === "enrolled"
    && course.status !== "archived" && course.term.status === "upcoming";
}

export function courseDetailsLabel(course: CourseCatalogItem): string {
  const campus = course.deliveryMode === "online"
    ? "Online" : course.campusDisplayName;
  return [campus, course.units == null ? null : `${course.units} units`]
    .filter(Boolean).join(" · ");
}

async function membershipAction(name: string, courseId: string, expectedUserId?: string) {
  const token = expectedUserId ? await courseSession(expectedUserId) : null;
  const request = supabase.rpc(name, { p_course_id: courseId });
  const { data, error } = token
    ? await request.setHeader("Authorization", `Bearer ${token}`) : await request;
  if (expectedUserId) await courseSession(expectedUserId);
  if (error) throw error;
  return data;
}

export async function joinCourse(
  courseId: string,
  expectedUserId?: string,
): Promise<CourseJoinResult> {
  const data = await membershipAction("join_my_course", courseId, expectedUserId);

  if (
    data !== "joined" &&
    data !== "already_enrolled" &&
    data !== "rejoined"
  ) {
    throw new Error(
      "Unexpected response while joining course."
    );
  }

  return data;
}

export async function leaveCourse(
  courseId: string,
  expectedUserId?: string,
): Promise<CourseLeaveResult> {
  const data = await membershipAction("leave_my_course", courseId, expectedUserId);

  if (
    data !== "left" &&
    data !== "already_left"
  ) {
    throw new Error(
      "Unexpected response while leaving course."
    );
  }

  return data;
}

export async function getCourseClassmates(
  courseId: string
): Promise<CourseClassmate[]> {
  const { data, error } = await supabase.rpc(
    "get_course_classmates",
    {
      p_course_id: courseId,
    }
  );

  if (error) {
    throw error;
  }

  return (
    (data ?? []) as CourseClassmateRow[]
  ).map(mapClassmate);
}
