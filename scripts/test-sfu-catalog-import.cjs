"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { makePlan, validateSnapshot } = require("./import-sfu-catalog.cjs");

// Unit checks never connect to a database. --local additionally exercises the
// real generated import SQL inside one outer transaction that always rolls back.
const runLocal = process.argv.includes("--local");
const fetched = new Date(Date.now() - 2 * 86400000).toISOString();
const generated = new Date(Date.now() - 86400000).toISOString();

function offering(overrides = {}) {
  return {
    term_code: "2027-spring", code: "ZZCCIMPORT 101", title: "Catalog importer fixture",
    degree_level: "undergraduate", units: 3, campus_slug: "burnaby", delivery_mode: "in_person",
    source_fetched_at: fetched,
    sections: [{ section: "D100", section_code: "LEC", units: 3,
      source_url: "https://www.sfu.ca/bin/wcm/course-outlines?2027/spring/zzccimport/101/d100",
      source_fetched_at: fetched }],
    ...overrides,
  };
}
function snapshot(rows = [offering()], overrides = {}) {
  return { schema_version: 1, term: { code: "2027-spring", year: 2027, season: "spring" },
    generated_at: generated, coverage: { complete: true }, errors: [], quarantine: [], rows, ...overrides };
}
function sectionCourse(number, overrides = {}) {
  const row = offering({ code: `ZZCCIMPORT ${number}`, ...overrides });
  row.sections = row.sections.map((section) => ({ ...section,
    source_url: `https://www.sfu.ca/bin/wcm/course-outlines?2027/spring/zzccimport/${number}/${section.section.toLowerCase()}` }));
  return row;
}

test("accepts an explicitly verified undergraduate offering at the three-unit boundary", () => {
  const result = validateSnapshot(snapshot());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].units, 3);
  assert.equal(result.complete, true);
});

test("accepts four and fractional units using the minimum qualified section units", () => {
  for (const units of [3.5, 4, 100]) {
    const row = offering({ units }); row.sections[0].units = units;
    assert.equal(validateSnapshot(snapshot([row])).rows[0].units, units);
  }
});

test("rejects graduate and missing degree levels without guessing from the course number", () => {
  for (const degree_level of ["graduate", "", undefined, null]) {
    assert.throws(() => validateSnapshot(snapshot([offering({ degree_level })])), /Non-undergraduate/);
  }
});

test("rejects below-three, missing, nonnumeric, nonfinite and excessive offering units", () => {
  for (const units of [0, -1, 2.99, undefined, null, "3", NaN, Infinity, 100.01]) {
    assert.throws(() => validateSnapshot(snapshot([offering({ units })])), /units/);
  }
});

test("every included source section must also satisfy minimum units", () => {
  for (const units of [0, 2.99, null, "3", NaN, Infinity, 101]) {
    const row = offering(); row.sections[0].units = units;
    assert.throws(() => validateSnapshot(snapshot([row])), /Unqualified source section/);
  }
});

test("offering units must equal the minimum included section units", () => {
  const row = offering(); row.sections[0].units = 4;
  assert.throws(() => validateSnapshot(snapshot([row])), /minimum source section units/);
});

test("rejects duplicate offering keys but keeps the same code at different campuses", () => {
  assert.throws(() => validateSnapshot(snapshot([offering(), offering()])), /Duplicate offering/);
  const rows = [offering(), offering({ campus_slug: "surrey" }), offering({ campus_slug: null, delivery_mode: "online" })];
  assert.equal(validateSnapshot(snapshot(rows)).rows.length, 3);
});

test("does not infer an unknown physical campus or delivery mode", () => {
  assert.throws(() => validateSnapshot(snapshot([offering({ campus_slug: "unknown" })])), /campus/);
  assert.throws(() => validateSnapshot(snapshot([offering({ delivery_mode: "unknown" })])), /delivery mode/);
  assert.throws(() => validateSnapshot(snapshot([offering({ campus_slug: null })])), /Missing campus/);
  assert.equal(validateSnapshot(snapshot([offering({ campus_slug: null, delivery_mode: "online" })])).rows.length, 1);
});

test("rejects unsupported snapshot schemas and terms", () => {
  assert.throws(() => validateSnapshot(snapshot(undefined, { schema_version: 2 })), /schema/);
  assert.throws(() => validateSnapshot(snapshot(undefined, { term: { code: "2027-fall", year: 2027, season: "fall" } })), /Spring 2027/);
  assert.throws(() => validateSnapshot(snapshot([offering({ term_code: "2026-fall" })])), /another term/);
});

test("rejects empty snapshots rather than silently clearing the catalog", () => {
  assert.throws(() => validateSnapshot(snapshot([]), { closeMissing: true }), /between 1 and 10000/);
});

test("rejects malformed course identities and titles", () => {
  for (const code of ["zzccimport 101", " ZZCCIMPORT 101", "ZZCCIMPORT  101", "X", "X".repeat(33)]) {
    assert.throws(() => validateSnapshot(snapshot([offering({ code })])), /course code/);
  }
  for (const title of ["", " leading", "trailing ", "x".repeat(161)]) {
    assert.throws(() => validateSnapshot(snapshot([offering({ title })])), /title/);
  }
});

test("requires source error and quarantine inventories", () => {
  assert.throws(() => validateSnapshot(snapshot(undefined, { errors: undefined })), /source errors/);
  assert.throws(() => validateSnapshot(snapshot(undefined, { quarantine: undefined })), /quarantined/);
});

test("source gaps require an explicit override and never permit closing missing courses", () => {
  for (const overrides of [{ coverage: { complete: false } }, { errors: [{ path: "2027/spring/missing" }] }]) {
    const partial = snapshot(undefined, overrides);
    assert.throws(() => validateSnapshot(partial), /Incomplete SFU/);
    assert.equal(validateSnapshot(partial, { allowSourceGaps: true }).rows.length, 1);
    assert.throws(() => validateSnapshot(partial, { allowSourceGaps: true, closeMissing: true }), /Closing missing/);
  }
});

test("quarantined offerings block closing missing courses even with complete inventory", () => {
  const partial = snapshot(undefined, { quarantine: [{ reason: "unknown_units" }] });
  assert.equal(validateSnapshot(partial).quarantined, 1);
  assert.throws(() => validateSnapshot(partial, { closeMissing: true }), /Closing missing/);
  assert.throws(() => validateSnapshot(partial, { allowSourceGaps: true, closeMissing: true }), /Closing missing/);
});

test("rejects incomplete, invalid and implausibly future fetch timestamps", () => {
  for (const value of [undefined, null, "not a date", "2999-01-01T00:00:00Z"]) {
    assert.throws(() => validateSnapshot(snapshot(undefined, { generated_at: value })), /timestamp/);
    assert.throws(() => validateSnapshot(snapshot([offering({ source_fetched_at: value })])), /timestamp/);
    const row = offering(); row.sections[0].source_fetched_at = value;
    assert.throws(() => validateSnapshot(snapshot([row])), /timestamp/);
  }
});

test("provenance requires at least one distinct source section", () => {
  assert.throws(() => validateSnapshot(snapshot([offering({ sections: [] })])), /No source enrollment sections/);
  const row = offering(); row.sections.push({ ...row.sections[0] });
  assert.throws(() => validateSnapshot(snapshot([row])), /Repeated source section/);
});

test("source URLs must be HTTPS SFU Spring 2027 section endpoints", () => {
  const valid = offering().sections[0].source_url;
  for (const source_url of [valid.replace("https:", "http:"), valid.replace("www.sfu.ca", "www.sfu.ca.example.test"),
    valid.replace("www.sfu.ca", "example.test"), valid.replace("2027/spring", "2026/fall"),
    valid.replace("/bin/wcm/course-outlines", "/outlines"), `${valid}#fragment`, `${valid}&injected=1`,
    valid.replace("https://", "https://user:password@"), "file:///tmp/catalog"]) {
    const row = offering(); row.sections[0].source_url = source_url;
    assert.throws(() => validateSnapshot(snapshot([row])), /source URL/);
  }
});

test("official source URL must identify the same course and enrollment section", () => {
  const valid = offering().sections[0].source_url;
  for (const source_url of [valid.replace("zzccimport", "phys"), valid.replace("/101/", "/102/"), valid.replace("d100", "d200")]) {
    const row = offering(); row.sections[0].source_url = source_url;
    assert.throws(() => validateSnapshot(snapshot([row])), /source|identity|match/i);
  }
});

test("import preserves only the documented provenance fields", () => {
  const row = offering(); row.instructor_email = "unused@example.test";
  row.sections[0].instructor_email = "unused@example.test";
  row.sections[0].description = "Unneeded source text";
  const result = validateSnapshot(snapshot([row]));
  assert.equal(result.rows[0].instructor_email, undefined);
  assert.equal(result.rows[0].source_sections[0].instructor_email, undefined);
  assert.equal(result.rows[0].source_sections[0].description, undefined);
});

test("plan defaults to rollback and commits only after explicit local apply", () => {
  assert.match(makePlan(snapshot()), /\nrollback;\s*$/);
  assert.doesNotMatch(makePlan(snapshot()), /\ncommit;/);
  assert.match(makePlan(snapshot(), { applyLocal: true }), /\ncommit;\s*$/);
});

test("catalog title quotes stay data in the SQL plan", () => {
  const title = "Student's course'); SELECT pg_sleep(99); --";
  const plan = makePlan(snapshot([offering({ title })]));
  assert.ok(plan.includes("Student''s course''); SELECT pg_sleep(99); --"));
  assert.match(plan, /\nrollback;\s*$/);
});

function psql(sql) {
  const result = spawnSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
    "-p", "54322", "-U", "postgres", "-d", "postgres"], { input: sql, encoding: "utf8",
    env: { ...process.env, PGPASSWORD: "postgres", PGCONNECT_TIMEOUT: "5" },
    windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const fingerprints = `
select 'terms|' || count(*) || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by id), '')) from public.academic_terms t
union all select 'courses|' || count(*) || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by id), '')) from public.courses t
union all select 'memberships|' || count(*) || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by course_id, profile_id), '')) from public.course_memberships t
union all select 'profiles|' || count(*) || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by id), '')) from public.profiles t
union all select 'users|' || count(*) || '|' || md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by id), '')) from auth.users t;
`;

function body(input, options = {}) {
  const plan = makePlan(input, options);
  assert.equal((plan.match(/^begin;$/gm) || []).length, 1, "Expected one generated outer BEGIN");
  assert.equal((plan.match(/^(?:commit|rollback);$/gm) || []).length, 1, "Expected one generated transaction ending");
  const sql = plan.replace(/^begin;$/m, "").replace(/^(?:commit|rollback);$/m, "");
  assert.doesNotMatch(sql, /^(?:begin|commit|rollback);$/m);
  return "drop table if exists pg_temp.catalog_incoming, pg_temp.catalog_raw;\n" + sql;
}

test("local import is atomic, repeatable and preserves original rows and memberships", { skip: !runLocal }, () => {
  const before = psql(fingerprints);
  const local = snapshot([offering(), offering({ campus_slug: "surrey" }),
    sectionCourse("102", { campus_slug: null, delivery_mode: "online" })]);
  const changed = structuredClone(local);
  changed.rows[0].title = "Updated student's course title";
  changed.rows[0].units = 4;
  changed.rows[0].sections[0].units = 4;
  const newerFetch = new Date(Date.now() - 3600000).toISOString();
  changed.rows[0].source_fetched_at = newerFetch;
  changed.rows[0].sections[0].source_fetched_at = newerFetch;
  changed.generated_at = new Date().toISOString();
  const stale = structuredClone(local);
  stale.rows[0].title = "Older title must not overwrite";
  const collision = snapshot([sectionCourse("198")]);
  const sql = `BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.courses WHERE code LIKE 'ZZCCIMPORT %') THEN
    RAISE EXCEPTION 'Import test fixture prefix is already in use';
  END IF;
END $$;
INSERT INTO auth.users(id,email) VALUES('cf270000-0000-4270-8270-000000000001','catalog-import@test.local');
${body(local)}
SELECT is((SELECT count(*) FROM public.courses WHERE code='ZZCCIMPORT 101'),2::bigint,'Both campuses are inserted');
SELECT is((SELECT count(*) FROM public.courses WHERE code='ZZCCIMPORT 102' AND campus_id IS NULL),1::bigint,'Online offering is inserted');
CREATE TEMP TABLE imported_identity AS SELECT id,code,campus_id,to_jsonb(c) AS original
  FROM public.courses c WHERE code LIKE 'ZZCCIMPORT %';
INSERT INTO public.course_memberships(course_id,profile_id,status)
SELECT id,'cf270000-0000-4270-8270-000000000001','enrolled'
FROM public.courses WHERE code='ZZCCIMPORT 101' AND campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby');
CREATE TEMP TABLE imported_memberships AS SELECT to_jsonb(m) AS original FROM public.course_memberships m
  WHERE profile_id='cf270000-0000-4270-8270-000000000001';
${body(local)}
SELECT is((SELECT count(*) FROM public.courses WHERE code LIKE 'ZZCCIMPORT %'),3::bigint,'Repeat import creates no duplicates');
SELECT ok((SELECT bool_and(to_jsonb(c)=i.original) FROM imported_identity i JOIN public.courses c ON c.id=i.id),'Identical import leaves complete rows unchanged');
${body(changed)}
SELECT is((SELECT count(*) FROM imported_identity i JOIN public.courses c ON c.id=i.id
  AND c.code=i.code AND c.campus_id IS NOT DISTINCT FROM i.campus_id),3::bigint,'Updated import preserves IDs and campus identity');
SELECT is((SELECT title FROM public.courses WHERE code='ZZCCIMPORT 101' AND campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')),
  'Updated student''s course title','Newer official title updates safely');
SELECT is((SELECT units FROM public.courses WHERE code='ZZCCIMPORT 101' AND campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')),
  4::numeric,'Newer units update safely');
SELECT results_eq($$SELECT to_jsonb(m) FROM public.course_memberships m WHERE profile_id='cf270000-0000-4270-8270-000000000001'$$,
  $$SELECT original FROM imported_memberships$$,'Membership remains byte-for-byte unchanged after refresh');
SELECT throws_ok($stale$${body(stale)}$stale$,'P0001','An older snapshot would overwrite newer course data.','Older snapshot cannot overwrite the updated offering');
SELECT is((SELECT title FROM public.courses WHERE code='ZZCCIMPORT 101' AND campus_id=(SELECT id FROM public.campuses WHERE slug='burnaby')),
  'Updated student''s course title','Rejected older import leaves the newer title intact');
INSERT INTO public.courses(code,title,term_id,campus_id)
SELECT 'ZZCCIMPORT 198','Manual course',(SELECT id FROM public.academic_terms WHERE code='2027-spring'),
  (SELECT id FROM public.campuses WHERE slug='burnaby');
SELECT throws_ok($collision$${body(collision)}$collision$,'P0001','An unmanaged course shares an import key. Review it before importing.',
  'Unmanaged matching offering cannot be silently adopted');
SELECT ok((SELECT catalog_source IS NULL FROM public.courses WHERE code='ZZCCIMPORT 198'),'Rejected import preserves manual provenance');
-- Closing requires a complete snapshot. These rows have only fixture provenance.
INSERT INTO public.courses(code,title,term_id,campus_id,status,units,degree_level,delivery_mode,catalog_source,source_fetched_at,source_sections)
SELECT 'ZZCCIMPORT 199','Old managed missing course',term_id,NULL,'active',units,degree_level,'online',catalog_source,
  source_fetched_at,source_sections FROM public.courses WHERE code='ZZCCIMPORT 102';
INSERT INTO public.courses(code,title,term_id,campus_id,status,units,degree_level,delivery_mode,catalog_source,source_fetched_at,source_sections)
SELECT 'ZZCCIMPORT 197','Newer managed missing course',term_id,NULL,'active',units,degree_level,'online',catalog_source,
  clock_timestamp(),source_sections FROM public.courses WHERE code='ZZCCIMPORT 102';
SELECT throws_like($newer$${body(changed, { closeMissing: true })}$newer$,'%newer%',
  'An old complete inventory cannot close a newer missing offering');
SELECT is((SELECT status FROM public.courses WHERE code='ZZCCIMPORT 197'),'active','Rejected stale closure leaves newer missing course active');
DELETE FROM public.courses WHERE code='ZZCCIMPORT 197';
${body(changed)}
SELECT is((SELECT status FROM public.courses WHERE code='ZZCCIMPORT 199'),'active','Default refresh preserves missing source-owned rows');
${body(changed, { closeMissing: true })}
SELECT is((SELECT status FROM public.courses WHERE code='ZZCCIMPORT 199'),'closed','Explicit complete import closes missing source-owned row');
SELECT is((SELECT status FROM public.courses WHERE code='ZZCCIMPORT 198'),'active','Closing missing courses preserves unmanaged course');
SELECT is((SELECT count(*) FROM public.courses WHERE code IN('ZZCCIMPORT 101','ZZCCIMPORT 102') AND status='active'),3::bigint,
  'Present imported offerings remain active');
SELECT results_eq($$SELECT to_jsonb(m) FROM public.course_memberships m WHERE profile_id='cf270000-0000-4270-8270-000000000001'$$,
  $$SELECT original FROM imported_memberships$$,'Membership remains unchanged through closure of other courses');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT * FROM finish();
ROLLBACK;
`;
  let result;
  try {
    result = psql(sql);
  } finally {
    assert.equal(psql(fingerprints), before, "All original terms, courses, memberships, profiles and auth users must survive unchanged");
  }
  assert.doesNotMatch(result, /^not ok\b/m, result);
  const count = (result.match(/^ok \d+ -/gm) || []).length;
  assert.equal(count, 19, result);
  console.log(`Local import: ${count} SQL assertions passed; all original table fingerprints unchanged.`);
});
