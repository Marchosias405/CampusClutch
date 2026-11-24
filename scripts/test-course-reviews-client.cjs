/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const types = {};
vm.runInNewContext(compile('src/types/courseReview.ts'), { exports: types });
const source = compile('src/lib/courseReviews.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const input = () => ({ termId: 'fall', difficulty: 3, workload: 4, recommend: true, grade: 'B+',
  comment: ' Useful lectures and projects. ', tips: ' Practise weekly. ', instructor: ' An instructor ', tags: ['Useful'] });
const row = index => ({ id: `review-${index}`, term_id: 'fall', term_name: 'Fall 2026', difficulty: 3, workload: 4,
  recommend: true, grade: 'B+', comment: 'Useful lectures', tips: null, instructor: null, tags: ['Useful'],
  created_at: '2026-10-30T01:00:00.000001Z', updated_at: '2026-10-30T01:00:00.000001Z', is_mine: index === 0 });
function client(response) {
  const state = { response, account: 'a', calls: [], error: null, execute: null };
  const supabase = {
    auth: { getSession: async () => ({ data: { session: state.account
      ? { user: { id: state.account }, access_token: `token-${state.account}` } : null }, error: null }) },
    rpc: (name, args) => ({ setHeader: async (header, token) => {
      state.calls.push({ name, args: plain(args), header, token });
      await state.execute?.(); return { data: state.response, error: state.error };
    } }),
  };
  const api = {};
  vm.runInNewContext(source, { exports: api, require: name => {
    if (name === '@/lib/supabase') return { supabase };
    if (name === '@/types/courseReview') return types;
    throw Error(name);
  } });
  return { api, state };
}
let checks = 0;
async function test(name, run) { await run(); console.log('PASS ' + name); checks++; }
(async () => {
  await test('save pins the user, canonicalizes course, trims input and omits author identifiers', async () => {
    const { api, state } = client('review-id');
    assert.equal(await api.saveCourseReview(' cmpt   276 ', 'a', input()), 'review-id');
    assert.deepEqual(state.calls[0], { name: 'save_my_course_review', header: 'Authorization', token: 'Bearer token-a', args: {
      p_course_code: 'CMPT 276', p_term_id: 'fall', p_difficulty: 3, p_workload: 4, p_recommend: true,
      p_grade: 'B+', p_comment: 'Useful lectures and projects.', p_tips: 'Practise weekly.', p_instructor: 'An instructor', p_tags: ['Useful'],
    } });
  });
  await test('invalid form inputs never dispatch network writes', async () => {
    const { api, state } = client('id');
    for (const patch of [{ termId: '' }, { difficulty: 0 }, { workload: 6 }, { difficulty: 1.5 }, { recommend: null },
      { grade: 'Z' }, { comment: 'short' }, { comment: 'x'.repeat(2001) }, { tips: 'x'.repeat(1001) },
      { instructor: 'x'.repeat(121) }, { tags: ['Fake'] }, { tags: ['Useful', 'Useful'] }, { tags: types.COURSE_REVIEW_TAGS.slice(0, 4) }]) {
      await assert.rejects(api.saveCourseReview('CMPT 276', 'a', { ...input(), ...patch }));
    }
    assert.equal(state.calls.length, 0);
    assert.equal(api.validateCourseReview({ ...input(), comment: '🙂'.repeat(2000), grade: null }), null);
  });
  await test('changed or signed-out account blocks dispatch and late results', async () => {
    const { api, state } = client('id');
    state.account = 'b'; await assert.rejects(api.saveCourseReview('CMPT 276', 'a', input()), /account changed/);
    state.account = null; await assert.rejects(api.deleteCourseReview('id', 'a'), /account changed/);
    assert.equal(state.calls.length, 0);
    state.account = 'a'; state.execute = () => { state.account = 'b'; };
    await assert.rejects(api.saveCourseReview('CMPT 276', 'a', input()), /account changed/);
  });
  await test('page lookahead preserves precise timestamp cursor and never exposes raw author fields', async () => {
    const { api, state } = client(Array.from({ length: 21 }, (_, i) => ({ ...row(i), author_id: 'private-user', email: 'private' })));
    const page = await api.getCourseReviews('CMPT 276', 'a');
    assert.equal(page.reviews.length, 20);
    assert.deepEqual(plain(page.nextCursor), { id: 'review-19', createdAt: row(0).created_at });
    assert.ok(page.reviews.every(item => !('author_id' in item) && !('email' in item)));
    state.response = [row(21)]; await api.getCourseReviews('CMPT 276', 'a', page.nextCursor);
    assert.equal(state.calls[1].args.p_before_created_at, row(0).created_at);
    assert.equal(state.calls[1].args.p_before_id, 'review-19');
    assert.equal((await api.getCourseReviews('CMPT 276', 'a')).nextCursor, null);
  });
  await test('summary retains zeros, excludes identities and fills every grade in fixed order', async () => {
    const { api, state } = client({ course_code: 'CMPT 276', title: 'Engineering', review_count: 1, average_difficulty: 3,
      average_workload: 4, recommend_percent: 0, grade_counts: [{ grade: 'B+', count: 1 }], top_tags: [{ tag: 'Useful', count: 1 }],
      eligible_terms: [{ id: 'fall', display_name: 'Fall 2026' }], my_reviews: [{ ...row(0), is_hidden: true, author_id: 'secret' }] });
    const summary = await api.getCourseReviewSummary('CMPT 276', 'a');
    assert.equal(summary.recommendPercent, 0); assert.equal(summary.gradeCounts.length, 11);
    assert.equal(summary.gradeCounts.reduce((n, grade) => n + grade.count, 0), 1);
    assert.deepEqual(plain(summary.eligibleTerms), [{ id: 'fall', displayName: 'Fall 2026' }]);
    assert.deepEqual(plain(summary.pastTerms), [], 'An older server can still serve membership reviews');
    state.response.past_terms = [{ id: 'old-term', display_name: 'Spring 2021', year: 2021, season: 'spring' }];
    const updated = await api.getCourseReviewSummary('CMPT 276', 'a');
    assert.deepEqual(plain(updated.pastTerms), [{ id: 'old-term', displayName: 'Spring 2021', year: 2021, season: 'spring' }]);
    assert.ok(!('author_id' in summary.myReviews[0]));
    assert.equal(summary.myReviews[0].isHidden, true);
  });
  await test('network and malformed success responses are errors; retry uses the same logical review key', async () => {
    const { api, state } = client(null); state.error = { code: 'fetch', message: 'internal detail' };
    await assert.rejects(api.saveCourseReview('CMPT 276', 'a', input()), /couldn't confirm/);
    state.error = null; await assert.rejects(api.saveCourseReview('CMPT 276', 'a', input()), /couldn't confirm/);
    state.response = 'id'; await api.saveCourseReview('CMPT 276', 'a', input());
    assert.deepEqual(state.calls[0].args, state.calls[2].args);
    state.response = null; await assert.rejects(api.getCourseReviewSummary('CMPT 276', 'a'));
    await assert.rejects(api.getCourseReviews('CMPT 276', 'a'));
    await assert.rejects(api.deleteCourseReview('id', 'a'));
    state.response = false; await api.deleteCourseReview('id', 'a');
    state.response = true; await api.deleteCourseReview('id', 'a');
  });
  console.log(`Course review client: ${checks} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
