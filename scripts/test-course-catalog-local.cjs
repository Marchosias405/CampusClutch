/* global __dirname */
// Local Auth/PostgREST smoke test for the real typed course client and imported catalog.
// Only temporary accounts are created; exact fixture cleanup is verified afterward.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321', 'Only local Supabase is supported');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/courses.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const users = [];
let checks = 0;
const pass = label => { checks++; console.log('PASS ' + label); };
function sql(query) {
  const out = cp.spawnSync('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { env: { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5' }, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (out.error) throw out.error;
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}
function client() { return createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
function service(supabase) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, require: name => {
    if (name === '@/lib/supabase') return { supabase };
    throw Error('Unexpected runtime import: ' + name);
  } });
  return exports;
}
function fingerprint() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename").split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+$/.test(table)));
  return tables.map(table => table + ':' + sql(`select count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from public.${table} t`)).join('\n');
}
async function account() {
  const supabase = client();
  const email = 'catalog-api-' + crypto.randomUUID() + '@test.local';
  const password = crypto.randomBytes(24).toString('hex');
  const signup = await supabase.auth.signUp({ email, password });
  assert.ifError(signup.error);
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, supabase, api: service(supabase) };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='Catalog API Tester',major='Testing',year_of_study=2,
    onboarding_completed_at=now(),campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';`);
  assert.ifError((await supabase.auth.signInWithPassword({ email, password })).error);
  return user;
}
(async () => {
  const before = fingerprint();
  try {
    sql("notify pgrst, 'reload schema'");
    const a = await account(), b = await account();
    const term = (await a.api.getAcademicTerms()).find(item => item.code === '2027-spring');
    assert.ok(term, 'Import the Spring 2027 catalog before running this local smoke test');
    assert.equal(term.status, 'upcoming');
    pass('Spring 2027 appears as an upcoming term');
    const expected = Number(sql(`select count(*) from public.courses where term_id='${term.id}' and status='active'`));
    assert.ok(expected > 30, 'A real imported catalog is required');
    let after = null;
    const rows = [];
    for (let pageNumber = 0; pageNumber < 500; pageNumber++) {
      const page = await a.api.searchCourseCatalog(term, '', after);
      assert.ok(page.courses.length <= 30);
      rows.push(...page.courses);
      after = page.nextCursor;
      if (!after) break;
    }
    assert.equal(after, null);
    assert.equal(rows.length, expected);
    assert.equal(new Set(rows.map(item => item.id)).size, expected);
    assert.ok(rows.every(item => item.term.id === term.id && item.degreeLevel === 'undergraduate' && item.units >= 3));
    pass('every verified offering is reachable exactly once through 30-row API pages');
    const course = rows.find(item => item.code === 'CMPT 120') ?? rows[0];
    const matches = await a.api.searchCourseCatalog(term, course.code.toLowerCase());
    assert.ok(matches.courses.some(item => item.id === course.id));
    const titleMatches = await a.api.searchCourseCatalog(term, course.title);
    assert.ok(titleMatches.courses.some(item => item.id === course.id));
    pass('case-insensitive code and title searches return the same offering');
    const literals = await a.api.searchCourseCatalog(term, '%');
    assert.ok(literals.courses.every(item => item.code.includes('%') || item.title.includes('%')));
    await assert.rejects(a.api.searchCourseCatalog(term, 'x'.repeat(101)));
    pass('wildcard input stays literal and oversized queries fail safely');
    const anon = client();
    assert.ok((await anon.rpc('search_course_catalog', { p_term_id: term.id })).error);
    pass('anonymous users cannot call catalog search');
    assert.equal((await a.api.getMyCourses(a.id)).length, 0);
    assert.equal(await a.api.joinCourse(course.id, a.id), 'joined');
    assert.equal(await a.api.joinCourse(course.id, a.id), 'already_enrolled');
    let saved = await a.api.getMyCourses(a.id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, course.id);
    assert.ok(a.api.isUpcomingCourse(saved[0]));
    assert.equal(saved[0].units, course.units);
    pass('upcoming enrollment persists with metadata and repeated joins do not duplicate it');
    const session = (await a.supabase.auth.getSession()).data.session;
    const restored = client();
    assert.ifError((await restored.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })).error);
    assert.equal((await service(restored).getMyCourses(a.id))[0].id, course.id);
    pass('a recreated app client loads the same saved enrollment');
    assert.equal((await b.api.getMyCourses(b.id)).length, 0);
    await assert.rejects(a.api.joinCourse(course.id, b.id));
    pass('account memberships and mutation credentials stay isolated');
    await assert.rejects(a.api.getCourseClassmates(course.id));
    pass('classmate access remains unavailable before the upcoming term starts');
    const denied = await a.supabase.from('courses').update({ units: 99 }).eq('id', course.id);
    assert.ok(denied.error);
    pass('students cannot modify catalog metadata');
    assert.equal(await a.api.leaveCourse(course.id, a.id), 'left');
    assert.equal((await a.api.getMyCourses(a.id)).length, 0);
    assert.equal(await a.api.joinCourse(course.id, a.id), 'rejoined');
    saved = await a.api.getMyCourses(a.id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, course.id);
    pass('removing and re-adding an upcoming course reuses its enrollment');
  } finally {
    if (users.length) sql(`delete from auth.users where id in (${users.map(user => `'${user.id}'`).join(',')})`);
    assert.equal(fingerprint(), before, 'Existing application data must survive exact fixture cleanup unchanged');
    pass('all original application rows remain unchanged after temporary-account cleanup');
  }
  console.log(`Local course catalog API: ${checks} checks passed.`);
})().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
