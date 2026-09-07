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

export async function getAvailableCourses(): Promise<
  CourseCatalogItem[]
> {
  const { data, error } = await supabase
    .from("courses")
    .select(COURSE_SELECT)
    .eq("status", "active")
    .order("code");

  if (error) {
    throw error;
  }

  return (data as unknown as CourseRow[]).map(
    mapCourse
  );
}

export async function getMyCourses(): Promise<
  MyCourse[]
> {
  const { data, error } = await supabase
    .from("course_memberships")
    .select(
      `
        status,
        joined_at,
        ended_at,
        courses!inner (
          id,
          code,
          title,
          status,
          campus_id,
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
        )
      `
    )
    .neq("status", "left")
    .order("joined_at", { ascending: false });

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

export async function joinCourse(
  courseId: string
): Promise<CourseJoinResult> {
  const { data, error } = await supabase.rpc(
    "join_my_course",
    {
      p_course_id: courseId,
    }
  );

  if (error) {
    throw error;
  }

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
  courseId: string
): Promise<CourseLeaveResult> {
  const { data, error } = await supabase.rpc(
    "leave_my_course",
    {
      p_course_id: courseId,
    }
  );

  if (error) {
    throw error;
  }

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
