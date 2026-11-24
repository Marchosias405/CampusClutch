"use strict";

// Reviewed SFU calendars, including the final examination period:
// https://www.sfu.ca/students/calendar/2026/fall.html
// https://www.sfu.ca/students/calendar/2027/spring.html
const TERMS = Object.freeze({
  "2026-fall": Object.freeze({ code: "2026-fall", year: 2026, season: "fall",
    display_name: "Fall 2026", starts: "2026-09-09", ends: "2026-12-20" }),
  "2027-spring": Object.freeze({ code: "2027-spring", year: 2027, season: "spring",
    display_name: "Spring 2027", starts: "2027-01-05", ends: "2027-04-26" }),
});

function catalogTerm(code = "2027-spring") {
  if (!Object.hasOwn(TERMS, code)) throw new Error("Supported catalog terms: 2026-fall and 2027-spring.");
  return TERMS[code];
}

module.exports = { TERMS, catalogTerm };
