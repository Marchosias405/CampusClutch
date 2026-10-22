#!/usr/bin/env node
"use strict";

// Read-only collector for SFU's documented Course Outlines API. No database credentials
// or writes are involved. Cached section responses retain catalog fields only.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const BASE_URL = "https://www.sfu.ca/bin/wcm/course-outlines";
const TERM = Object.freeze({ code: "2027-spring", year: 2027, season: "spring", display_name: "Spring 2027" });
const TERM_PATH = "2027/spring";
// SFU Student Services identifies Goldcorp and the DT Visual Art Studio as Vancouver sites:
// https://www.sfu.ca/students/enrolment-services/exams/study-spaces/building-and-locations.html
const CAMPUS_SLUGS = new Map([["burnaby", "burnaby"], ["surrey", "surrey"], ["vancouver", "vancouver"],
  ["goldcorp", "vancouver"], ["dt vsar", "vancouver"]]);
const ONLINE = /^(online|distance education|remote|online asynchronous|online synchronous)$/i;

function text(value) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""; }
function apiUrl(query) { return `${BASE_URL}?${query}`; }
function issue(sourcePath, reason, extra = {}) { return { path: sourcePath, source_url: apiUrl(sourcePath), reason, ...extra }; }
function safePart(value) { return typeof value === "string" && /^[a-z0-9]+$/i.test(value) ? value.toLowerCase() : null; }
function unitsValue(value) {
  const normalized = typeof value === "number" ? String(value) : text(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 && result <= 100 ? result : null;
}

function sanitizeResponse(data, kind) {
  if (kind !== "detail") return data;
  if (!data || !data.info) return { errorMessage: data?.errorMessage ?? "Missing section info" };
  const info = {};
  for (const key of ["title", "dept", "number", "section", "units", "degreeLevel", "type", "outlinePath", "term", "deliveryMethod", "status", "classStatus", "cancelled", "canceled"]) {
    if (Object.prototype.hasOwnProperty.call(data.info, key)) info[key] = data.info[key];
  }
  return {
    info,
    courseSchedule: Array.isArray(data.courseSchedule) ? data.courseSchedule.map((entry) => ({
      campus: entry.campus,
      sectionCode: entry.sectionCode,
      isExam: entry.isExam,
    })) : null,
  };
}

function classifySection(detail, context) {
  const { sourcePath, section, fetched_at } = context;
  const info = detail?.info;
  if (!info) return { quarantine: issue(sourcePath, "missing_section_info") };
  const expected = sourcePath.split("/");
  if (text(info.outlinePath).toLowerCase() !== sourcePath || text(info.term) !== TERM.display_name ||
      text(info.dept).toLowerCase() !== expected[2] || text(info.number).toLowerCase() !== expected[3] ||
      text(info.section).toLowerCase() !== expected[4]) {
    return { quarantine: issue(sourcePath, "source_identity_mismatch") };
  }
  const status = text(info.status || info.classStatus).toLowerCase();
  if (/cancelled|canceled/.test(status) || info.cancelled === true || info.canceled === true) {
    return { exclusion: issue(sourcePath, "cancelled_section") };
  }
  if (text(info.type).toLowerCase() !== "e" || text(section.classType).toLowerCase() !== "e") {
    return { exclusion: issue(sourcePath, "non_enrollment_section") };
  }
  const level = text(info.degreeLevel).toUpperCase();
  if (level === "GRAD" || level === "GRADUATE") return { exclusion: issue(sourcePath, "graduate") };
  if (level !== "UGRD" && level !== "UNDERGRADUATE") return { quarantine: issue(sourcePath, "unknown_degree_level", { value: level }) };
  const units = unitsValue(info.units);
  if (units === null) return { quarantine: issue(sourcePath, "unknown_or_variable_units", { value: info.units ?? null }) };
  if (units < 3) return { exclusion: issue(sourcePath, "below_three_units", { units }) };
  const title = text(info.title);
  if (!title || [...title].length > 160) return { quarantine: issue(sourcePath, "invalid_title") };
  const sectionCode = text(section.sectionCode).toUpperCase();
  // classType/type are SFU's documented enrollment indicators. Component names
  // vary (CAP, OLC, COP, STD, etc.) and must not be mistaken for degree level.
  const delivery = text(info.deliveryMethod);
  const schedule = Array.isArray(detail.courseSchedule) ? detail.courseSchedule.filter((entry) => entry.isExam !== true) : [];
  const campusNames = [...new Set(schedule.map((entry) => text(entry.campus)).filter(Boolean))];
  const physical = campusNames.map((name) => CAMPUS_SLUGS.get(name.toLowerCase())).filter(Boolean);
  const unknown = campusNames.filter((name) => !CAMPUS_SLUGS.has(name.toLowerCase()) && !ONLINE.test(name));
  const online = ONLINE.test(delivery) || campusNames.some((name) => ONLINE.test(name));
  if (unknown.length) return { quarantine: issue(sourcePath, "unknown_campus", { values: unknown }) };
  if (!physical.length && !online) return { quarantine: issue(sourcePath, "missing_campus_or_delivery", { delivery_method: delivery }) };
  const campuses = physical.length ? [...new Set(physical)] : [null];
  return { candidates: campuses.map((campus_slug) => ({
    code: `${expected[2].toUpperCase()} ${expected[3].toUpperCase()}`,
    title,
    term_code: TERM.code,
    campus_slug,
    units,
    degree_level: "undergraduate",
    delivery_mode: campus_slug === null ? "online" : online ? "mixed" : "in_person",
    source_fetched_at: fetched_at,
    source_url: apiUrl(sourcePath),
    section: { section: text(info.section).toUpperCase(), section_code: sectionCode, units, source_url: apiUrl(sourcePath), source_fetched_at: fetched_at, delivery_method: delivery, campuses: campusNames },
  })) };
}

function aggregateCandidates(candidates) {
  const grouped = new Map();
  const quarantine = [];
  for (const candidate of candidates) {
    const key = `${candidate.term_code}:${candidate.code.toLowerCase().replace(/ /g, "-")}:${candidate.campus_slug ?? "online"}`;
    const group = grouped.get(key) ?? [];
    group.push(candidate);
    grouped.set(key, group);
  }
  const rows = [];
  for (const [source_key, group] of grouped) {
    const titles = [...new Set(group.map((row) => row.title))];
    if (titles.length > 1) {
      quarantine.push({ source_key, reason: "conflicting_course_titles", titles, source_urls: group.map((row) => row.source_url) });
      continue;
    }
    const units = [...new Set(group.map((row) => row.units))].sort((a, b) => a - b);
    const sections = new Map(group.map((row) => [row.section.source_url, row.section]));
    const modes = [...new Set(group.map((row) => row.delivery_mode))];
    const first = group[0];
    rows.push({
      source_key, code: first.code, title: first.title, term_code: first.term_code, campus_slug: first.campus_slug,
      units: Math.min(...units), units_values: units, units_vary: units.length > 1, degree_level: first.degree_level,
      delivery_mode: modes.length > 1 ? "mixed" : modes[0],
      source_fetched_at: group.map((row) => row.source_fetched_at).sort()[0],
      source_urls: [...sections.keys()].sort(),
      sections: [...sections.values()].sort((a, b) => a.section.localeCompare(b.section)),
    });
  }
  rows.sort((a, b) => a.source_key.localeCompare(b.source_key));
  return { rows, quarantine };
}

class ApiCache {
  constructor(directory, { refresh = false, intervalMs = 300, maxRequests = 10000 } = {}) {
    this.directory = directory; this.refresh = refresh; this.intervalMs = intervalMs; this.maxRequests = maxRequests;
    this.nextStart = 0; this.networkRequests = 0; this.cacheHits = 0; this.sources = new Map();
  }
  async get(query, kind) {
    if (!/^2027\/spring(?:\/[a-z0-9]+){0,3}$/.test(query)) throw new Error(`Refused query outside Spring 2027: ${query}`);
    const filename = path.join(this.directory, `${query.replace(/\//g, "_")}.json`);
    let cached;
    if (!this.refresh) {
      try { cached = JSON.parse(await fs.readFile(filename, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    if (cached && cached.source_url === apiUrl(query) && cached.kind === kind && cached.schema_version === 1) {
      this.cacheHits += 1; this.sources.set(query, { source_url: cached.source_url, fetched_at: cached.fetched_at }); return cached;
    }
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const start = Math.max(Date.now(), this.nextStart); this.nextStart = start + this.intervalMs;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, start - Date.now())));
      if (this.networkRequests >= this.maxRequests) throw new Error(`Request safety limit (${this.maxRequests}) reached`);
      this.networkRequests += 1;
      try {
        const response = await fetch(apiUrl(query), { headers: { Accept: "application/json", "User-Agent": "CampusClutch-CourseCatalog/1.0 (public academic catalog, low-rate cached GET)" }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) {
          if (response.status === 429 || response.status >= 500) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1500 * (attempt + 1)));
            throw new Error(`HTTP ${response.status}`);
          }
          throw Object.assign(new Error(`HTTP ${response.status}`), { permanent: true });
        }
        const original = await response.json();
        if (original?.errorMessage) throw Object.assign(new Error(String(original.errorMessage)), { permanent: true });
        if (kind !== "detail" && !Array.isArray(original)) throw Object.assign(new Error("Expected an array from inventory endpoint"), { permanent: true });
        const result = { schema_version: 1, kind, source_url: apiUrl(query), fetched_at: new Date().toISOString(), data: sanitizeResponse(original, kind) };
        await fs.writeFile(filename, `${JSON.stringify(result, null, 2)}\n`);
        this.sources.set(query, { source_url: result.source_url, fetched_at: result.fetched_at });
        return result;
      } catch (error) { lastError = error; if (error.permanent) break; }
    }
    throw lastError;
  }
}

async function boundedMap(items, worker, concurrency = 4) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; await worker(items[index], index); }
  }));
}

async function collect(options) {
  const output = path.resolve(options.output);
  await fs.mkdir(path.join(output, "cache"), { recursive: true });
  const cache = new ApiCache(path.join(output, "cache"), options);
  const started_at = new Date().toISOString();
  const errors = []; const quarantine = []; const exclusions = []; const duplicates = []; const candidates = [];
  const coverage = { departments_discovered: 0, departments_read: 0, courses_discovered: 0, course_section_lists_read: 0, sections_discovered: 0, enrollment_sections_discovered: 0, section_details_read: 0 };
  const get = async (query, kind) => {
    try { return await cache.get(query, kind); } catch (error) { errors.push(issue(query, "fetch_failed", { message: error.message })); return null; }
  };
  const uniqueList = (list, parent, field = "value") => {
    const entries = new Map();
    for (const entry of list) {
      const key = safePart(entry[field]);
      if (!key) { quarantine.push(issue(parent, "invalid_inventory_identifier", { value: entry[field] ?? null })); continue; }
      if (entries.has(key)) { duplicates.push(issue(`${parent}/${key}`, "duplicate_inventory_item")); continue; }
      entries.set(key, entry);
    }
    return [...entries].map(([key, value]) => ({ key, value }));
  };
  const departmentsResult = await get(TERM_PATH, "departments");
  const departments = departmentsResult ? uniqueList(departmentsResult.data, TERM_PATH) : [];
  coverage.departments_discovered = departments.length;
  const courses = [];
  await boundedMap(departments, async ({ key }) => {
    const query = `${TERM_PATH}/${key}`;
    const result = await get(query, "courses");
    if (!result) return;
    coverage.departments_read += 1;
    for (const course of uniqueList(result.data, query)) courses.push({ sourcePath: `${query}/${course.key}`, course: course.value });
  });
  coverage.courses_discovered = courses.length;
  console.log(`Read ${coverage.departments_read}/${departments.length} departments; found ${courses.length} courses. Fetching section inventory.`);
  const sections = [];
  await boundedMap(courses, async ({ sourcePath }) => {
    const result = await get(sourcePath, "sections");
    if (!result) return;
    coverage.course_section_lists_read += 1;
    for (const entry of uniqueList(result.data, sourcePath)) {
      coverage.sections_discovered += 1;
      const sectionPath = `${sourcePath}/${entry.key}`;
      if (text(entry.value.classType).toLowerCase() === "n") { exclusions.push(issue(sectionPath, "non_enrollment_section")); continue; }
      if (text(entry.value.classType).toLowerCase() !== "e") { quarantine.push(issue(sectionPath, "unknown_enrollment_type")); continue; }
      sections.push({ sourcePath: sectionPath, section: entry.value });
    }
    if (coverage.course_section_lists_read % 200 === 0) console.log(`Section inventory: ${coverage.course_section_lists_read}/${courses.length} courses.`);
  });
  coverage.enrollment_sections_discovered = sections.length;
  console.log(`Found ${sections.length} enrollment sections. Fetching eligibility and campus details.`);
  await boundedMap(sections, async (context) => {
    const result = await get(context.sourcePath, "detail");
    if (!result) return;
    coverage.section_details_read += 1;
    const parsed = classifySection(result.data, { ...context, fetched_at: result.fetched_at });
    if (parsed.exclusion) exclusions.push(parsed.exclusion);
    if (parsed.quarantine) quarantine.push(parsed.quarantine);
    if (parsed.candidates) candidates.push(...parsed.candidates);
    if (coverage.section_details_read % 200 === 0) console.log(`Section details: ${coverage.section_details_read}/${sections.length}.`);
  });
  const grouped = aggregateCandidates(candidates);
  quarantine.push(...grouped.quarantine);
  const summaryCounts = (items) => items.reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] ?? 0) + 1 }), {});
  const sortIssues = (items) => items.sort((a, b) => `${a.path ?? a.source_key}:${a.reason}`.localeCompare(`${b.path ?? b.source_key}:${b.reason}`));
  const sourceTimes = [...cache.sources.values()].map((source) => source.fetched_at).sort();
  const snapshot = {
    schema_version: 1,
    term: TERM,
    generated_at: new Date().toISOString(), started_at,
    source: { name: "SFU Course Outlines REST API", base_url: BASE_URL, documentation_url: "https://www.sfu.ca/outlines/help/api.html", root_url: apiUrl(TERM_PATH), term_url: apiUrl(TERM_PATH), oldest_fetched_at: sourceTimes[0] ?? null, newest_fetched_at: sourceTimes.at(-1) ?? null },
    scope: { degree_level: "undergraduate", minimum_units: 3, enrollment_sections_only: true, campuses: ["burnaby", "surrey", "vancouver", "online"], term_code: TERM.code },
    coverage: { ...coverage, inventory_complete: errors.length === 0 && !quarantine.some((item) => item.reason === "invalid_inventory_identifier") && departments.length > 0 && coverage.departments_read === departments.length && coverage.course_section_lists_read === courses.length && coverage.section_details_read === sections.length, eligible_course_campus_rows: grouped.rows.length, eligible_unique_courses: new Set(grouped.rows.map((row) => row.code)).size, network_requests: cache.networkRequests, cache_hits: cache.cacheHits, exclusions_by_reason: summaryCounts(exclusions), quarantine_by_reason: summaryCounts(quarantine), errors_count: errors.length, duplicate_inventory_items: duplicates.length },
    limitations: ["Coverage is the published Course Outlines API inventory at the recorded fetch times; it is not a guarantee of every eventual Spring 2027 offering or seat availability.", "Unpublished outlines and unresolved eligibility/campus records are omitted and require review; no department or course number is inferred to be undergraduate.", "No absence-based deletion is implied by this snapshot; course memberships must be preserved when refreshing."],
    rows: grouped.rows, exclusions: sortIssues(exclusions), quarantine: sortIssues(quarantine), errors: sortIssues(errors), duplicates: sortIssues(duplicates),
  };
  snapshot.coverage.complete = snapshot.coverage.inventory_complete;
  snapshot.rows_sha256 = crypto.createHash("sha256").update(JSON.stringify(snapshot.rows)).digest("hex");
  const filename = path.join(output, "spring-2027-undergraduate-3plus.json");
  await fs.writeFile(filename, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(JSON.stringify({ snapshot: filename, coverage: snapshot.coverage }, null, 2));
  return snapshot;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      options.output = argv[++index];
      if (!options.output || options.output.startsWith("--")) throw new Error("Provide a directory after --output.");
    }
    else if (argv[index] === "--refresh") options.refresh = true;
    else if (argv[index] === "--help") return null;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.output) throw new Error("Provide --output <directory> for the review snapshot and sanitized cache.");
  return options;
}

if (require.main === module) {
  (async () => {
    const options = parseArguments(process.argv.slice(2));
    if (!options) { console.log("node scripts/sfu-catalog.cjs --output <directory> [--refresh]\nDefault reuses cached source responses. --refresh fetches current official data. Never writes to a database."); return; }
    const snapshot = await collect(options);
    if (!snapshot.coverage.inventory_complete) process.exitCode = 2;
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { ApiCache, TERM, aggregateCandidates, apiUrl, boundedMap, classifySection, collect, parseArguments, sanitizeResponse, unitsValue };
