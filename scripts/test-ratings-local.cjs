/* global __dirname */
// Exercise the actual typed rating service through local Auth/PostgREST only.
const fs = require('node:fs');
const cp = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = require('node:path').resolve(__dirname, '..');
const { createClient } = require(root + '/node_modules/@supabase/supabase-js');
const ts = require(root + '/node_modules/typescript');
const env = Object.fromEntries(fs.readFileSync(root + '/.env.local', 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (env.EXPO_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('Local API required');
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const users = [];
const compiled = Object.fromEntries(['offers', 'ratings', 'points'].map(name => [name, ts.transpileModule(
  fs.readFileSync(root + '/src/lib/' + name + '.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText]));
let checks = 0;
const pass = message => { checks += 1; console.log('PASS ' + message); };

function sql(query) {
  const out = cp.spawnSync('psql', ['-X', '-h', '127.0.0.1', '-p', '54322', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, encoding: 'utf8' });
  if (out.status !== 0) throw Error(out.stderr);
}

function service(client, name = 'ratings') {
  const exports = {};
  vm.runInNewContext(compiled[name], {
    exports, Error,
    require: path => path === './supabase' ? { supabase: client } : service(client, 'offers'),
  });
  return exports;
}

async function rpc(user, name, args) {
  const result = await user.client.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

async function account() {
  const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = 'rating-api-' + crypto.randomUUID() + '@test.local', password = crypto.randomBytes(24).toString('hex');
  const signup = await client.auth.signUp({ email, password });
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, client, api: service(client) };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}'; update public.profiles set display_name='Rating API Tester',major='Testing',year_of_study=2,is_discoverable=false,onboarding_completed_at=now(),campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';`);
  const signin = await client.auth.signInWithPassword({ email, password });
  if (signin.error) throw signin.error;
  return user;
}

async function fixture(owner, helper, campus) {
  const request = await rpc(owner, 'save_my_request', { p_payload: {
    category: 'delivery', title: 'Mutual ratings API fixture', description: 'Temporary rating integration request.',
    campus_id: campus, room_location: 'Library', deadline_at: '2099-01-01T00:00:00Z', points: 10,
    item_size: 'small', details: { pickup_location: 'Cafe', dropoff_location: 'Library' },
  } });
  const offer = await rpc(helper, 'create_my_request_offer_for_terms', { p_request_id: request, p_expected_round: 1, p_expected_points: 10 });
  return { request, offer };
}

(async () => {
  try {
    sql("notify pgrst, 'reload schema';");
    const owner = await account(), helper = await account(), other = await account();
    const campus = await owner.client.from('campuses').select('id').eq('slug', 'burnaby').single();
    if (campus.error) throw campus.error;
    const { request, offer } = await fixture(owner, helper, campus.data.id);
    const context = user => user.api.loadRequestRating(user.id, request);
    const summary = (user, target, requestId) => user.api.loadProfileRatingSummary(user.id, target.id, requestId);
    const rate = (user, score) => user.api.submitRequestRating(user.id, request, 1, score);

    assert.equal(await context(owner), null);
    await assert.rejects(() => rate(owner, 5), error => error.code === '22023');
    pass('open request has no rating context and cannot be rated through the API');
    await rpc(other, 'create_my_request_offer_for_terms', { p_request_id: request, p_expected_round: 1, p_expected_points: 10 });
    await rpc(owner, 'decide_request_offer_for_round', { p_offer_id: offer, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });
    assert.equal(await context(helper), null);
    await assert.rejects(() => rate(helper, 5), error => error.code === '22023');
    pass('accepted helper must wait for the poster to confirm completion');
    await rpc(owner, 'complete_my_request', { p_request_id: request, p_expected_round: 1 });
    const beforeOwner = await rpc(owner, 'get_my_points'), beforeHelper = await rpc(helper, 'get_my_points');
    const ownerContext = await context(owner), helperContext = await context(helper);
    assert.equal(ownerContext.counterparty_id, helper.id); assert.equal(ownerContext.counterparty_role, 'helper');
    assert.equal(helperContext.counterparty_id, owner.id); assert.equal(helperContext.counterparty_role, 'poster');
    assert.equal(ownerContext.offer_round, 1); assert.equal(ownerContext.my_score, null);
    pass('completed request maps only the settled poster and helper into rating contexts');
    assert.equal(await context(other), null);
    await assert.rejects(() => rate(other, 5), error => error.code === '42501');
    pass('unselected helper cannot submit or read a participant rating context');
    const unrated = await summary(helper, helper);
    assert.equal(unrated.rating_count, 0); assert.equal(unrated.average_score, null);
    pass('an unrated account reports zero ratings with no invented average');
    await assert.rejects(() => summary(other, helper), error => error.code === '42501');
    await assert.rejects(() => summary(other, helper, request), error => error.code === '42501');
    pass('private helper reliability cannot be exposed by guessing a profile and request ID');
    await assert.rejects(() => owner.api.submitRequestRating(owner.id, request, 2, 5), error => error.code === '22023');
    const badScore = await owner.client.rpc('submit_request_rating', { p_request_id: request, p_expected_round: 1, p_score: 6 });
    assert.equal(badScore.error?.code, '22023');
    pass('server rejects stale round and out-of-range scores through PostgREST');

    // Simulate losing the response after the server committed the first rating.
    const ambiguousClient = { auth: owner.client.auth, rpc: (name, args) => ({
      setHeader: async (header, value) => {
        const response = await owner.client.rpc(name, args).setHeader(header, value);
        if (response.error) return response;
        throw new Error('Simulated connection lost after commit');
      },
    }) };
    await assert.rejects(() => service(ambiguousClient).submitRequestRating(owner.id, request, 1, 5), /connection lost/);
    const waiting = await context(owner);
    assert.equal(waiting.my_score, 5); assert.equal(waiting.received_score, null); assert.equal(waiting.published, false);
    pass('refresh recovers the saved private rating after an ambiguous offline response');
    await rate(owner, 5);
    await assert.rejects(() => rate(owner, 4), error => error.code === '23505');
    const ownRows = await owner.client.from('request_ratings').select('*').eq('request_id', request);
    if (ownRows.error) throw ownRows.error;
    assert.equal(ownRows.data.length, 1); assert.equal(ownRows.data[0].score, 5);
    assert.equal(ownRows.data[0].ratee_id, helper.id);
    pass('exact retry preserves one immutable rating addressed to the correct helper');
    const hidden = await context(helper);
    assert.equal(hidden.my_score, null); assert.equal(hidden.received_score, null); assert.equal(hidden.published, false);
    assert.deepEqual(Object.keys(hidden).sort(), ['eligible', 'request_id', 'offer_round', 'counterparty_id', 'counterparty_display_name', 'counterparty_role', 'my_score', 'published', 'received_score'].sort());
    pass('counterparty context returns no hidden score or additional private fields');
    const hiddenRows = await helper.client.from('request_ratings').select('*').eq('request_id', request);
    if (hiddenRows.error) throw hiddenRows.error;
    assert.equal(hiddenRows.data.length, 0);
    pass('direct REST table reads cannot reveal the incoming private rating');
    assert.equal((await summary(helper, helper)).rating_count, 0);
    assert.equal((await summary(owner, helper, request)).rating_count, 0);
    pass('both self and authorized helper summaries exclude unpublished ratings');
    const forged = await helper.client.from('request_ratings').insert({ request_id: request, offer_round: 1, rater_id: owner.id, ratee_id: helper.id, score: 1 });
    const overwritten = await owner.client.from('request_ratings').update({ score: 1 }).eq('request_id', request);
    const erased = await owner.client.from('request_ratings').delete().eq('request_id', request);
    assert.equal(forged.error?.code, '42501'); assert.equal(overwritten.error?.code, '42501'); assert.equal(erased.error?.code, '42501');
    pass('REST writes cannot impersonate another rater, edit a score or erase it');

    await rate(helper, 3);
    const publicOwner = await context(owner), publicHelper = await context(helper);
    assert.equal(publicOwner.published, true); assert.equal(publicOwner.my_score, 5); assert.equal(publicOwner.received_score, 3);
    assert.equal(publicHelper.published, true); assert.equal(publicHelper.my_score, 3); assert.equal(publicHelper.received_score, 5);
    pass('second submission publishes both correctly attributed scores');
    assert.equal((await summary(owner, owner)).average_score, 3);
    assert.equal((await summary(helper, helper)).average_score, 5);
    assert.equal((await summary(owner, helper, request)).rating_count, 1);
    assert.equal((await summary(helper, owner, request)).rating_count, 1);
    pass('reliability counts and averages use published stars received in the correct direction');
    await rate(helper, 3);
    await assert.rejects(() => rate(helper, 2), error => error.code === '23505');
    assert.equal((await summary(owner, owner)).rating_count, 1);
    pass('published retry cannot inflate reliability or change the submitted score');
    await rpc(owner, 'set_my_request_archived', { p_request_id: request, p_archived: true });
    assert.equal((await context(helper)).received_score, 5);
    assert.equal((await summary(owner, owner)).rating_count, 1);
    pass('archiving completed work preserves rating access and aggregate reliability');
    assert.deepEqual(await rpc(owner, 'get_my_points'), beforeOwner);
    assert.deepEqual(await rpc(helper, 'get_my_points'), beforeHelper);
    pass('rating submission, publication, retries and archiving do not change wallets or payment histories');
    const outsiders = await other.client.from('request_ratings').select('*').eq('request_id', request);
    if (outsiders.error) throw outsiders.error;
    assert.equal(outsiders.data.length, 0);
    await assert.rejects(() => summary(other, helper), error => error.code === '42501');
    pass('published individual ratings and private profile summaries remain hidden from unrelated viewers');
    sql(`update public.profiles set is_discoverable=true where id='${helper.id}';`);
    const discoverable = await summary(other, helper);
    assert.deepEqual(Object.keys(discoverable).sort(), ['profile_id', 'rating_count', 'average_score'].sort());
    assert.equal(discoverable.rating_count, 1); assert.equal(discoverable.average_score, 5);
    pass('discoverable profile summary exposes only approved aggregate fields');
    const anon = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonRating = await anon.rpc('submit_request_rating', { p_request_id: request, p_expected_round: 1, p_score: 5 });
    const anonSummary = await anon.rpc('get_profile_rating_summary', { p_profile_id: helper.id });
    const anonContext = await anon.rpc('get_request_rating_context', { p_request_id: request });
    assert.equal(anonRating.error?.code, '42501'); assert.equal(anonSummary.error?.code, '42501'); assert.equal(anonContext.error?.code, '42501');
    pass('anonymous API callers cannot use rating endpoints');

    const second = await fixture(owner, helper, campus.data.id);
    await rpc(owner, 'decide_request_offer_for_round', { p_offer_id: second.offer, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });
    await rpc(owner, 'complete_my_request', { p_request_id: second.request, p_expected_round: 1 });
    await owner.api.submitRequestRating(owner.id, second.request, 1, 1);
    assert.equal((await summary(other, helper)).average_score, 5);
    await helper.api.submitRequestRating(helper.id, second.request, 1, 5);
    assert.equal((await summary(other, helper)).average_score, 3);
    assert.equal((await summary(other, helper)).rating_count, 2);
    assert.equal((await summary(owner, owner)).average_score, 4);
    pass('second request changes each average only after mutual publication');

    const cancelled = await fixture(owner, helper, campus.data.id);
    const cancellationOwnerWallet = await rpc(owner, 'get_my_points');
    const cancellationHelperWallet = await rpc(helper, 'get_my_points');
    await rpc(owner, 'decide_request_offer_for_round', { p_offer_id: cancelled.offer, p_action: 'accepted', p_expected_round: 1, p_expected_points: 10 });
    await service(helper.client, 'points').cancelAcceptedHelp(helper.id, cancelled.request, 1);
    await service(helper.client, 'points').cancelAcceptedHelp(helper.id, cancelled.request, 1);
    assert.deepEqual(await rpc(owner, 'get_my_points'), cancellationOwnerWallet);
    assert.deepEqual(await rpc(helper, 'get_my_points'), cancellationHelperWallet);
    pass('typed helper cancellation and retry release the reservation once without a payment');
    const reopened = await owner.client.from('requests').select('status,offer_round').eq('id', cancelled.request).single();
    if (reopened.error) throw reopened.error;
    assert.equal(reopened.data.status, 'open'); assert.equal(reopened.data.offer_round, 2);
    const cancelledPage = await helper.api.loadRequestRatingPage(helper.id, cancelled.request);
    assert.equal(cancelledPage.items.length, 1); assert.equal(cancelledPage.items[0].outcome, 'cancelled');
    assert.equal(cancelledPage.items[0].counterparty_id, owner.id); assert.equal(cancelledPage.items[0].offer_round, 1);
    assert.equal(cancelledPage.hasMore, false); assert.equal(cancelledPage.nextOffset, 1);
    assert.equal((await helper.api.loadRequestRatingPage(helper.id, cancelled.request, 1)).items.length, 0);
    assert.equal(await helper.api.loadRequestRating(helper.id, cancelled.request), null);
    assert.equal((await other.api.loadRequestRatingPage(other.id, cancelled.request)).items.length, 0);
    pass('cancelled history is paged by assignment and never substituted into the current-round context');
    await owner.api.submitRequestRating(owner.id, cancelled.request, 1, 2);
    const cancelledHidden = (await helper.api.loadRequestRatingPage(helper.id, cancelled.request)).items[0];
    assert.equal(cancelledHidden.received_score, null); assert.equal(cancelledHidden.published, false);
    await helper.api.submitRequestRating(helper.id, cancelled.request, 1, 4);
    const cancelledPublished = (await helper.api.loadRequestRatingPage(helper.id, cancelled.request)).items[0];
    assert.equal(cancelledPublished.received_score, 2); assert.equal(cancelledPublished.published, true);
    pass('cancelled assignment scores stay private until both participants rate');
    const replacementOffer = await rpc(other, 'create_my_request_offer_for_terms', { p_request_id: cancelled.request, p_expected_round: 2, p_expected_points: 10 });
    await rpc(owner, 'decide_request_offer_for_round', { p_offer_id: replacementOffer, p_action: 'accepted', p_expected_round: 2, p_expected_points: 10 });
    await service(helper.client, 'points').cancelAcceptedHelp(helper.id, cancelled.request, 1);
    const replacement = await owner.client.from('requests').select('status,offer_round').eq('id', cancelled.request).single();
    assert.equal(replacement.data.status, 'accepted'); assert.equal(replacement.data.offer_round, 2);
    const oldHelperAccess = await helper.client.from('requests').select('id').eq('id', cancelled.request).single();
    assert.equal(oldHelperAccess.data?.id, cancelled.request);
    const myOffers = await service(helper.client, 'offers').loadOfferPage(helper.id, null);
    assert.equal(myOffers.items.find(item => item.request_id === cancelled.request)?.has_assignment_history, true);
    pass('former helper keeps a history link and a lost-response retry cannot cancel the replacement');
    await rpc(owner, 'complete_my_request', { p_request_id: cancelled.request, p_expected_round: 2 });
    const ownerHistory = await owner.api.loadRequestRatingPage(owner.id, cancelled.request);
    assert.deepEqual(Array.from(ownerHistory.items, item => [item.offer_round, item.outcome, item.counterparty_id]),
      [[2, 'completed', other.id], [1, 'cancelled', helper.id]]);
    assert.equal((await helper.api.loadRequestRatingPage(helper.id, cancelled.request)).items.length, 1);
    assert.equal((await other.api.loadRequestRatingPage(other.id, cancelled.request)).items.length, 1);
    await assert.rejects(() => other.api.submitRequestRating(other.id, cancelled.request, 1, 5), error => error.code === '42501');
    pass('completed replacement and cancelled assignment have separate counterparties and rating permissions');
    const anonHistory = await anon.rpc('get_my_request_rating_contexts', { p_request_id: cancelled.request });
    const anonCancel = await anon.rpc('cancel_my_accepted_help', { p_request_id: cancelled.request, p_expected_round: 1 });
    assert.equal(anonHistory.error?.code, '42501'); assert.equal(anonCancel.error?.code, '42501');
    pass('new history and helper-cancellation endpoints reject anonymous API callers');

    let attempts = 0;
    const mismatch = { auth: { getSession: async () => ({ data: { session: { user: { id: other.id }, access_token: 'other-token' } } }) }, rpc: () => { attempts += 1; throw Error('Unexpected API call'); } };
    const wrongAccount = service(mismatch);
    await assert.rejects(() => wrongAccount.loadRequestRating(owner.id, request));
    await assert.rejects(() => wrongAccount.loadProfileRatingSummary(owner.id, helper.id, request));
    await assert.rejects(() => wrongAccount.submitRequestRating(owner.id, request, 1, 4));
    await assert.rejects(() => wrongAccount.loadRequestRatingPage(owner.id, request));
    await assert.rejects(() => service(mismatch, 'points').cancelAcceptedHelp(owner.id, request, 1));
    assert.equal(attempts, 0);
    pass('account mismatch blocks all rating reads and writes before any API call');
    for (const score of [0, 6, 1.5, NaN, Infinity]) {
      await assert.rejects(() => wrongAccount.submitRequestRating(owner.id, request, 1, score), /1 to 5/);
    }
    assert.equal(attempts, 0);
    pass('client rejects fractional, non-finite and out-of-range scores');
    for (const operation of ['context', 'summary', 'submit', 'history', 'cancel']) {
      let sessionReads = 0, pinnedHeader;
      const switching = {
        auth: { getSession: async () => ({ data: { session: ++sessionReads === 1
          ? { user: { id: owner.id }, access_token: 'original-token' }
          : { user: { id: other.id }, access_token: 'other-token' } } }) },
        rpc: () => ({ setHeader: (name, value) => { pinnedHeader = [name, value]; return Promise.resolve({ data: {}, error: null }); } }),
      };
      const api = service(switching);
      await assert.rejects(() => operation === 'context' ? api.loadRequestRating(owner.id, request)
        : operation === 'summary' ? api.loadProfileRatingSummary(owner.id, helper.id, request)
          : operation === 'history' ? api.loadRequestRatingPage(owner.id, request)
            : operation === 'cancel' ? service(switching, 'points').cancelAcceptedHelp(owner.id, request, 1)
              : api.submitRequestRating(owner.id, request, 1, 4));
      assert.deepEqual(pinnedHeader, ['Authorization', 'Bearer original-token']);
      pass('in-flight ' + operation + ' pins original credentials and rejects account-switch results');
    }
    console.log(`Ratings API checks passed: ${checks}.`);
  } finally {
    for (const user of users) sql(`delete from public.requests where owner_id='${user.id}';`);
    for (const user of users) { await user.client.auth.signOut(); sql(`delete from auth.users where id='${user.id}';`); }
    console.log('Temporary ratings API fixtures removed.');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
