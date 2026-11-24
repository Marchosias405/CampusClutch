/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the Android screen's actual input, picker and submission handlers without a device.
const filename = path.resolve(__dirname, '../src/app/requests/create.tsx');
function compile(fileName) {
  return ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
    fileName,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
}
const source = compile(filename);
const draftSource = compile(path.resolve(__dirname, '../src/lib/requestFormDraft.ts'));

function loadDraftStore(storage) {
  const exports = {};
  vm.runInNewContext(draftSource, {
    exports, require: name => {
      if (name === '@react-native-async-storage/async-storage') return storage;
      if (name === './env') return { env: { supabaseUrl: 'http://127.0.0.1:54321' } };
      assert.fail(`Unexpected draft dependency ${name}`);
    },
  });
  return exports;
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

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: async key => entries.get(key) ?? null,
    setItem: async (key, value) => { entries.set(key, value); },
    removeItem: async key => { entries.delete(key); },
  };
}

function makeForm(save = async () => 'created-id', {
  editId, loadRequest, fontScale = 1, storage = memoryStorage(), userId = 'poster',
} = {}) {
  const slots = [], calls = [], routes = [], timers = [];
  const effects = [];
  const removeListeners = new Set();
  const navigation = {
    addListener(event, listener) {
      assert.equal(event, 'beforeRemove');
      removeListeners.add(listener);
      return () => removeListeners.delete(listener);
    },
  };
  let cursor, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous && deps && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  const mocks = {
    '@/components/motion': require('./motion-test-mock.cjs'),
    react,
    'react-native': {
      ...Object.fromEntries(['Pressable', 'Text', 'TextInput', 'View', 'KeyboardAvoidingView', 'ScrollView'].map(name => [name, name])),
      Platform: { OS: 'android' }, StyleSheet: { create: styles => styles },
      useWindowDimensions: () => ({ width: 393, height: 850, scale: 2.75, fontScale }),
    },
    '@expo/vector-icons': { FontAwesome5: 'FontAwesome5', Ionicons: 'Ionicons' },
    '@react-native-community/datetimepicker': 'DateTimePicker',
    '../../lib/requestFormDraft': loadDraftStore(storage),
    'expo-router': {
      useLocalSearchParams: () => ({ edit: editId }), useNavigation: () => navigation,
      useRouter: () => ({ replace: route => routes.push(route), back: removeRoute }),
    },
    '../../components/ScreenHeader': 'ScreenHeader',
    '../../context/AuthContext': { useAuth: () => ({ user: { id: userId } }) },
    '../../context/RequestsContext': { useRequests: () => ({ addRequest: (...args) => { calls.push(args); return save(...args); } }) },
    '../../lib/requests': { loadRequest, requestError: error => error.message },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, require: name => { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; },
    setTimeout: callback => timers.push(callback), clearTimeout: id => { delete timers[id - 1]; },
  });
  function render() {
    cursor = 0;
    tree = exports.default();
    if (typeof tree.type === 'function') tree = tree.type(tree.props);
    effects.splice(0).forEach(effect => effect());
  }
  function find(parent, predicate, description) {
    const item = nodes(parent).find(predicate);
    assert.ok(item, `Missing ${description}`);
    return item;
  }
  function group(label) {
    return find(tree, n => n.type === 'View' && n.props.children.some(child =>
      child?.type === 'Text' && textOf(child) === label), label);
  }
  function field(label, type = 'TextInput') {
    return find(group(label), n => n.type === type, `${label} ${type}`);
  }
  function button(label) {
    return find(tree, n => n.type === 'Pressable' && textOf(n) === label, label);
  }
  function fill(label, value) { field(label).props.onChangeText(value); render(); }
  function press(label) {
    const control = button(label);
    assert.ok(!control.props.disabled, `${label} is disabled`);
    const result = control.props.onPress();
    render();
    return result;
  }
  function date(value) {
    field('Deadline (end of day)', 'Pressable').props.onPress();
    render();
    const picker = find(tree, n => n.type === 'DateTimePicker', 'date picker');
    picker.props.onChange({ type: value ? 'set' : 'dismissed' }, value);
    render();
  }
  async function submit() { await press('Post Request'); render(); }
  async function settle() {
    await new Promise(resolve => setImmediate(resolve));
    render();
  }
  function removeRoute() {
    for (const listener of removeListeners) listener({ data: { action: { type: 'GO_BACK' } } });
    routes.push('back');
  }
  function unmount() {
    for (const slot of slots) slot?.cleanup?.();
  }
  async function rejects(message) {
    await submit();
    assert.equal(calls.length, 0, 'invalid submission reached the save API');
    assert.match(textOf(tree), message);
  }
  render();
  return { calls, routes, timers, render, button, field, group, fill, press, date, submit, rejects,
    settle, removeRoute, unmount, text: () => textOf(tree), nodes: () => nodes(tree) };
}

async function openForm(...args) {
  const form = makeForm(...args);
  await form.settle();
  return form;
}

const categories = {
  Delivery: [
    ['Pickup Location', 'pickupLocation', /enter the delivery pickup location/i],
    ['Drop-off Location', 'dropoffLocation', /enter the delivery drop-off location/i],
  ],
  Pickup: [
    ['Pickup Location', 'pickupLocation', /enter the pickup location/i],
    ['Destination', 'dropoffLocation', /enter the pickup destination/i],
  ],
  'Event Help': [
    ['Event Name', 'eventName', /enter the event name/i],
    ['Help Needed', 'eventTask', /describe the help needed/i],
  ],
  'Study Help': [
    ['Course or Subject', 'courseOrSubject', /enter the course or subject/i],
    ['Topic', 'studyTopic', /enter the study topic/i],
  ],
};

function relativeDay(offset) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12);
}

function fillCommon(form) {
  form.fill('Request Title', '  Help needed  ');
  form.fill('Room/Specific Location', '  AQ 3000  ');
  form.fill('Description', '  Help with my project  ');
  form.fill('Points Offered', '20');
}

function fillDetails(form, category) {
  for (const [label] of categories[category]) form.fill(label, `  ${label} value  `);
}

function ready(form) {
  fillCommon(form);
  fillDetails(form, 'Delivery');
  form.date(relativeDay(2));
}

test('reopening after Android background recreation restores the right student’s unsent request', async () => {
  const storage = memoryStorage();
  const original = await openForm(undefined, { storage });
  original.press('Study Help');
  fillCommon(original);
  fillDetails(original, 'Study Help');
  original.press('Burnaby');
  original.press('Surrey');
  const due = relativeDay(4);
  original.date(due);
  await original.settle();
  original.unmount();

  const other = await openForm(undefined, { storage, userId: 'different-student' });
  assert.equal(other.field('Request Title').props.value, '');
  other.unmount();

  const reopened = await openForm(undefined, { storage, fontScale: 1.5 });
  assert.equal(reopened.button('Study Help').props['aria-checked'], true);
  assert.equal(reopened.field('Request Title').props.value, '  Help needed  ');
  assert.equal(reopened.field('Room/Specific Location').props.value, '  AQ 3000  ');
  assert.equal(reopened.field('Description').props.value, '  Help with my project  ');
  assert.equal(reopened.field('Points Offered').props.value, '20');
  assert.equal(reopened.field('Course or Subject').props.value, '  Course or Subject value  ');
  assert.equal(reopened.field('Topic').props.value, '  Topic value  ');
  assert.equal(reopened.field('Campus', 'Pressable').props.accessibilityLabel, 'Campus, Surrey');
  assert.equal(reopened.calls.length, 0, 'restoring a draft must never post it');
  await reopened.submit();
  const [payload] = reopened.calls[0];
  due.setHours(23, 59, 59, 999);
  assert.equal(payload.deadlineAt, due.toISOString());
  reopened.unmount();

  const afterPost = await openForm(undefined, { storage });
  assert.equal(afterPost.field('Request Title').props.value, '');
});

test('leaving the form with Back discards a previously captured draft', async () => {
  for (const goBack of [
    form => form.nodes().find(node => node.props.accessibilityLabel === 'Back').props.onPress(),
    form => form.removeRoute(),
  ]) {
    const storage = memoryStorage();
    const form = await openForm(undefined, { storage });
    form.fill('Request Title', 'Old request');
    await form.settle();
    goBack(form);
    form.unmount();
    const reopened = await openForm(undefined, { storage });
    assert.equal(reopened.field('Request Title').props.value, '');
  }
});

test('an edit draft belongs to its request and is ignored if the saved request has changed', async () => {
  const storage = memoryStorage();
  const row = {
    id: 'request-1', ownerId: 'poster', status: 'open', category: 'DELIVERY',
    title: 'Pickup for lab', description: 'Meet me by the lab',
    campus: 'Surrey', roomLocation: 'Lab 3000', pickupLocation: 'Library',
    dropoffLocation: 'Lab 3000', points: 10, deadlineAt: relativeDay(3).toISOString(),
  };
  const options = { storage, editId: row.id, loadRequest: async () => row };
  const edit = await openForm(undefined, options);
  edit.fill('Request Title', 'New meeting spot');
  await edit.settle();
  edit.unmount();

  const newRequest = await openForm(undefined, { storage });
  assert.equal(newRequest.field('Request Title').props.value, '');
  newRequest.unmount();
  const anotherEdit = await openForm(undefined, { ...options, editId: 'request-2',
    loadRequest: async () => ({ ...row, id: 'request-2' }) });
  assert.equal(anotherEdit.field('Request Title').props.value, row.title);
  anotherEdit.unmount();

  const sameEdit = await openForm(undefined, options);
  assert.equal(sameEdit.field('Request Title').props.value, 'New meeting spot');
  sameEdit.unmount();
  row.points = 12;
  const refreshed = await openForm(undefined, options);
  assert.equal(refreshed.field('Request Title').props.value, row.title);
  assert.equal(refreshed.field('Points Offered').props.value, '12');
});

test('a failed submission still reopens with the unsaved values', async () => {
  const storage = memoryStorage();
  const form = await openForm(async () => { throw new Error('Offline'); }, { storage });
  ready(form);
  await form.submit();
  assert.match(form.text(), /Offline/);
  await form.settle();
  form.unmount();
  const retry = await openForm(undefined, { storage });
  assert.equal(retry.field('Request Title').props.value, '  Help needed  ');
  assert.equal(retry.field('Points Offered').props.value, '20');
  assert.equal(retry.calls.length, 0);
});

test('a late success after unmount clears the posted draft but preserves subsequent changes', async () => {
  for (const newTitle of [null, 'A newer request']) {
    const storage = memoryStorage();
    let acknowledge;
    const sending = await openForm(() => new Promise(resolve => { acknowledge = resolve; }), { storage });
    ready(sending);
    await sending.settle();
    const sent = sending.press('Post Request');
    sending.unmount();
    if (newTitle !== null) {
      const reopening = await openForm(undefined, { storage });
      reopening.fill('Request Title', newTitle);
      await reopening.settle();
      reopening.unmount();
    }
    acknowledge('posted-id');
    await sent;
    const afterAck = await openForm(undefined, { storage });
    assert.equal(afterAck.field('Request Title').props.value, newTitle ?? '');
    assert.equal(sending.routes.length, 0, 'an unmounted form cannot navigate a new session');
  }
});

test('clearing a request draft wins over earlier delayed writes, even after a storage error', async () => {
  const storage = memoryStorage();
  const write = storage.setItem;
  let release, writes = 0;
  storage.setItem = async (...args) => {
    if (++writes === 1) await new Promise(resolve => { release = resolve; });
    if (writes === 2) throw new Error('Write failed');
    await write(...args);
  };
  const store = loadDraftStore(storage);
  const key = store.requestDraftKey('poster');
  const save = title => store.saveRequestDraft(key, '', { ...store.emptyRequestForm, requestTitle: title });
  const first = save('First');
  const failed = assert.rejects(save('Second'), /Write failed/);
  const third = save('Third');
  const clear = store.clearRequestDraft(key);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1, 'the second write must wait for the first');
  release();
  await Promise.all([first, failed, third, clear]);
  assert.equal(await store.readRequestDraft(key, ''), null);
});

test('an unreadable draft opens a blank usable request form', async () => {
  const storage = memoryStorage();
  const key = loadDraftStore(storage).requestDraftKey('poster');
  await storage.setItem(key, '{"incomplete');
  const form = await openForm(undefined, { storage });
  assert.equal(form.field('Request Title').props.value, '');
  form.fill('Request Title', 'Fresh draft');
  await form.settle();
  form.unmount();
  const reopened = await openForm(undefined, { storage });
  assert.equal(reopened.field('Request Title').props.value, 'Fresh draft');
});

test('the Android form names its controls and exposes selection, disclosure and error states', async () => {
  const form = await openForm();
  const back = form.nodes().find(node => node.props.accessibilityLabel === 'Back');
  assert.equal(back.props.accessibilityRole, 'button');
  assert.ok(back.props.style.width >= 48 && back.props.style.height >= 48);
  const labels = {
    'Request Title': 'Request title', 'Room/Specific Location': 'Room or specific location',
    'Description': 'Description', 'Points Offered': 'Points offered',
  };
  for (const [visible, accessible] of Object.entries(labels)) {
    assert.equal(form.field(visible).props.accessibilityLabel, accessible);
  }
  const points = form.field('Points Offered').props;
  assert.equal(points.inputMode, 'numeric');
  assert.equal(points.keyboardType, 'number-pad');
  for (const [category, fields] of Object.entries(categories)) {
    form.press(category);
    assert.equal(form.button(category).props['aria-checked'], true);
    for (const [visible] of fields) {
      assert.equal(form.field(visible).props.accessibilityLabel.toLowerCase(), visible.toLowerCase());
    }
  }
  const campusSelector = () => form.field('Campus', 'Pressable').props;
  assert.equal(campusSelector().accessibilityLabel, 'Campus, Burnaby');
  assert.equal(campusSelector()['aria-expanded'], false);
  form.press('Burnaby');
  assert.equal(campusSelector()['aria-expanded'], true);
  const campusRadios = form.nodes().filter(node => node.props.accessibilityRole === 'radio' && ['Burnaby', 'Surrey'].includes(node.props.accessibilityLabel));
  assert.deepEqual(campusRadios.map(node => node.props['aria-checked']), [true, false]);
  form.press('Surrey');
  assert.equal(campusSelector().accessibilityLabel, 'Campus, Surrey');
  const deadline = () => form.field('Deadline (end of day)', 'Pressable').props;
  assert.match(deadline().accessibilityLabel, /Deadline.*Pick date/);
  assert.equal(deadline()['aria-expanded'], false);
  form.date(relativeDay(2));
  assert.doesNotMatch(deadline().accessibilityLabel, /Pick date/);
  await form.rejects(/Enter a title/);
  const alerts = form.nodes().filter(node => node.props.accessibilityRole === 'alert');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].props.accessibilityLiveRegion, 'assertive');
});

test('paired form fields reserve more space when Android system text size increases', async () => {
  function columnWidth(form, label) {
    const style = Object.assign({}, ...form.group(label).props.style.flat(Infinity));
    return style.flexBasis;
  }
  const normal = await openForm();
  const enlarged = await openForm(undefined, { fontScale: 2 });
  for (const label of ['Campus', 'Room/Specific Location', 'Deadline (end of day)', 'Points Offered']) {
    assert.ok(columnWidth(enlarged, label) > columnWidth(normal, label), label);
  }
});

test('edit loading is announced once, and only a failed load enables retry', async () => {
  let attempts = 0;
  const loadRequest = async () => {
    if (++attempts === 1) throw new Error('Could not load request');
    return {
      ownerId: 'poster', status: 'open', category: 'DELIVERY', title: 'Request to edit', description: 'Request description',
      campus: 'Burnaby', points: 10, deadlineAt: relativeDay(2).toISOString(),
    };
  };
  const form = makeForm(undefined, { editId: 'request-id', loadRequest });
  const save = () => form.button('Save Changes').props;
  assert.equal(save().accessibilityState.busy, true);
  assert.equal(save().disabled, true);
  assert.doesNotMatch(form.text(), /retry/i);
  assert.equal(form.button('Delivery').props.disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  form.render();
  assert.equal(form.text().split('Could not load request').length, 2, 'report the error once');
  assert.equal(save().accessibilityState.busy, false);
  form.press('Retry loading request');
  assert.doesNotMatch(form.text(), /retry/i);
  assert.equal(save().disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  form.render();
  assert.equal(save().disabled, false);
  assert.equal(form.field('Request Title').props.value, 'Request to edit');
  assert.doesNotMatch(form.text(), /retry|loading request|could not load request/i);
});

for (const [category, fields] of Object.entries(categories)) {
  test(`${category} requires its own fields and submits only the selected category's details`, async () => {
    const form = await openForm();
    const staleCategory = category === 'Study Help' ? 'Event Help' : 'Study Help';
    form.press(staleCategory);
    fillDetails(form, staleCategory);
    form.press(category);
    assert.doesNotMatch(form.text(), /Item\/Task Size/i);
    fillCommon(form);
    form.press('Burnaby');
    form.press('Surrey');
    const date = relativeDay(2);
    form.date(date);
    for (const [label, , error] of fields) {
      form.fill(label, '   ');
      await form.rejects(error);
      form.fill(label, `  ${label} value  `);
    }
    await form.submit();
    assert.equal(form.calls.length, 1);
    const [payload, editId] = form.calls[0];
    assert.equal(editId, undefined);
    assert.equal(payload.category, category.toUpperCase());
    assert.equal(payload.campus, 'Surrey');
    assert.equal(payload.roomLocation, 'AQ 3000');
    assert.equal(payload.title, 'Help needed');
    assert.equal(payload.description, 'Help with my project');
    assert.equal(payload.points, 20);
    assert.equal(payload.itemSize, 'Medium');
    date.setHours(23, 59, 59, 999);
    assert.equal(payload.deadlineAt, date.toISOString());
    for (const [label, key] of fields) assert.equal(payload[key], `${label} value`);
    for (const [, key] of categories[staleCategory]) assert.ok(!(key in payload), `unexpected ${key}`);
    assert.match(form.text(), /Request posted successfully/i);
  });
}

test('required common fields and trimmed text boundaries', async () => {
  const form = await openForm();
  ready(form);
  for (const value of [' ', 'X'.repeat(121)]) {
    form.fill('Request Title', value);
    await form.rejects(/title of 1.120 characters/i);
  }
  form.fill('Request Title', '  T  ');
  form.fill('Room/Specific Location', ' ');
  await form.rejects(/enter a room or specific location/i);
  form.fill('Room/Specific Location', 'AQ');
  for (const value of [' ', ' 123456789 ', 'x'.repeat(4001)]) {
    form.fill('Description', value);
    await form.rejects(/description must contain 10.4000 characters/i);
  }
  form.fill('Description', ' 1234567890 ');
  await form.submit();
  assert.equal(form.calls[0][0].title, 'T');
  assert.equal(form.calls[0][0].description, '1234567890');
  const maximum = await openForm();
  ready(maximum);
  maximum.fill('Request Title', 'T'.repeat(120));
  maximum.fill('Description', 'D'.repeat(4000));
  await maximum.submit();
  assert.equal(maximum.calls[0][0].title.length, 120);
  assert.equal(maximum.calls[0][0].description.length, 4000);
});

test('missing and past deadlines cannot be posted', async () => {
  const form = await openForm();
  fillCommon(form);
  fillDetails(form, 'Delivery');
  form.date(null);
  await form.rejects(/select a deadline/i);
  form.date(relativeDay(-1));
  await form.rejects(/future deadline/i);
});

test('pasted points must be positive whole decimal digits within the integer limit', async () => {
  const form = await openForm();
  ready(form);
  form.fill('Points Offered', ' ');
  await form.rejects(/enter points/i);
  for (const value of ['0', '-1', '3.5', '1e2', '0x10', '1.00000000000000001', 'abc', '2147483648']) {
    form.fill('Points Offered', value);
    await form.rejects(/whole number/i);
  }
  for (const value of ['1', '2147483647']) {
    const valid = await openForm();
    ready(valid);
    valid.fill('Points Offered', value);
    await valid.submit();
    assert.equal(valid.calls[0][0].points, Number(value));
  }
});

test('the poster can correct an unaffordable reward without re-entering the request', async () => {
  const form = await openForm(async payload => {
    if (payload.points > 10) {
      throw Object.assign(new Error('You have 10 available points. Offer no more than this amount.'), { code: 'P0002' });
    }
    return 'affordable-id';
  });
  ready(form);
  await form.submit();
  assert.match(form.text(), /10 available points/);
  assert.equal(form.routes.length, 0);
  form.fill('Points Offered', '10');
  await form.submit();
  assert.deepEqual(form.calls.map(([payload]) => payload.points), [20, 10]);
  assert.match(form.text(), /Request posted successfully/i);
});

test('failed saves preserve the draft and retry is protected against duplicate taps', async () => {
  let resolveRetry, attempts = 0;
  const form = await openForm(async () => {
    if (++attempts === 1) throw new Error('Unable to reach requests');
    return new Promise(resolve => { resolveRetry = resolve; });
  });
  ready(form);
  await form.submit();
  assert.match(form.text(), /Unable to reach requests/);
  const fingerprint = ({ createdAt, ...draft }) => draft;
  assert.equal(form.field('Request Title').props.value, '  Help needed  ');
  assert.equal(form.field('Points Offered').props.value, '20');
  const onPress = form.button('Post Request').props.onPress;
  const retry = onPress();
  await onPress(); // A second tap before React can redraw the disabled button.
  form.render();
  assert.equal(form.button('Posting...').props.disabled, true);
  assert.equal(form.calls.length, 2);
  assert.deepEqual(fingerprint(form.calls[0][0]), fingerprint(form.calls[1][0]));
  resolveRetry('retry-id');
  await retry;
  form.render();
  assert.equal(form.button('Request Posted').props.disabled, true);
  assert.equal(form.timers.length, 1);
  form.timers[0]();
  assert.equal(form.routes[0].pathname, '/requests/[id]');
  assert.equal(form.routes[0].params.id, 'retry-id');
});
