const assert = require('node:assert/strict');
const test = require('node:test');
const { harness } = require('./test-message-entry-lifecycle.cjs');

const VIEWER = 'a0000000-0000-4000-8000-000000000001';
const STUDENT = 'b0000000-0000-4000-8000-000000000002';
const OTHER = 'c0000000-0000-4000-8000-000000000003';
const student = { id: STUDENT, displayName: 'Sam Lee', major: 'Computing', yearOfStudy: 2,
  onboardingCompletedAt: '2026-09-01', avatarPath: null };

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function screen({ initialUser, initialRoute, read = async () => student, interests = async () => [],
  social = async () => ({}), avatar = async () => null } = {}) {
  const reads = [], detailReads = [];
  const app = harness('student', { initialUser, initialRoute, dependencies: {
    '@/lib/profiles': {
      getProfileById: id => { reads.push(id); return read(id); },
      getProfileInterests: id => { detailReads.push(['interests', id]); return interests(id); },
      getProfileSocialLinks: id => { detailReads.push(['social', id]); return social(id); },
    },
    '@/lib/avatars': { getProfileAvatarSignedUrl: path => { detailReads.push(['avatar', path]); return avatar(path); } },
  } });
  return { ...app, reads, detailReads, images: () => app.elements().filter(node => node.type === 'Image') };
}

test('a real student displays profile, signed avatar, active and shared interests, and visible social data', async () => {
  const lookup = deferred();
  const music = { id: 'music', displayName: 'Music', isActive: true };
  const app = screen({
    read: () => lookup.promise,
    interests: async id => id === VIEWER ? [music] : [music,
      { id: 'robotics', displayName: 'Robotics', isActive: true }, { id: 'retired', displayName: 'Retired', isActive: false }],
    social: async () => ({ linkedin: null, instagram: { value: 'student.art', isVisible: true } }),
    avatar: async () => 'https://example.invalid/signed',
  });
  assert.equal(app.elements().find(node => node.type === 'LoadingSkeleton')?.props.label, 'Loading student profile');
  assert.deepEqual(app.detailReads, []);
  lookup.resolve({ ...student, avatarPath: 'student/avatar.jpg' });
  await app.settle();
  for (const label of ['Sam Lee', 'Computing', '2nd year', 'Music (In common)', 'Robotics', 'student.art']) {
    assert.ok(app.content().includes(label), label);
  }
  assert.doesNotMatch(app.content(), /Retired|Robotics \(In common\)|LinkedIn/);
  assert.equal(app.images()[0].props.source.uri, 'https://example.invalid/signed');
  assert.equal(app.elements().find(node => node.type === 'RatingSummary').props.profileId, STUDENT);
});

test('missing optional fields and a failed avatar URL keep a usable profile with initials', async () => {
  const app = screen({ read: async () => ({ ...student, major: null, yearOfStudy: null, avatarPath: 'expired' }),
    avatar: async () => { throw Error('signed URL unavailable'); } });
  await app.settle();
  for (const label of ['SL', 'Major not added', 'Year not added', 'No interests added yet.']) assert.ok(app.content().includes(label), label);
  assert.doesNotMatch(app.content(), /Social Profiles|Unable to load profile/);
  assert.equal(app.images().length, 0);
  assert.equal(app.button('Message').props.disabled, false);
});

test('invalid routes, signed-out visits and inaccessible profiles cannot fetch private details or offer a chat', async () => {
  for (const [options, expectedReads] of [[{ initialRoute: 'invalid' }, []], [{ initialUser: null }, []], [{}, [STUDENT]]]) {
    const app = screen({ ...options, read: async () => null });
    await app.settle();
    assert.match(app.content(), /Student not found/);
    assert.doesNotMatch(app.content(), /Message|Social Profiles/);
    assert.deepEqual(app.reads, expectedReads);
    assert.deepEqual(app.detailReads, []);
  }
});

test('failed profile and detail reads show safe feedback, and Retry returns the profile', async () => {
  for (const failure of ['profile', 'social']) {
    let online = false;
    function failIfOffline(source) {
      if (!online && failure === source) throw Error('private backend error');
    }
    const app = screen({ read: async () => { failIfOffline('profile'); return student; },
      social: async () => { failIfOffline('social'); return {}; } });
    await app.settle();
    assert.match(app.content(), /Unable to load profile/);
    assert.doesNotMatch(app.content(), /private backend error|Sam Lee|Message/);
    online = true;
    app.press('Retry');
    assert.equal(app.elements().find(node => node.type === 'LoadingSkeleton')?.props.label, 'Loading student profile');
    await app.settle();
    assert.match(app.content(), /Sam Lee/);
    assert.deepEqual(app.reads, [STUDENT, STUDENT]);
  }
});

test('a profile response arriving after sign-out or navigation never starts follow-up private reads', async () => {
  for (const transition of ['sign-out', 'route']) {
    const stale = deferred();
    const app = screen({ read: id => id === STUDENT ? stale.promise : Promise.resolve({ ...student, id, displayName: 'Next student' }) });
    if (transition === 'sign-out') app.switchAccount(null);
    else app.switchRoute(OTHER);
    await app.settle();
    const readCount = app.detailReads.length;
    stale.resolve({ ...student, avatarPath: 'stale-avatar' });
    await app.settle();
    assert.equal(app.detailReads.length, readCount, transition);
    assert.doesNotMatch(app.content(), /Sam Lee/);
    assert.match(app.content(), transition === 'sign-out' ? /Student not found/ : /Next student/);
  }
});

test('losing access while backgrounded removes formerly visible names, social links and message actions on return', async () => {
  let canRead = true;
  const app = screen({ read: async () => canRead ? student : null,
    social: async () => ({ instagram: { value: 'student.art', isVisible: true } }) });
  await app.settle();
  assert.match(app.content(), /student.art/);
  app.appState('background');
  canRead = false;
  app.appState('active');
  assert.equal(app.elements().find(node => node.type === 'LoadingSkeleton')?.props.label, 'Loading student profile');
  await app.settle();
  assert.match(app.content(), /Student not found/);
  assert.doesNotMatch(app.content(), /Sam Lee|student.art|Message/);
});

for (const transition of ['background', 'blur']) {
  test('returning after ' + transition + ' allows a fresh chat attempt while the old one is still pending', async () => {
    const app = screen();
    await app.settle();
    app.press('Message');
    if (transition === 'background') { app.appState('background'); app.appState('active'); }
    else { app.blur(); app.focus(); }
    await app.settle();
    app.press('Message');
    assert.equal(app.opens.length, 2);
    app.opens[0].resolve('stale-chat');
    await app.settle();
    assert.equal(app.navigation.length, 0);
    assert.equal(app.button('Opening chat…').props.disabled, true);
    app.opens[1].resolve('current-chat');
    await app.settle();
    assert.equal(app.navigation.length, 1);
    assert.equal(app.navigation[0].params.id, 'current-chat');
  });
}

test('blocking hides profile data and prevents an earlier Message handler while keeping unblock and report entry reachable', async () => {
  const app = screen();
  await app.settle();
  const previousMessage = app.button('Message').props.onPress;
  app.setBlockState({ profile_id: STUDENT, blocked_by_me: true, interaction_blocked: true, revision: '1' });
  await app.settle();
  assert.doesNotMatch(app.content(), /Sam Lee|Computing|Message/);
  const control = app.elements().find(node => node.type === 'BlockStudentControl');
  assert.equal(control.props.profileId, STUDENT);
  assert.equal(control.props.userId, VIEWER);
  assert.ok(app.button('Report student'));
  previousMessage();
  await app.settle();
  assert.equal(app.opens.length, 0);
  app.setBlockState({ profile_id: STUDENT, blocked_by_me: false, interaction_blocked: false, revision: '2' });
  await app.settle();
  assert.equal(app.button('Message').props.disabled, false);
});

test('profile messaging waits for block status and an old account callback cannot block a new account screen', async () => {
  const app = screen();
  await app.settle();
  const oldControl = app.elements().find(node => node.type === 'BlockStudentControl');
  app.setBlockState(null);
  await app.settle();
  assert.equal(app.button('Messaging unavailable').props.disabled, true);
  app.switchAccount(OTHER);
  await app.settle();
  oldControl.props.onState({ profile_id: STUDENT, blocked_by_me: true, interaction_blocked: true, revision: '1' });
  await app.settle();
  assert.match(app.content(), /Sam Lee/);
  assert.equal(app.button('Message').props.disabled, false);
  assert.equal(app.elements().find(node => node.type === 'BlockStudentControl').props.userId, OTHER);
});
