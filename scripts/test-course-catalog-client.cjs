/* global __dirname */
// Exercise the typed course client with deterministic API/auth doubles. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/courses.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const term = { id: 'term-spring', code: '2027-spring', displayName: 'Spring 2027', year: 2027,
  season: 'spring', status: 'upcoming', startsOn: '2027-01-05', endsOn: '2027-04-30' };
const row = (index, extra = {}) => ({ id: `course-${index}`, code: `CMPT ${String(index).padStart(3, '0')}`,
  title: 'Computing', status: 'active', campus_id: 'burnaby', campus_display_name: 'Burnaby',
  units: 3, degree_level: 'undergraduate', delivery_mode: 'in_person', ...extra });
const plain = value => JSON.parse(JSON.stringify(value));
function client(response = []) {
  const state = { response, error: null, account: A, calls: [], authCalls: 0, execute: null };
  const request = call => {
    const run = async () => {
      state.calls.push(call);
      if (state.execute) await state.execute(call);
      return { data: state.response, error: state.error };
    };
    const api = {
      select(value) { call.select = value; return api; },
      neq(...args) { call.neq = args; return api; },
      order(...args) { call.order = args; return api; },
      setHeader(header, value) { call.header = header; call.token = value; return run(); },
      then(yes, no) { return run().then(yes, no); },
    };
    return api;
  };
  const supabase = {
    auth: { getSession: async () => {
      state.authCalls += 1;
      return { data: { session: state.account ? { user: { id: state.account }, access_token: `token-${state.account}` } : null }, error: null };
    } },
    rpc: (name, args) => request({ name, args: plain(args) }),
    from: table => request({ table }),
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, require: name => {
    assert.equal(name, '@/lib/supabase'); return { supabase };
  } });
  return { api: exports, state };
}
let checks = 0;
async function test(name, run) { await run(); checks += 1; console.log('PASS ' + name); }
(async () => {
  await test('search uses selected term, trimmed literal text, and bounded 31-row lookahead', async () => {
    const { api, state } = client([row(1)]);
    const page = await api.searchCourseCatalog(term, '  100%_\\research  ');
    assert.deepEqual(state.calls[0], { name: 'search_course_catalog', args: {
      p_term_id: term.id, p_query: '100%_\\research', p_after_code: null, p_after_id: null, p_limit: 31,
    } });
    assert.equal(page.courses[0].term, term);
    assert.equal(page.courses[0].units, 3);
    assert.equal(page.courses[0].degreeLevel, 'undergraduate');
    assert.equal(page.courses[0].deliveryMode, 'in_person');
    assert.equal(page.courses[0].campusDisplayName, 'Burnaby');
    assert.equal(page.nextCursor, null);
  });
  await test('lookahead does not skip the 31st course; cursor comes from final displayed row', async () => {
    const { api, state } = client(Array.from({ length: 31 }, (_, index) => row(index)));
    const first = await api.searchCourseCatalog(term);
    assert.equal(first.courses.length, 30);
    assert.deepEqual(plain(first.nextCursor), { code: 'CMPT 029', id: 'course-29' });
    state.response = [row(30), row(31)];
    const second = await api.searchCourseCatalog(term, '', first.nextCursor);
    assert.deepEqual(state.calls[1].args, {
      p_term_id: term.id, p_query: '', p_after_code: 'CMPT 029', p_after_id: 'course-29', p_limit: 31,
    });
    assert.equal(second.courses[0].id, 'course-30');
    assert.equal(second.nextCursor, null);
  });
  await test('same course code on different campuses keeps both IDs in the result and cursor', async () => {
    const { api } = client(Array.from({ length: 31 }, (_, index) => row(index, { code: 'CMPT 120', campus_id: `campus-${index}` })));
    const page = await api.searchCourseCatalog(term);
    assert.equal(new Set(page.courses.map(course => course.id)).size, 30);
    assert.deepEqual(plain(page.nextCursor), { code: 'CMPT 120', id: 'course-29' });
  });
  await test('empty and exactly full final pages have no next cursor', async () => {
    const { api, state } = client([]);
    assert.deepEqual(plain(await api.searchCourseCatalog(term)), { courses: [], nextCursor: null });
    state.response = Array.from({ length: 30 }, (_, index) => row(index));
    assert.equal((await api.searchCourseCatalog(term)).nextCursor, null);
  });
  await test('legacy null metadata and online campuses remain usable', async () => {
    const { api } = client([row(1, { units: null, degree_level: null, delivery_mode: null, campus_display_name: null }),
      row(2, { units: 4, delivery_mode: 'online', campus_id: null, campus_display_name: null })]);
    const page = await api.searchCourseCatalog(term);
    assert.equal(api.courseDetailsLabel(page.courses[0]), '');
    assert.equal(api.courseDetailsLabel(page.courses[1]), 'Online · 4 units');
    assert.equal(api.courseDetailsLabel({ campusDisplayName: 'Surrey', units: 3 }), 'Surrey · 3 units');
  });
  await test('catalog query failures are returned, not shown as an empty successful page', async () => {
    const { api, state } = client(); state.error = Error('offline');
    await assert.rejects(api.searchCourseCatalog(term), /offline/);
  });
  await test('upcoming memberships persist separately from current and previous courses', async () => {
    const { api } = client();
    const course = { id: 'spring', status: 'active', membershipStatus: 'enrolled', term };
    assert.equal(api.isUpcomingCourse(course), true);
    assert.equal(api.isCurrentCourse(course), false);
    assert.equal(api.isPreviousCourse(course), false);
    assert.equal(api.isUpcomingCourse({ ...course, membershipStatus: 'left' }), false);
    assert.equal(api.isUpcomingCourse({ ...course, status: 'archived' }), false);
    assert.equal(api.isCurrentCourse({ ...course, term: { ...term, status: 'current' } }), true);
    assert.equal(api.isPreviousCourse({ ...course, term: { ...term, status: 'past' } }), true);
    assert.equal(api.isPreviousCourse({ ...course, membershipStatus: 'completed' }), true);
  });
  await test('membership rows include metadata and term, using a pinned account credential', async () => {
    const { api, state } = client([{ status: 'enrolled', joined_at: 'now', ended_at: null, courses: {
      ...row(1), academic_terms: { id: term.id, code: term.code, display_name: term.displayName, year: 2027,
        season: 'spring', starts_on: term.startsOn, ends_on: term.endsOn, status: 'upcoming' },
      campuses: [{ id: 'burnaby', display_name: 'Burnaby' }],
    } }]);
    const result = await api.getMyCourses(A);
    assert.equal(result[0].term.status, 'upcoming');
    assert.equal(result[0].units, 3);
    assert.equal(result[0].campusDisplayName, 'Burnaby');
    assert.match(state.calls[0].select, /units/);
    assert.equal(state.calls[0].token, `Bearer token-${A}`);
    assert.equal(state.authCalls, 2);
  });
  await test('join and remove pin their actor and keep idempotent server outcomes', async () => {
    const { api, state } = client('joined');
    assert.equal(await api.joinCourse('course', A), 'joined');
    state.response = 'already_enrolled'; assert.equal(await api.joinCourse('course', A), 'already_enrolled');
    state.response = 'rejoined'; assert.equal(await api.joinCourse('course', A), 'rejoined');
    state.response = 'left'; assert.equal(await api.leaveCourse('course', A), 'left');
    state.response = 'already_left'; assert.equal(await api.leaveCourse('course', A), 'already_left');
    for (const call of state.calls) {
      assert.equal(call.header, 'Authorization'); assert.equal(call.token, `Bearer token-${A}`);
      assert.deepEqual(call.args, { p_course_id: 'course' });
    }
  });
  await test('changed or signed-out account cannot dispatch a membership mutation', async () => {
    const { api, state } = client('joined'); state.account = B;
    await assert.rejects(api.joinCourse('course', A), /account changed/);
    state.account = null;
    await assert.rejects(api.leaveCourse('course', A), /account changed/);
    assert.equal(state.calls.length, 0);
  });
  await test('account changes in flight reject old membership responses', async () => {
    const { api, state } = client('joined');
    state.execute = () => { state.account = B; };
    await assert.rejects(api.joinCourse('course', A), /account changed/);
    assert.equal(state.calls[0].token, `Bearer token-${A}`);
    state.account = A; state.response = [];
    await assert.rejects(api.getMyCourses(A), /account changed/);
  });
  await test('unexpected mutation responses fail safely and existing unscoped callers still work', async () => {
    const { api, state } = client('unknown');
    await assert.rejects(api.joinCourse('course', A), /Unexpected response/);
    state.response = 'left';
    assert.equal(await api.leaveCourse('course'), 'left');
    state.response = 'joined'; state.error = Error('offline');
    await assert.rejects(api.joinCourse('course', A), /offline/);
  });
  console.log(`Course catalog client: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
