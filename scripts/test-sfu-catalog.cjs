"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ApiCache, aggregateCandidates, boundedMap, classifySection, collect, parseArguments, sanitizeResponse, unitsValue } = require("./sfu-catalog.cjs");

function source(overrides = {}) {
  return { info: { title: "Introduction to Computing Science and Programming I", dept: "CMPT", number: "120", section: "D100", units: "3", degreeLevel: "UGRD", type: "e", outlinePath: "2027/spring/cmpt/120/d100", term: "Spring 2027", deliveryMethod: "In Person", ...overrides }, courseSchedule: [{ campus: "Burnaby", sectionCode: "LEC", isExam: false }] };
}
function context(overrides = {}) { return { sourcePath: "2027/spring/cmpt/120/d100", section: { classType: "e", sectionCode: "LEC" }, fetched_at: "2026-10-22T10:00:00.000Z", ...overrides }; }
function classify(overrides) { return classifySection(source(overrides), context()); }

test("includes exactly three units with explicit undergraduate identity", () => {
  const result = classify();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].units, 3);
  assert.equal(result.candidates[0].code, "CMPT 120");
  assert.equal(result.candidates[0].campus_slug, "burnaby");
});
test("accepts courses worth more than three, including fractional units", () => {
  assert.equal(classify({ units: "4" }).candidates[0].units, 4);
  assert.equal(classify({ units: "3.5" }).candidates[0].units, 3.5);
});
test("rejects below-three units, including zero", () => {
  for (const units of ["0", "1", "2", "2.99"]) assert.equal(classify({ units }).exclusion.reason, "below_three_units");
});
test("quarantines absent, variable, and malformed units instead of parseFloat guessing", () => {
  for (const units of [undefined, "", "3-6", "1 to 3", "3 units", "3 OR 4", "NaN", Infinity]) assert.equal(classify({ units }).quarantine.reason, "unknown_or_variable_units");
  assert.equal(unitsValue("03.0"), 3);
});
test("graduate course is rejected regardless of low number or sufficient units", () => {
  assert.equal(classify({ degreeLevel: "GRAD" }).exclusion.reason, "graduate");
});
test("never infers undergraduate status from course number", () => {
  for (const degreeLevel of [undefined, "", "UNKNOWN"]) assert.equal(classify({ degreeLevel }).quarantine.reason, "unknown_degree_level");
});
test("excludes non-enrollment components even when details look like a course", () => {
  assert.equal(classifySection(source(), context({ section: { classType: "n", sectionCode: "LAB" } })).exclusion.reason, "non_enrollment_section");
  assert.equal(classify({ type: "n" }).exclusion.reason, "non_enrollment_section");
});
test("retains legitimate three-unit enrollment labs", () => {
  assert.equal(classifySection(source(), context({ section: { classType: "e", sectionCode: "LAB" } })).candidates[0].section.section_code, "LAB");
});
test("uses explicit enrollment indicator instead of assuming every component is a lecture", () => {
  assert.equal(classifySection(source(), context({ section: { classType: "e", sectionCode: "CAP" } })).candidates[0].section.section_code, "CAP");
});
test("rejects identity mismatches including different term, course, section, and source path", () => {
  for (const overrides of [{ term: "Fall 2026" }, { dept: "MATH" }, { number: "125" }, { section: "D200" }, { outlinePath: "2026/fall/cmpt/120/d100" }]) assert.equal(classify(overrides).quarantine.reason, "source_identity_mismatch");
});
test("excludes sections explicitly marked cancelled", () => {
  for (const overrides of [{ status: "Cancelled" }, { classStatus: "Canceled" }, { cancelled: true }, { canceled: true }]) assert.equal(classify(overrides).exclusion.reason, "cancelled_section");
});
test("uses instructional campus and ignores exam locations", () => {
  const detail = source();
  detail.courseSchedule.push({ campus: "Surrey", isExam: true });
  assert.deepEqual(classifySection(detail, context()).candidates.map((row) => row.campus_slug), ["burnaby"]);
});
test("groups multiple physical campuses explicitly without guessing from section letters", () => {
  const detail = source(); detail.courseSchedule.push({ campus: "Surrey" }, { campus: "Vancouver" }, { campus: "Burnaby" });
  assert.deepEqual(classifySection(detail, context()).candidates.map((row) => row.campus_slug), ["burnaby", "surrey", "vancouver"]);
});
test("explicit distance education maps to online when physical campus is absent", () => {
  const detail = source({ deliveryMethod: "Distance Education" }); detail.courseSchedule = [];
  const row = classifySection(detail, context()).candidates[0];
  assert.equal(row.campus_slug, null); assert.equal(row.delivery_mode, "online");
});
test("mixed physical and online evidence is recorded as mixed", () => {
  assert.equal(classify({ deliveryMethod: "Distance Education" }).candidates[0].delivery_mode, "mixed");
});
test("missing or unrecognized campus is quarantined", () => {
  const detail = source(); detail.courseSchedule = [];
  assert.equal(classifySection(detail, context()).quarantine.reason, "missing_campus_or_delivery");
  detail.courseSchedule = [{ campus: "Other Campus" }];
  assert.equal(classifySection(detail, context()).quarantine.reason, "unknown_campus");
});
test("aggregates same course and campus with minimum verified units and all distinct sources", () => {
  const first = classify().candidates[0];
  const second = { ...first, units: 4, source_url: first.source_url.replace("d100", "d200"), section: { ...first.section, section: "D200", units: 4, source_url: first.source_url.replace("d100", "d200") } };
  const { rows } = aggregateCandidates([second, first, first]);
  assert.equal(rows.length, 1); assert.equal(rows[0].source_key, "2027-spring:cmpt-120:burnaby");
  assert.equal(rows[0].units, 3); assert.equal(rows[0].units_vary, true); assert.deepEqual(rows[0].units_values, [3, 4]);
  assert.equal(rows[0].sections.length, 2);
});
test("keeps same course at different campuses and online separate", () => {
  const candidate = classify().candidates[0];
  const { rows } = aggregateCandidates([candidate, { ...candidate, campus_slug: "surrey" }, { ...candidate, campus_slug: null, delivery_mode: "online" }]);
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map((row) => row.source_key)).size, 3);
});
test("conflicting course titles are quarantined for review", () => {
  const candidate = classify().candidates[0];
  const result = aggregateCandidates([candidate, { ...candidate, title: "Different course" }]);
  assert.equal(result.rows.length, 0); assert.equal(result.quarantine[0].reason, "conflicting_course_titles");
});
test("detail cache omits instructors, emails, description and irrelevant personal fields", () => {
  const original = { ...source(), instructor: [{ email: "private@example.test" }], info: { ...source().info, description: "Not needed", instructorEmail: "private@example.test" } };
  const result = sanitizeResponse(original, "detail");
  assert.equal(result.instructor, undefined); assert.equal(result.info.description, undefined); assert.equal(result.info.instructorEmail, undefined);
  assert.equal(result.info.degreeLevel, "UGRD");
});
test("cache validates source identity and can serve data with network unavailable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sfu-catalog-test-"));
  try {
    await fs.writeFile(path.join(directory, "2027_spring.json"), JSON.stringify({ schema_version: 1, kind: "departments", source_url: "https://www.sfu.ca/bin/wcm/course-outlines?2027/spring", fetched_at: "2026-10-22T10:00:00.000Z", data: [{ value: "cmpt" }] }));
    const cache = new ApiCache(directory, { maxRequests: 0 });
    assert.equal((await cache.get("2027/spring", "departments")).data[0].value, "cmpt");
    assert.equal(cache.cacheHits, 1); assert.equal(cache.networkRequests, 0);
    await assert.rejects(() => cache.get("2026/fall", "departments"), /outside Spring 2027/);
  } finally { await fs.rm(directory, { recursive: true }); }
});
test("bounded worker pool does not exceed configured concurrency and visits every item", async () => {
  let active = 0; let maximum = 0; const visited = [];
  await boundedMap([1, 2, 3, 4, 5, 6], async (value) => { active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 1)); visited.push(value); active--; }, 2);
  assert.equal(maximum, 2); assert.deepEqual(visited.sort(), [1, 2, 3, 4, 5, 6]);
});
test("CLI requires explicit output and rejects accidental unsupported options", () => {
  assert.throws(() => parseArguments([]), /--output/);
  assert.throws(() => parseArguments(["--year", "2028"]), /Unknown argument/);
  assert.throws(() => parseArguments(["--output", "--refresh"]), /directory/);
  assert.deepEqual(parseArguments(["--output", "catalog", "--refresh"]), { output: "catalog", refresh: true });
});

async function writeFixtureCache(directory, query, kind, data) {
  await fs.writeFile(path.join(directory, `${query.replaceAll("/", "_")}.json`), JSON.stringify({ schema_version: 1, kind, source_url: `https://www.sfu.ca/bin/wcm/course-outlines?${query}`, fetched_at: "2026-10-22T10:00:00.000Z", data }));
}
async function fixtureCollection(extraDepartment) {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "sfu-catalog-coverage-"));
  const cache = path.join(output, "cache"); await fs.mkdir(cache);
  await writeFixtureCache(cache, "2027/spring", "departments", [{ value: "cmpt" }, ...(extraDepartment ? [{ value: "sci" }] : [])]);
  await writeFixtureCache(cache, "2027/spring/cmpt", "courses", [{ value: "120", title: source().info.title }]);
  await writeFixtureCache(cache, "2027/spring/cmpt/120", "sections", [{ value: "d100", classType: "e", sectionCode: "LEC" }, { value: "d101", classType: "n", sectionCode: "LAB" }]);
  await writeFixtureCache(cache, "2027/spring/cmpt/120/d100", "detail", sanitizeResponse(source(), "detail"));
  return output;
}
test("complete cached inventory produces one verified row and reports non-enrollment exclusion", async () => {
  const output = await fixtureCollection(false);
  try {
    const result = await collect({ output, maxRequests: 0, intervalMs: 0 });
    assert.equal(result.coverage.complete, true); assert.equal(result.coverage.departments_read, 1);
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].units, 3);
    assert.equal(result.coverage.network_requests, 0); assert.equal(result.exclusions[0].reason, "non_enrollment_section");
    assert.equal(result.rows_sha256.length, 64); assert.equal(result.source.term_url, "https://www.sfu.ca/bin/wcm/course-outlines?2027/spring");
  } finally { await fs.rm(output, { recursive: true }); }
});
test("unreachable listed department never marks a partial catalog complete", async () => {
  const output = await fixtureCollection(true);
  try {
    const result = await collect({ output, maxRequests: 0, intervalMs: 0 });
    assert.equal(result.coverage.complete, false); assert.equal(result.coverage.inventory_complete, false);
    assert.equal(result.coverage.departments_discovered, 2); assert.equal(result.coverage.departments_read, 1);
    assert.equal(result.rows.length, 1); assert.equal(result.errors.length, 1); assert.equal(result.errors[0].path, "2027/spring/sci");
  } finally { await fs.rm(output, { recursive: true }); }
});

test("maps documented Goldcorp and DT Visual Art Studio locations to Vancouver", () => {
  for (const campus of ["GOLDCORP", "DT VSAR"]) {
    const detail = source(); detail.courseSchedule = [{ campus }];
    assert.equal(classifySection(detail, context()).candidates[0].campus_slug, "vancouver");
  }
});
test("quarantines titles that exceed the database limit instead of breaking a batch", () => {
  assert.equal(classify({ title: "x".repeat(160) }).candidates[0].title.length, 160);
  assert.equal(classify({ title: "x".repeat(161) }).quarantine.reason, "invalid_title");
});
