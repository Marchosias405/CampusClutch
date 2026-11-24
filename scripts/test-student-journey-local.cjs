// Two independent student sessions use the same TypeScript services as the app.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const ts = require('typescript');
const { createStudentFixture, cleanupStudentFixtures, localClientConfig } = require('./local-student-fixtures.cjs');

function appServices(client) {
  const src = path.resolve('src');
  const cache = new Map([[path.join(src, 'lib/supabase'), { supabase: client }]]);
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const filename = file + '.ts';
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.compileFunction(js, ['exports', 'require'], { filename })(exports, name => {
      if (name.startsWith('@/')) return load(path.join(src, name.slice(2)));
      assert.ok(name.startsWith('.'), 'Unexpected service dependency ' + name);
      return load(path.resolve(path.dirname(file), name));
    });
    cache.set(file, exports);
    return exports;
  }
  return Object.fromEntries(['profiles', 'courses', 'requests', 'offers', 'points', 'requestContacts', 'messages', 'notifications']
    .map(name => [name, load(path.join(src, 'lib', name))]));
}

async function student(config, credentials, displayName) {
  const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await client.auth.signUp(credentials);
  assert.ifError(signup.error);
  const id = signup.data.user?.id;
  assert.ok(id, 'Public signup should create a new student');
  assert.ifError((await client.auth.signOut({ scope: 'local' })).error);
  const signin = await client.auth.signInWithPassword(credentials);
  assert.ifError(signin.error);
  assert.equal(signin.data.session?.user.id, id);

  const api = appServices(client);
  const initial = await api.profiles.getProfileById(id);
  assert.equal(initial.onboardingCompletedAt, null);
  const interests = await api.profiles.getInterests();
  assert.ok(interests.length > 0, 'The local seed needs an active interest');
  await api.profiles.replaceProfileInterests(id, [interests[0].id]);
  await api.profiles.replaceProfileSocialLinks(id, {
    linkedinValue: null, linkedinVisible: false, instagramValue: null, instagramVisible: false,
  });
  const profile = await api.profiles.updateProfile(id, { displayName, isDiscoverable: true });
  assert.ok(profile.onboardingCompletedAt);
  assert.equal((await api.points.readWallet(id)).available, 100);
  return { id, displayName, api, client };
}

async function run() {
  const config = localClientConfig();
  const accounts = [];
  const students = [];
  try {
    for (const name of ['Journey Poster', 'Journey Helper']) {
      const credentials = createStudentFixture();
      accounts.push(credentials);
      students.push(await student(config, credentials, name));
    }
    const [poster, helper] = students;
    console.log('PASS two students sign up, sign in and complete their own profiles');

    const terms = await poster.api.courses.getAcademicTerms();
    const term = terms.find(row => row.status === 'current');
    assert.ok(term, 'The local seed needs a current term');
    const course = (await poster.api.courses.searchCourseCatalog(term)).courses[0];
    assert.ok(course, 'The current term needs a course');
    for (const { api, id } of students) {
      assert.equal(await api.courses.joinCourse(course.id, id), 'joined');
      assert.ok((await api.courses.getMyCourses(id)).some(row => row.id === course.id && api.courses.isCurrentCourse(row)));
    }
    const classmates = await helper.api.courses.getCourseClassmates(course.id);
    const match = classmates.find(row => row.profileId === poster.id);
    assert.ok(match);
    assert.equal(match.sharedInterestCount, 1);
    assert.equal((await helper.api.profiles.getProfileById(match.profileId)).displayName, poster.displayName);
    console.log('PASS enrollments persist and the helper opens the poster’s classmate profile');

    const requestId = await poster.api.requests.saveRequest({
      category: 'STUDY HELP', title: 'Student journey study session', description: 'Review course material in the library.',
      campus: 'Burnaby', roomLocation: 'Library', deadlineAt: new Date(Date.now() + 86400000).toISOString(),
      points: 10, itemSize: 'Medium', courseOrSubject: course.code, studyTopic: 'Practice problems',
    });
    const feed = await helper.api.requests.loadRequests('STUDY HELP', null, 0);
    assert.ok(feed.items.some(row => row.id === requestId && row.ownerId === poster.id));
    const details = await helper.api.requests.loadRequest(requestId);
    const offer = await helper.api.offers.submitOffer(helper.id, details.id, 'I can help.', details.offerRound, details.points);
    const offered = await poster.api.offers.loadOfferPage(poster.id, requestId);
    assert.ok(offered.items.some(row => row.id === offer && row.offering_user_id === helper.id && row.status === 'pending'));
    const offerNotice = (await poster.api.notifications.loadNotificationPage(poster.id)).items.find(row => row.offer_id === offer);
    assert.equal(offerNotice?.event_type, 'offer_created');
    assert.equal(poster.api.notifications.getNotificationTarget(offerNotice).params.id, requestId);
    await poster.api.offers.decideOffer(poster.id, offer, 'accepted', details.offerRound, details.points);
    assert.equal((await helper.api.requests.loadRequest(requestId)).status, 'accepted');
    assert.equal((await poster.api.points.readWallet(poster.id)).reserved, 10);
    console.log('PASS the helper finds the request, offers help and receives the assignment');

    const conversation = await helper.api.requestContacts.startRequestContactConversation(helper.id, requestId, poster.id);
    assert.equal(await poster.api.messages.startDirectConversation(poster.id, helper.id), conversation);
    const sent = await helper.api.messages.sendMessage(helper.id, {
      conversationId: conversation, clientMessageId: randomUUID(), body: 'See you at the library',
    });
    const inbox = await poster.api.notifications.loadNotificationPage(poster.id);
    const notice = inbox.items.find(row => row.event_type === 'message_received' && row.message_id === sent.id);
    assert.ok(notice && notice.read_at === null && notice.actor_id === helper.id);
    const target = poster.api.notifications.getNotificationTarget(notice);
    assert.equal(target.pathname, '/messages/[id]');
    assert.equal(target.params.id, conversation);
    await poster.api.notifications.markNotificationRead(poster.id, notice.id);
    assert.equal(await poster.api.messages.loadUnreadMessageCount(poster.id), 1);
    const history = await poster.api.messages.loadMessagePage(poster.id, target.params.id);
    assert.ok(history.items.some(row => row.id === sent.id && row.body === 'See you at the library'));
    await poster.api.messages.markConversationRead(poster.id, target.params.id, sent.sequence);
    assert.equal(await poster.api.messages.loadUnreadMessageCount(poster.id), 0);
    console.log('PASS the DM notification opens the matching conversation and reading it clears unread messages');

    await poster.api.points.completeRequest(poster.id, requestId, details.offerRound);
    assert.equal((await helper.api.requests.loadRequest(requestId)).status, 'completed');
    assert.equal((await poster.api.points.readWallet(poster.id)).available, 90);
    assert.equal((await helper.api.points.readWallet(helper.id)).available, 110);
    const completed = (await helper.api.notifications.loadNotificationPage(helper.id)).items
      .find(row => row.event_type === 'request_completed' && row.request_id === requestId);
    assert.ok(completed);
    console.log('PASS completion transfers the reserved points and notifies the helper');
  } finally {
    await Promise.allSettled(students.map(({ client }) => client.auth.signOut({ scope: 'local' })));
    cleanupStudentFixtures(accounts);
  }
}

run().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
