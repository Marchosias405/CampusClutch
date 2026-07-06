import type { CampusRequest, Course, Student } from "../types";

export const mockCourses: Course[] = [
  {
    id: "cmpt-276",
    code: "CMPT 276",
    title: "Introduction to Software Engineering",
    term: "Fall 2024",
    status: "current",
    studentCount: 18,
    icon: "terminal",
  },
  {
    id: "cmpt-361",
    code: "CMPT 361",
    title: "Introduction to Computer Graphics",
    term: "Fall 2024",
    status: "current",
    studentCount: 12,
    icon: "paint-brush",
  },
  {
    id: "bus-237",
    code: "BUS 237",
    title: "Information Systems in Business",
    term: "Fall 2024",
    status: "current",
    studentCount: 9,
    icon: "chart-bar",
  },
  {
    id: "cmpt-225",
    code: "CMPT 225",
    title: "Data Structures",
    term: "Summer 2024",
    status: "previous",
    studentCount: 0,
    icon: "code",
  },
  {
    id: "macm-101",
    code: "MACM 101",
    title: "Discrete Math",
    term: "Fall 2024",
    status: "previous",
    studentCount: 0,
    icon: "calculator",
  },
];

export const addCourseOptions: Course[] = [
  {
    id: "cmpt-361",
    code: "CMPT 361",
    title: "Computer Graphics",
    term: "Summer 2026",
    status: "current",
    studentCount: 12,
    icon: "paint-brush",
  },
  {
    id: "cmpt-276",
    code: "CMPT 276",
    title: "Intro to Software Engineering",
    term: "Summer 2026",
    status: "current",
    studentCount: 18,
    icon: "terminal",
  },
  {
    id: "cmpt-371",
    code: "CMPT 371",
    title: "Data Communications",
    term: "Summer 2026",
    status: "current",
    studentCount: 14,
    icon: "network-wired",
  },
  {
    id: "bus-237",
    code: "BUS 237",
    title: "Information Systems",
    term: "Summer 2026",
    status: "current",
    studentCount: 9,
    icon: "chart-bar",
  },
];

export const mockStudents: Student[] = [
  {
    id: "aisha-r",
    name: "Aisha R.",
    major: "Computing Science",
    year: "2nd year",
    campus: "Burnaby Campus",
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Aisha&backgroundColor=fce7f3",
    sharedInterests: ["Anime", "Gym", "Coffee"],
    matchLabel: "Top Match",
    sharedCourseNote: "Also took CMPT 225 with you",
    isRecentlyActive: true,
  },
  {
    id: "jordan-t",
    name: "Jordan T.",
    major: "Interactive Arts",
    year: "3rd year",
    campus: "Surrey Campus",
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Jordan&backgroundColor=dbeafe",
    sharedInterests: ["Photography", "Gaming"],
    sharedCourseNote: "Also took IAT 110 with you",
  },
  {
    id: "mei-l",
    name: "Mei L.",
    major: "Computing Science",
    year: "1st year",
    campus: "Burnaby Campus",
    avatar:
      "https://api.dicebear.com/7.x/personas/png?seed=Mei&backgroundColor=fef3c7",
    sharedInterests: ["Coding", "Hiking", "UI Design"],
    activityNote: "Recently active in CMPT Study Group",
    isRecentlyActive: true,
  },
];


export const mockRequests: CampusRequest[] = [
  {
    id: "surrey-burnaby",
    category: "DELIVERY",
    title: "Surrey -> Burnaby",
    description:
      "Need a package picked up from the Surrey campus registrar and brought to...",
    location: "Surrey Campus",
    timeLabel: "By 8:00 PM",
    points: 30,
  },
  {
    id: "help-set-up-chairs",
    category: "EVENT HELP",
    title: "Help set up chairs",
    description:
      "Setting up for the Student Union gala in the Convocation Mall. Need 4 people fo...",
    location: "Burnaby",
    timeLabel: "Tomorrow, 10:00 AM",
    points: 45,
  },
  {
    id: "calculus-review",
    category: "STUDY HELP",
    secondaryCategory: "URGENT",
    title: "Calculus Review",
    description:
      "Midterm is Monday! Looking for someone to go over derivative rules and integrali...",
    location: "Surrey",
    timeLabel: "Starts in 2h",
    points: 25,
    isUrgent: true,
  },
  {
    id: "library-printouts",
    category: "PICKUP",
    title: "Library printouts",
    description:
      "Printed my thesis draft at the Belzberg Library. Need someone to grab them an...",
    location: "Vancouver",
    timeLabel: "ASAP",
    points: 15,
  },
];