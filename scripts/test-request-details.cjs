/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/app/requests/[id].tsx');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function row(overrides = {}) {
  return { id: 'r1', ownerId: 'owner', status: 'open', category: 'DELIVERY', offerRound: 3,
    title: 'Test request', description: 'Bring the parcel', location: 'Burnaby Campus • AQ 3000',
    timeLabel: 'Tomorrow', points: 20, ...overrides };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props.children)];
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node == null || typeof node === 'boolean') return '';
  return typeof node === 'object' ? textOf(node.props.children) : String(node);
}

function screen({ userId = 'owner', requestId = 'r1' } = {}) {
  const reads = [], writes = [], alerts = [], routes = [];
  const timers = new Set();
  let slots = [], cursor, tree, dirty = true, focused = true, innerKey;
  let effect, cleanup, nextEffect, invalidations = 0;
  let user = userId ? { id: userId } : null;

  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++;
      const slot = slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slot.value, next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(slot.value, value)) { slot.value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) {
      const i = cursor++;
      if (!slots[i] || !deps.every((dep, index) => Object.is(dep, slots[i].deps[index]))) slots[i] = { callback, deps };
      return slots[i].callback;
    },
  };
  function pending(list, kind, args) {
    return new Promise((resolve, reject) => { list.push({ kind, args, resolve, reject }); });
  }
  const modules = {
    '@/components/LoadingState': require('./loading-test-mock.cjs'),
    '../../lib/useDirectAdmin': { useDirectAdmin: () => ({ allowed: false, open() {} }) },
    react,
    'react-native': {
      ...Object.fromEntries(['Pressable', 'Text', 'View', 'ScrollView', 'RefreshControl'].map(name => [name, name])),
      StyleSheet: { create: styles => styles },
      useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
      Alert: { alert: (title, message, buttons) => alerts.push({ title, message, buttons }) },
    },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': {
      useFocusEffect: callback => { nextEffect = callback; },
      useLocalSearchParams: () => ({ id: requestId }),
      useRouter: () => ({ back: () => routes.push('back'), push: route => routes.push(route) }),
    },
    '../../context/AuthContext': { useAuth: () => ({ user }) },
    '../../context/RequestsContext': { useRequests: () => ({ invalidate: () => { invalidations++; } }) },
    '../../lib/requests': {
      loadRequest: (...args) => pending(reads, 'load', args),
      cancelRequest: (...args) => pending(writes, 'cancel', args),
      setRequestArchived: (...args) => pending(writes, 'archive', args),
      requestError: error => error.message,
    },
  };
  for (const name of ['ScreenHeader', 'RequestOffers', 'ReopenRequest', 'RequestCompletion', 'RequestRating', 'RequestConversation']) {
    modules['../../components/' + name] = name;
  }
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { assert.ok(name in modules, 'Unexpected import ' + name); return modules[name]; },
    setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback) });

  function render() {
    let count = 0;
    while (dirty) {
      assert.ok(++count < 50, 'Render loop should settle');
      dirty = false;
      cursor = 0;
      tree = exports.default();
      if (typeof tree.type === 'function') {
        if (tree.props.key !== innerKey) {
          cleanup?.();
          slots = [];
          effect = cleanup = undefined;
          innerKey = tree.props.key;
        }
        cursor = 0;
        tree = tree.type(tree.props);
      }
      if (nextEffect !== effect) {
        cleanup?.();
        effect = nextEffect;
        cleanup = focused ? effect?.() : undefined;
      }
    }
  }
  async function settle() { render(); await new Promise(setImmediate); render(); }
  function blur() { focused = false; cleanup?.(); cleanup = undefined; render(); }
  function focus() { focused = true; cleanup = effect?.(); render(); }
  function switchTo(id, routeId) { user = id ? { id } : null; requestId = routeId; dirty = true; render(); }
  const button = label => nodes(tree).find(n => n.type === 'Pressable' && textOf(n) === label);
  const component = type => nodes(tree).find(n => n.type === type);
  function press(label) {
    const found = button(label);
    assert.ok(found && !found.props.disabled, 'Expected enabled button ' + label);
    found.props.onPress(); render();
  }
  function confirm(label) {
    const choice = alerts.at(-1)?.buttons.find(item => item.text === label);
    assert.ok(choice, 'Expected alert option ' + label);
    choice.onPress?.(); render();
  }
  function pull() { component('ScrollView').props.refreshControl.props.onRefresh(); render(); }
  function tick() { for (const callback of timers) callback(); render(); }
  render();
  return { reads, writes, alerts, routes, settle, blur, focus, switchTo, button, component, press, confirm, pull, tick,
    text: () => textOf(tree), invalidations: () => invalidations };
}

async function show(app, data) { app.reads.at(-1).resolve(data); await app.settle(); }

test('load errors can be retried and unavailable requests retain the offers entry point', async () => {
  const app = screen({ requestId: ['r1'] });
  assert.deepEqual(app.reads[0].args, ['r1']);
  assert.equal(app.component('LoadingSkeleton')?.props.label, 'Loading request…');
  assert.equal(app.button('Retry'), undefined);
  app.reads[0].reject(Error('Connection lost'));
  await app.settle();
  assert.match(app.text(), /Unable to load request.*Connection lost/);
  assert.equal(app.component('LoadingSkeleton'), undefined, 'Errors must replace the initial placeholder');
  assert.equal(app.component('RequestOffers'), undefined);
  app.press('Retry');
  await show(app, null);
  assert.match(app.text(), /Request unavailable/);
  assert.equal(app.component('RequestOffers').props.requestId, 'r1');
  app.press('Retry');
  await show(app, row());
  assert.match(app.text(), /Test request/);
  assert.equal(app.button('Retry'), undefined);
});

test('the four categories display their own detail labels, location, deadline and points', async () => {
  const cases = [
    ['DELIVERY', { pickupLocation: 'Library', dropoffLocation: 'Dining Hall' }, ['Pickup LocationLibrary', 'Drop-off LocationDining Hall']],
    ['PICKUP', { pickupLocation: 'Gym', dropoffLocation: 'Bus loop' }, ['Pickup LocationGym', 'DestinationBus loop']],
    ['EVENT HELP', { eventName: 'Open house', eventTask: 'Set up chairs' }, ['Event NameOpen house', 'Help NeededSet up chairs']],
    ['STUDY HELP', { courseOrSubject: 'CMPT 120', studyTopic: 'Recursion' }, ['Course/SubjectCMPT 120', 'Study TopicRecursion']],
  ];
  for (const [category, details, expected] of cases) {
    const app = screen();
    const request = row({ category, ...details, isUrgent: true });
    await show(app, request);
    for (const part of [category, 'URGENT', request.title, request.description, request.location,
      request.timeLabel, '20 points', 'StatusOpen', ...expected]) assert.ok(app.text().includes(part), part);
    assert.doesNotMatch(app.text(), /Item\/Task Size/);
  }
});

test('owner controls follow request status and other students cannot edit or cancel', async () => {
  const actions = ['Edit Request', 'Cancel Request', 'Archive Request', 'Restore Request'];
  const cases = [
    ['open', false, actions.slice(0, 2)], ['accepted', false, ['Cancel Request']],
    ['completed', false, ['Archive Request']], ['expired', false, ['Archive Request']],
    ['cancelled', false, ['Archive Request']], ['cancelled', true, ['Restore Request']],
  ];
  for (const [status, archived, expected] of cases) {
    for (const userId of ['owner', 'viewer']) {
      const app = screen({ userId });
      await show(app, row({ status, ownerArchivedAt: archived ? '2026-10-01' : null }));
      assert.doesNotMatch(app.text(), /90 days/, 'Reopened requests keep their history');
      assert.deepEqual(actions.filter(label => app.button(label)), userId === 'owner' ? expected : [], userId + '/' + status);
      assert.equal(Boolean(app.component('RequestCompletion')), ['accepted', 'completed'].includes(status));
      if (app.button('Edit Request')) {
        app.press('Edit Request');
        assert.equal(app.routes[0].pathname, '/requests/create');
        assert.equal(app.routes[0].params.edit, 'r1');
      }
    }
  }
});

test('offers, conversations and ratings receive the displayed request and current revision', async () => {
  const app = screen();
  const request = row({ status: 'accepted' });
  await show(app, request);
  assert.equal(app.component('ReopenRequest').props.request, request);
  assert.equal(app.component('RequestCompletion').props.request, request);
  assert.equal(app.component('RequestOffers').props.request, request);
  for (const name of ['RequestRating', 'RequestConversation']) {
    assert.equal(app.component(name).props.requestId, 'r1');
    assert.equal(app.component(name).props.requestRevision, '3:accepted');
  }
  const before = app.component('RequestOffers').props.ratingsRevision;
  await app.component('RequestRating').props.onChanged();
  await app.settle();
  assert.equal(app.component('RequestOffers').props.ratingsRevision, before + 1);
});

for (const status of ['open', 'accepted']) {
  test('cancelling an ' + status + ' request requires confirmation and sends its exact round and status once', async () => {
    const app = screen();
    await show(app, row({ status }));
    app.press('Cancel Request');
    if (status === 'accepted') assert.match(app.alerts[0].message, /releases reserved points/i);
    app.confirm('Keep request');
    assert.equal(app.writes.length, 0);
    app.press('Cancel Request');
    app.confirm('Cancel request');
    app.confirm('Cancel request');
    assert.deepEqual(app.writes.map(write => [write.kind, ...write.args]), [['cancel', 'owner', 'r1', 3, status]]);
    assert.equal(app.button('Cancelling…').props.disabled, true);
    app.writes[0].resolve();
    await app.settle();
    assert.equal(app.invalidations(), 1);
    await show(app, row({ status: 'cancelled' }));
    assert.ok(app.button('Archive Request'));
    assert.equal(app.button('Cancel Request'), undefined);
  });
}

test('archive and restore update the owner’s history while the request stays closed', async () => {
  const app = screen();
  await show(app, row({ status: 'expired', offerRound: 1 }));
  assert.match(app.text(), /no offers.*90 days/i);
  for (const [choice, archive] of [['Archive', true], ['Restore', false]]) {
    app.press(choice + ' Request');
    if (!archive) assert.match(app.alerts.at(-1).message, /90-day window starts again/);
    const count = app.writes.length;
    app.confirm('Keep as is');
    assert.equal(app.writes.length, count);
    app.press(choice + ' Request');
    app.confirm(choice);
    const write = app.writes.at(-1);
    assert.equal(write.kind, 'archive');
    assert.deepEqual(write.args, ['owner', 'r1', archive]);
    write.resolve();
    await app.settle();
    assert.equal(app.invalidations(), count + 1);
    await show(app, row({ status: 'expired', offerRound: 1, ownerArchivedAt: archive ? '2026-10-01' : null }));
    assert.match(app.text(), /StatusExpired/);
    assert.ok(app.button(archive ? 'Restore Request' : 'Archive Request'));
  }
});

test('failed owner actions retain details, surface the error and allow a retry', async () => {
  const app = screen();
  await show(app, row());
  app.press('Cancel Request'); app.confirm('Cancel request');
  app.writes[0].reject(Error('Connection lost'));
  await app.settle();
  assert.match(app.text(), /Test request/);
  assert.match(app.text(), /Connection lost/);
  assert.equal(app.invalidations(), 0);
  app.press('Cancel Request'); app.confirm('Cancel request');
  assert.equal(app.writes.length, 2);
  app.writes[1].resolve();
  await app.settle();
  await show(app, row({ status: 'cancelled' }));
  assert.doesNotMatch(app.text(), /Connection lost/);
});

test('the newest refresh wins and an offline refresh keeps the last visible details', async () => {
  const app = screen();
  await show(app, row());
  app.tick();
  const slowRead = app.reads.at(-1);
  assert.equal(app.component('LoadingSkeleton'), undefined);
  assert.match(app.text(), /Test request/);
  assert.equal(app.component('ScrollView').props.refreshControl.props.refreshing, true);
  app.pull();
  await show(app, row({ title: 'Updated title', status: 'accepted' }));
  slowRead.resolve(row({ title: 'Stale title' }));
  await app.settle();
  assert.match(app.text(), /Updated title/);
  assert.equal(app.button('Edit Request'), undefined);
  app.pull();
  app.reads.at(-1).reject(Error('Offline'));
  await app.settle();
  assert.match(app.text(), /Offline/);
  assert.match(app.text(), /Updated title/);
  app.pull();
  await show(app, row({ title: 'Reconnected' }));
  assert.match(app.text(), /Reconnected/);
  assert.doesNotMatch(app.text(), /Offline/);
});

test('leaving and returning invalidates old owner dialogs, including archive and restore', async () => {
  for (const [label, choice, data] of [
    ['Cancel Request', 'Cancel request', row({ status: 'accepted' })],
    ['Archive Request', 'Archive', row({ status: 'completed' })],
    ['Restore Request', 'Restore', row({ status: 'completed', ownerArchivedAt: '2026-10-01' })],
  ]) {
    const app = screen();
    await show(app, data);
    app.press(label);
    app.blur();
    app.tick();
    assert.equal(app.reads.length, 1, 'polling must stop on blur');
    app.focus();
    await show(app, data);
    app.confirm(choice);
    assert.equal(app.writes.length, 0, label + ' from a previous visit must be ignored');
    app.press(label);
    app.confirm(choice);
    assert.equal(app.writes.length, 1, 'a fresh confirmation still works');
  }
});

test('a pending cancellation on one request cannot block or unlock actions on the next request', async () => {
  const app = screen();
  await show(app, row());
  app.press('Cancel Request');
  app.confirm('Cancel request');
  app.switchTo('owner', 'r2');
  await show(app, row({ id: 'r2', title: 'Second request' }));
  app.press('Cancel Request');
  app.confirm('Cancel request');
  assert.deepEqual(app.writes.map(write => write.args[1]), ['r1', 'r2']);
  app.writes[0].reject(Error('First request failed'));
  await app.settle();
  assert.equal(app.button('Cancelling…').props.disabled, true);
  assert.doesNotMatch(app.text(), /First request failed/);
  app.writes[1].resolve();
  await app.settle();
  await show(app, row({ id: 'r2', title: 'Second request', status: 'cancelled' }));
  assert.ok(app.button('Archive Request'));
});

test('old reads and owner confirmations cannot leak across account changes or sign-out', async () => {
  const app = screen();
  await show(app, row({ title: 'Owner only details' }));
  app.press('Cancel Request');
  app.pull();
  const oldRead = app.reads.at(-1);
  app.switchTo('viewer', 'r1');
  oldRead.resolve(row({ title: 'Stale owner details' }));
  await app.settle();
  assert.equal(app.component('LoadingSkeleton')?.props.label, 'Loading request…');
  assert.doesNotMatch(app.text(), /Owner only details|Stale owner details/);
  assert.equal(app.button('Cancel Request'), undefined);
  await show(app, null);
  app.confirm('Cancel request');
  assert.equal(app.writes.length, 0);
  app.press('Retry');
  const viewerRead = app.reads.at(-1);
  const count = app.reads.length;
  app.switchTo(null, 'r1');
  viewerRead.resolve(row());
  await app.settle();
  assert.equal(app.reads.length, count);
  assert.equal(app.component('RequestOffers'), undefined);
  assert.doesNotMatch(app.text(), /Test request/);
});
