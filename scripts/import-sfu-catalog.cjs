/* Administrative, local-only catalog import. No client or hosted credentials.
 * Default: execute the complete plan in a transaction and roll it back.
 * --apply-local commits only to 127.0.0.1:54322/postgres.
 * --plan-only --output FILE writes the SQL without connecting.
 */
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const TERM = { code: '2027-spring', year: 2027, season: 'spring',
  name: 'Spring 2027', starts: '2027-01-05', ends: '2027-04-26' };
const SOURCE = 'sfu-course-outlines';

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.sfu.ca' &&
      url.pathname === '/bin/wcm/course-outlines' &&
      /^\?2027\/spring\/[a-z]+\/[a-z0-9]+\/[a-z0-9]+$/i.test(url.search) &&
      !url.hash && !url.username && !url.password;
  } catch { return false; }
}
function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= Date.now() + 86400000;
}
function validateSnapshot(snapshot, options = {}) {
  ensure(snapshot?.schema_version === 1, 'Unsupported snapshot schema.');
  ensure(snapshot.term?.code === TERM.code && snapshot.term?.year === TERM.year &&
    snapshot.term?.season === TERM.season, 'Only Spring 2027 is supported.');
  ensure(validDate(snapshot.generated_at), 'Invalid snapshot timestamp.');
  ensure(Array.isArray(snapshot.errors) && Array.isArray(snapshot.quarantine),
    'Snapshot must report source errors and quarantined records.');
  const complete = snapshot.coverage?.complete === true && snapshot.errors.length === 0;
  ensure(complete || options.allowSourceGaps,
    'Incomplete SFU source inventory. Review errors; --allow-source-gaps imports verified rows only.');
  ensure(!options.closeMissing || (complete && snapshot.quarantine.length === 0),
    'Closing missing courses requires a complete inventory with no quarantined records.');
  ensure(Array.isArray(snapshot.rows) && snapshot.rows.length > 0 && snapshot.rows.length <= 10000,
    'Snapshot must contain between 1 and 10000 verified offerings.');
  const keys = new Set();
  const rows = snapshot.rows.map((row) => {
    ensure(row.term_code === TERM.code, 'Offering belongs to another term.');
    ensure(typeof row.code === 'string' && /^[A-Z][A-Z0-9 ]{1,31}$/.test(row.code) &&
      row.code === row.code.trim() && !/\s{2}/.test(row.code), 'Invalid course code.');
    ensure(typeof row.title === 'string' && row.title.trim() === row.title &&
      row.title.length > 0 && [...row.title].length <= 160, `Invalid title: ${row.code}`);
    ensure(row.degree_level === 'undergraduate', `Non-undergraduate offering: ${row.code}`);
    ensure(typeof row.units === 'number' && Number.isFinite(row.units) && row.units >= 3 && row.units <= 100,
      `Invalid or insufficient units: ${row.code}`);
    ensure(['burnaby', 'surrey', 'vancouver', null].includes(row.campus_slug),
      `Unresolved campus: ${row.code}`);
    ensure(['in_person', 'online', 'mixed'].includes(row.delivery_mode),
      `Unresolved delivery mode: ${row.code}`);
    ensure(row.campus_slug !== null || row.delivery_mode === 'online',
      `Missing campus without explicit online delivery: ${row.code}`);
    const key = `${row.code}:${row.campus_slug ?? 'online'}`;
    ensure(!keys.has(key), `Duplicate offering: ${key}`);
    keys.add(key);
    ensure(validDate(row.source_fetched_at), `Missing fetch timestamp: ${row.code}`);
    ensure(Array.isArray(row.sections) && row.sections.length > 0,
      `No source enrollment sections: ${row.code}`);
    const sectionKeys = new Set();
    const sections = row.sections.map((section) => {
      ensure(typeof section.section === 'string' && /^[A-Z0-9]{1,12}$/i.test(section.section),
        `Invalid section: ${row.code}`);
      ensure(officialUrl(section.source_url), `Invalid official source URL: ${row.code}`);
      const sourceParts = new URL(section.source_url).search.slice(1).split('/');
      ensure(`${sourceParts[2]} ${sourceParts[3]}`.toUpperCase() === row.code &&
        sourceParts[4].toUpperCase() === section.section.toUpperCase(),
      `Source URL does not match the offering and section: ${row.code}`);
      ensure(!sectionKeys.has(section.source_url), `Repeated source section: ${row.code}`);
      sectionKeys.add(section.source_url);
      ensure(typeof section.units === 'number' && section.units >= 3 && section.units <= 100,
        `Unqualified source section: ${row.code}`);
      ensure(validDate(section.source_fetched_at), `Invalid section timestamp: ${row.code}`);
      ensure(Date.parse(section.source_fetched_at) <= Date.parse(snapshot.generated_at),
        `Section fetch is newer than the snapshot: ${row.code}`);
      // Preserve only the provenance needed to audit the imported offering.
      return { section: section.section, section_code: section.section_code ?? null,
        units: section.units, source_url: section.source_url,
        source_fetched_at: section.source_fetched_at };
    });
    ensure(row.units === Math.min(...sections.map((s) => s.units)),
      `Offering units do not match the minimum source section units: ${row.code}`);
    ensure(Date.parse(row.source_fetched_at) === Math.min(...sections.map((s) => Date.parse(s.source_fetched_at))),
      `Offering timestamp does not match its source sections: ${row.code}`);
    return { code: row.code, title: row.title, campus_slug: row.campus_slug,
      units: row.units, degree_level: row.degree_level, delivery_mode: row.delivery_mode,
      source_fetched_at: row.source_fetched_at, source_sections: sections };
  });
  return { rows, complete, quarantined: snapshot.quarantine.length,
    sourceErrors: snapshot.errors.length, generatedAt: snapshot.generated_at };
}

function makePlan(snapshot, options = {}) {
  const checked = validateSnapshot(snapshot, options);
  const payload = JSON.stringify(checked.rows).replaceAll("'", "''");
  const snapshotTime = new Date(checked.generatedAt).toISOString();
  // All source content enters SQL as one escaped JSON literal, never identifiers.
  const upsert = (nullable) => `
insert into public.courses as existing
  (code, title, term_id, campus_id, status, units, degree_level, delivery_mode,
   catalog_source, source_fetched_at, source_sections)
select code, title, term_id, campus_id, 'active', units, degree_level, delivery_mode,
       '${SOURCE}', source_fetched_at, source_sections
from catalog_incoming where campus_id is ${nullable ? '' : 'not '}null
on conflict (code, term_id${nullable ? '' : ', campus_id'}) where campus_id is ${nullable ? '' : 'not '}null
do update set title=excluded.title, status=excluded.status, units=excluded.units,
  degree_level=excluded.degree_level, delivery_mode=excluded.delivery_mode,
  catalog_source=excluded.catalog_source, source_fetched_at=excluded.source_fetched_at,
  source_sections=excluded.source_sections
where (existing.title,existing.status,existing.units,existing.degree_level,existing.delivery_mode,
       existing.source_fetched_at,existing.source_sections)
  is distinct from
      (excluded.title,excluded.status,excluded.units,excluded.degree_level,excluded.delivery_mode,
       excluded.source_fetched_at,excluded.source_sections);`;
  return `-- CampusClutch Spring 2027 undergraduate catalog, >=3 units.
-- Source snapshot ${checked.generatedAt}; verified rows ${checked.rows.length}.
-- Source errors ${checked.sourceErrors}; quarantined ${checked.quarantined}.
-- ${options.applyLocal ? 'LOCAL COMMIT' : 'DRY RUN: all writes roll back'}.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('campusclutch:sfu-catalog:2027-spring',0));
-- Reject fixtures/manual records that share an offering key; never silently adopt them.
create temporary table catalog_raw on commit drop as
select * from jsonb_to_recordset('${payload}'::jsonb) as r(
 code text,title text,campus_slug text,units numeric,degree_level text,
 delivery_mode text,source_fetched_at timestamptz,source_sections jsonb);
do $$ begin
 if exists(select 1 from catalog_raw r where r.campus_slug is not null
   and not exists(select 1 from public.campuses c where c.slug=r.campus_slug)) then
   raise exception 'Import references an unknown campus.';
 end if;
end $$;
insert into public.academic_terms(code,display_name,year,season,starts_on,ends_on,status)
values('${TERM.code}','${TERM.name}',${TERM.year},'${TERM.season}',
 '${TERM.starts}','${TERM.ends}', case
 when (now() at time zone 'America/Vancouver')::date < date '${TERM.starts}' then 'upcoming'
 when (now() at time zone 'America/Vancouver')::date > date '${TERM.ends}' then 'past'
 else 'current' end)
on conflict(code) do update set display_name=excluded.display_name,
 starts_on=excluded.starts_on,ends_on=excluded.ends_on,status=excluded.status
where (academic_terms.display_name,academic_terms.starts_on,academic_terms.ends_on,academic_terms.status)
 is distinct from (excluded.display_name,excluded.starts_on,excluded.ends_on,excluded.status);
create temporary table catalog_incoming on commit drop as
select r.*,t.id as term_id,c.id as campus_id
from catalog_raw r cross join public.academic_terms t
left join public.campuses c on c.slug=r.campus_slug
where t.code='${TERM.code}';
do $$ begin
 if exists(select 1 from catalog_incoming i join public.courses c
   on c.code=i.code and c.term_id=i.term_id and c.campus_id is not distinct from i.campus_id
   where c.catalog_source is distinct from '${SOURCE}') then
   raise exception 'An unmanaged course shares an import key. Review it before importing.';
 end if;
 if exists(select 1 from catalog_incoming i join public.courses c
   on c.code=i.code and c.term_id=i.term_id and c.campus_id is not distinct from i.campus_id
   where c.source_fetched_at > i.source_fetched_at) then
   raise exception 'An older snapshot would overwrite newer course data.';
 end if;
 ${options.closeMissing ? `if exists(select 1 from public.courses c join public.academic_terms t on t.id=c.term_id
   where t.code='${TERM.code}' and c.catalog_source='${SOURCE}' and c.status='active'
   and c.source_fetched_at > timestamptz '${snapshotTime}'
   and not exists(select 1 from catalog_incoming i where i.code=c.code and i.campus_id is not distinct from c.campus_id)) then
   raise exception 'An older snapshot would close newer course data.';
 end if;` : ''}
end $$;
select jsonb_build_object('verified_rows',(select count(*) from catalog_incoming),
 'new_rows',(select count(*) from catalog_incoming i where not exists(select 1 from public.courses c
   where c.code=i.code and c.term_id=i.term_id and c.campus_id is not distinct from i.campus_id)),
 'existing_rows',(select count(*) from catalog_incoming i where exists(select 1 from public.courses c
   where c.code=i.code and c.term_id=i.term_id and c.campus_id is not distinct from i.campus_id)),
 'managed_rows_absent_from_snapshot',(select count(*) from public.courses c join public.academic_terms t on t.id=c.term_id
   where t.code='${TERM.code}' and c.catalog_source='${SOURCE}' and c.status='active'
   and not exists(select 1 from catalog_incoming i where i.code=c.code and i.campus_id is not distinct from c.campus_id)),
 'close_missing',${options.closeMissing ? 'true' : 'false'},'commit',${options.applyLocal ? 'true' : 'false'});
${upsert(false)}
${upsert(true)}
${options.closeMissing ? `update public.courses c set status='closed'
where c.term_id=(select id from public.academic_terms where code='${TERM.code}')
 and c.catalog_source='${SOURCE}' and c.status='active'
 and not exists(select 1 from catalog_incoming i where i.code=c.code and i.campus_id is not distinct from c.campus_id);` : ''}
${options.applyLocal ? 'commit' : 'rollback'};
`;
}

function main(args) {
  const options = {};
  let snapshotPath;
  let output;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--snapshot') snapshotPath = args[++index];
    else if (flag === '--output') output = args[++index];
    else if (flag === '--apply-local') options.applyLocal = true;
    else if (flag === '--allow-source-gaps') options.allowSourceGaps = true;
    else if (flag === '--close-missing') options.closeMissing = true;
    else if (flag === '--plan-only') options.planOnly = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  ensure(snapshotPath, 'Usage: node scripts/import-sfu-catalog.cjs --snapshot FILE [--output FILE] [--plan-only | --apply-local] [--allow-source-gaps] [--close-missing]');
  ensure(!(options.planOnly && options.applyLocal), 'Plan-only and apply-local are mutually exclusive.');
  ensure(!options.planOnly || output, 'Plan-only requires --output.');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8').replace(/^\uFEFF/, ''));
  const sql = makePlan(snapshot, options);
  if (output) fs.writeFileSync(output, sql);
  if (options.planOnly) return console.log(`Reviewable rollback plan saved to ${output}`);
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres'],
  { input: sql, encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' },
    timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(result.stderr || 'Local import failed and was rolled back.');
  console.log(options.applyLocal ? 'Local catalog import committed.' : 'Dry run passed; all writes rolled back.');
}
module.exports = { TERM, validateSnapshot, makePlan };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
