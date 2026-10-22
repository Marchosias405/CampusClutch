/* global __dirname */
// Exercise the production mixed inbox/thread and verify protected group-route wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const USER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const THIRD = '10000000-0000-4000-8000-000000000003';
const DIRECT = '20000000-0000-4000-8000-000000000001';
const GROUP = '20000000-0000-4000-8000-000000000002';
const COURSE = '30000000-0000-4000-8000-000000000001';
const TIME = '2026-10-09T12:00:00Z';

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function compile(file, reportDiagnostics = false) {
  return ts.transpileModule(source(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: file,
    reportDiagnostics,
  });
}

function production(file, modules = {}) {
  const exportsObject = {};
  vm.runInNewContext(compile(file).outputText, {
    exports: exportsObject,
    require(name) {
      if (!(name in modules)) throw Error(`Unexpected import from ${file}: ${name}`);
      return modules[name];
    },
  }, { filename: file });
  return exportsObject;
}

const createElement = (type, properties, ...children) => ({
  type,
  props: { ...properties, children },
});

function nodes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) {
    node.forEach(item => nodes(item, result));
    return result;
  }
  result.push(node);
  nodes(node.props?.children, result);
  return result;
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}

function base(overrides = {}) {
  return {
    status: 'active',
    last_message_at: TIME,
    last_activity_at: TIME,
    last_message_sequence: '4',
    last_read_sequence: '1',
    unread_count: 3,
    created_at: TIME,
    ...overrides,
  };
}

function directSummary(overrides = {}) {
  return base({
    id: DIRECT,
    type: 'direct',
    other_profile_id: OTHER,
    other_display_name: 'Direct Student',
    last_message_body: 'Direct hello',
    ...overrides,
  });
}

function groupSummary(overrides = {}) {
  return base({
    id: GROUP,
    type: 'group',
    other_profile_id: null,
    other_display_name: null,
    group_title: 'Study Crew',
    group_course_id: COURSE,
    group_course_code: 'CMPT 125',
    active_member_count: 4,
    my_role: 'member',
    my_membership_status: 'active',
    my_membership_period: 1,
    management_revision: '8',
    can_send: true,
    last_message_body: 'Group preview',
    ...overrides,
  });
}

function message(id, senderId, senderName, body) {
  return {
    id,
    conversation_id: GROUP,
    sender_id: senderId,
    sender_display_name: senderName,
    client_message_id: id.replace(/^4/, '5'),
    sequence: id.endsWith('1') ? '1' : id.endsWith('2') ? '2' : '3',
    body,
    created_at: TIME,
  };
}

const policy = production('src/lib/groupMessagingUi.ts');
const featureDefaults = production('src/lib/messagingFeatures.ts');
let checks = 0;
function test(name, run) {
  run();
  checks += 1;
  console.log('PASS ' + name);
}

function inboxHarness(search = '', groupsEnabled = true) {
  const pushes = [];
  const focusEffects = [];
  let invitationLoads = 0;
  const items = [groupSummary(), directSummary()];
  const state = {
    items,
    loaded: true,
    loading: false,
    error: null,
    cursor: null,
  };
  const model = {
    subscribe() { return () => {}; },
    getSnapshot: () => state,
    setActive() {},
    refresh() {},
  };
  let stateCall = 0;
  const react = {
    Fragment: 'Fragment',
    createElement,
    useMemo: callback => callback(),
    useCallback: callback => callback,
    useEffect() {},
    useRef: current => ({ current }),
    useState(initial) {
      const index = stateCall++;
      return [index === 0 ? search : initial, () => {}];
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const modules = {
    react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': {
      useFocusEffect(callback) { focusEffects.push(callback); },
      useRouter: () => ({ push: value => pushes.push(value) }),
    },
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      FlatList: 'FlatList',
      Pressable: 'Pressable',
      RefreshControl: 'RefreshControl',
      StyleSheet: { create: value => value },
      Text: 'Text',
      TextInput: 'TextInput',
      View: 'View',
    },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../context/AuthContext': { useAuth: () => ({ user: { id: USER } }) },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ unreadCount: 3, refreshUnread() {}, subscribeMessages: () => () => {} }) },
    '../../lib/conversationInbox': { createConversationInbox: () => model },
    '../../lib/groupConversations': { loadGroupInvitationPage: async () => { invitationLoads++; return { items: [], hasMore: false, nextCursor: null }; } },
    '../../lib/groupMessagingUi': policy,
    '../../lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: groupsEnabled },
    '../../lib/messages': { loadConversationPage: async () => ({ items, hasMore: false, nextCursor: null }) },
  };
  const component = production('src/app/(tabs)/messages.tsx', modules).default;
  const outer = component();
  const tree = outer.type(outer.props);
  const flatList = nodes(tree).find(node => node.type === 'FlatList');
  assert.ok(flatList, 'Production inbox must render a FlatList');
  return { flatList, pushes, tree, focus: () => focusEffects.forEach(callback => callback()), invitationLoads: () => invitationLoads };
}

function threadHarness(summary, groupsEnabled = true) {
  const pushes = [];
  const messages = [
    message('40000000-0000-4000-8000-000000000001', OTHER, 'Alex Helper', 'First'),
    message('40000000-0000-4000-8000-000000000002', THIRD, 'Blair Tutor', 'Second'),
    message('40000000-0000-4000-8000-000000000003', USER, 'Current User', 'Mine'),
  ];
  const state = {
    summary,
    messages,
    draft: 'Ready to send',
    pending: null,
    restored: true,
    sending: false,
    loading: false,
    loadingOlder: false,
    hasMore: false,
    error: '',
    readError: '',
    storageError: '',
    sendError: '',
  };
  const model = {
    subscribe() { return () => {}; },
    getSnapshot: () => state,
    setActive() {},
    setDraft() {},
    observe() {},
    refresh() {},
    loadOlder() {},
    send() {},
    discardPending() {},
    retryStorage() {},
  };
  let stateCall = 0;
  const react = {
    Fragment: 'Fragment',
    createElement,
    useMemo: callback => callback(),
    useCallback: callback => callback,
    useEffect() {},
    useLayoutEffect() {},
    useRef: current => ({ current }),
    useState(initial) {
      const index = stateCall++;
      return [index === 0 ? true : initial, () => {}];
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const modules = {
    react,
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@react-native-async-storage/async-storage': { default: {}, __esModule: true },
    'expo-router': {
      useFocusEffect() {},
      useLocalSearchParams: () => ({ id: summary.id }),
      useRouter: () => ({
        canGoBack: () => false,
        back() {},
        push: value => pushes.push(value),
        replace: value => pushes.push(value),
      }),
    },
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      Alert: { alert() {} },
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      FlatList: 'FlatList',
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' },
      Pressable: 'Pressable',
      StyleSheet: { create: value => value },
      Text: 'Text',
      TextInput: 'TextInput',
      View: 'View',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../../components/ScreenHeader': { default: 'ScreenHeader', __esModule: true },
    '../../context/AuthContext': { useAuth: () => ({ user: { id: USER } }) },
    '../../context/UnreadMessagesContext': { useUnreadMessages: () => ({ refreshUnread() {}, subscribeMessages: () => () => {} }) },
    '../../lib/env': { env: { supabaseUrl: 'http://localhost:54321' } },
    '../../lib/groupMessagingUi': policy,
    '../../lib/messagingFeatures': { GROUP_MESSAGING_ENABLED: groupsEnabled },
    '../../lib/messages': {
      loadConversationSummary() {}, loadMessagePage() {}, markConversationRead() {},
      messagingError: () => 'error', sendMessage() {},
    },
    '../../lib/messageThread': {
      compareSequences: (left, right) => Number(left) - Number(right),
      createMessageThread: () => model,
      isConversationId: () => true,
    },
  };
  const component = production('src/app/messages/[id].tsx', modules).default;
  const outer = component();
  let tree = outer.type(outer.props);
  while (typeof tree.type === 'function') tree = tree.type(tree.props);
  const all = nodes(tree);
  const flatList = all.find(node => node.type === 'FlatList');
  if (groupsEnabled || summary.type === 'direct') assert.ok(flatList, 'Available thread must render a FlatList');
  return { all, flatList, messages, pushes, tree };
}

test('release defaults defer group messaging', () => {
  assert.equal(featureDefaults.GROUP_MESSAGING_ENABLED, false);
});

test('deferred inbox hides group rows and all group entry points while direct messages remain available', () => {
  const app = inboxHarness('', featureDefaults.GROUP_MESSAGING_ENABLED);
  assert.equal(app.flatList.props.data.length, 1);
  assert.equal(app.flatList.props.data[0].type, 'direct');
  const controls = [...nodes(app.tree), ...nodes(app.flatList.props.ListHeaderComponent)];
  assert.equal(controls.some(node => node.props.accessibilityLabel === 'Create course group'), false);
  assert.equal(controls.some(node => /Group invitations|Open past groups/.test(node.props.accessibilityLabel ?? '')), false);
  const row = app.flatList.props.renderItem({ item: app.flatList.props.data[0] });
  row.props.onPress();
  assert.equal(app.pushes[0].params.id, DIRECT);
  assert.equal(inboxHarness('cmpt 125', false).flatList.props.data.length, 0);
});

test('deferred inbox focus does not query invitation previews', () => {
  const app = inboxHarness('', featureDefaults.GROUP_MESSAGING_ENABLED);
  app.focus();
  assert.equal(app.invitationLoads(), 0);
});

test('saved group conversation links cannot render messages, details or a composer', () => {
  for (const status of ['active', 'left', 'removed']) {
    const app = threadHarness(groupSummary({ my_membership_status: status }), featureDefaults.GROUP_MESSAGING_ENABLED);
    assert.equal(app.flatList, undefined);
    assert.match(textOf(app.tree), /Conversation unavailable/);
    assert.equal(app.all.some(node => node.type === 'TextInput'), false);
    assert.equal(app.all.some(node => node.props.accessibilityLabel === 'View group details'), false);
    assert.equal(textOf(app.tree).includes('Study Crew'), false);
  }
  assert.ok(threadHarness(directSummary(), false).flatList);
});

test('all deferred group deep links redirect before mounting account, data or storage hooks', () => {
  for (const file of ['create.tsx', 'invitations.tsx', 'history.tsx', '[id].tsx', 'invite/[id].tsx']) {
    const fullPath = `src/app/messages/groups/${file}`;
    const exported = {};
    vm.runInNewContext(compile(fullPath).outputText, {
      exports: exported,
      require(name) {
        if (name === 'react') return { createElement };
        if (name === 'expo-router') return { Redirect: 'Redirect' };
        if (name === 'react-native') return { StyleSheet: { create: value => value } };
        if (name.endsWith('/messagingFeatures')) return featureDefaults;
        // No auth/router/data functions exist in this harness: reaching any
        // account-specific hook before redirect is an immediate test failure.
        return {};
      },
    }, { filename: fullPath });
    const result = exported.default();
    assert.equal(result.type, 'Redirect', file);
    assert.equal(result.props.href, '/(tabs)/messages', file);
  }
});

test('production inbox renders group metadata/preview and navigates to the shared thread', () => {
  const app = inboxHarness();
  assert.equal(app.flatList.props.data.length, 2);
  const row = app.flatList.props.renderItem({ item: app.flatList.props.data[0] });
  const content = textOf(row);
  assert.match(content, /Study Crew/);
  assert.match(content, /CMPT 125 · 4 members/);
  assert.match(content, /Group preview/);
  assert.ok(nodes(row).some(node => node.type === 'Ionicons' && node.props.name === 'people'));
  row.props.onPress();
  assert.equal(app.pushes[0].pathname, '/messages/[id]');
  assert.equal(app.pushes[0].params.id, GROUP);
});

test('production inbox search uses group course/title and keeps direct rows compatible', () => {
  const searched = inboxHarness('cmpt 125');
  assert.equal(searched.flatList.props.data.length, 1);
  assert.equal(searched.flatList.props.data[0].id, GROUP);
  const ordinary = inboxHarness();
  const direct = ordinary.flatList.props.renderItem({ item: ordinary.flatList.props.data[1] });
  assert.match(textOf(direct), /Direct Student/);
  assert.match(textOf(direct), /Direct message/);
  assert.match(textOf(direct), /Direct hello/);
  direct.props.onPress();
  assert.equal(ordinary.pushes[0].params.id, DIRECT);
});

test('production inbox exposes group creation, invitations and former history entries', () => {
  const app = inboxHarness();
  const pressables = [
    ...nodes(app.tree),
    ...nodes(app.flatList.props.ListHeaderComponent),
  ].filter(node => node.type === 'Pressable');
  const create = pressables.find(node => node.props.accessibilityLabel === 'Create course group');
  const invitations = pressables.find(node => textOf(node).startsWith('Invitations'));
  const history = pressables.find(node => textOf(node) === 'Past groups');
  assert.ok(create && invitations && history);
  create.props.onPress(); invitations.props.onPress(); history.props.onPress();
  assert.equal(app.pushes[0], '/messages/groups/create');
  assert.equal(app.pushes[1], '/messages/groups/invitations');
  assert.equal(app.pushes[2], '/messages/groups/history');
});

test('production group thread shows each sender, allows compose, and links active members to details', () => {
  const app = threadHarness(groupSummary());
  const content = textOf(app.tree);
  assert.match(content, /Study Crew/);
  assert.match(content, /CMPT 125 · 4 members/);
  const senderLabels = app.messages.map(item => textOf(app.flatList.props.renderItem({ item })));
  assert.match(senderLabels[0], /Alex Helper/);
  assert.match(senderLabels[1], /Blair Tutor/);
  assert.match(senderLabels[2], /You/);
  const input = app.all.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Message text');
  const details = app.all.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'View group details');
  const send = app.all.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send message');
  assert.equal(input.props.editable, true);
  assert.equal(send.props.disabled, false);
  assert.ok(details);
  details.props.onPress();
  assert.equal(app.pushes[0].pathname, '/messages/groups/[id]');
  assert.equal(app.pushes[0].params.id, GROUP);
});

test('production former-member thread hides details and disables the composer', () => {
  const app = threadHarness(groupSummary({
    my_membership_status: 'left',
    can_send: false,
    active_member_count: 17,
  }));
  const content = textOf(app.tree);
  assert.match(content, /Read-only group history/);
  assert.match(content, /membership period/);
  assert.equal(content.includes('17 members'), false);
  assert.equal(app.all.some(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'View group details'), false);
  const input = app.all.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Message text');
  const send = app.all.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send message');
  assert.equal(input.props.editable, false);
  assert.equal(send.props.disabled, true);
});

test('production direct thread retains direct title/sender/compose behavior without group details', () => {
  const app = threadHarness(directSummary());
  assert.match(textOf(app.tree), /Direct Student/);
  assert.match(textOf(app.tree), /Direct messages/);
  assert.equal(app.all.some(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'View group details'), false);
  const label = textOf(app.flatList.props.renderItem({ item: app.messages[0] }));
  assert.match(label, /Direct Student/);
  const input = app.all.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Message text');
  assert.equal(input.props.editable, true);
});

test('all five new group routes transpile without syntax diagnostics', () => {
  const files = [
    'src/app/messages/groups/create.tsx',
    'src/app/messages/groups/invitations.tsx',
    'src/app/messages/groups/history.tsx',
    'src/app/messages/groups/[id].tsx',
    'src/app/messages/groups/invite/[id].tsx',
  ];
  for (const file of files) {
    const result = compile(file, true);
    const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${file} has transpile errors`);
    assert.match(result.outputText, /exports\.default/);
  }
});

test('all group routes are registered inside the completed-profile protected stack', () => {
  const layout = source('src/app/_layout.tsx');
  const start = layout.indexOf('<Stack.Protected');
  const end = layout.indexOf('</Stack.Protected>', start);
  assert.ok(start >= 0 && end > start);
  const protectedBlock = layout.slice(start, end);
  assert.match(protectedBlock, /Boolean\(session\)/);
  assert.match(protectedBlock, /!isPasswordRecovery/);
  assert.match(protectedBlock, /isProfileComplete/);
  for (const route of [
    'messages/groups/create',
    'messages/groups/invitations',
    'messages/groups/history',
    'messages/groups/[id]',
    'messages/groups/invite/[id]',
  ]) assert.ok(protectedBlock.includes(`name="${route}"`), `Missing protected route ${route}`);
});

test('invitation and former-history routes use bounded cursor pagination and authorized thread links', () => {
  const invitations = source('src/app/messages/groups/invitations.tsx');
  assert.match(invitations, /loadGroupInvitationPage\(userId, \{ limit: 20, before: append \? cursorRef\.current : null \}\)/);
  assert.match(invitations, /cursorRef\.current = page\.nextCursor/);
  assert.match(invitations, /setHasMore\(page\.hasMore\)/);
  assert.match(invitations, /load\(true\)/);
  assert.match(invitations, /respondToGroupInvitation\(userId, item\.id, response\)/);

  const history = source('src/app/messages/groups/history.tsx');
  assert.match(history, /loadFormerGroupPage\(userId, \{ limit: 20, before: append \? cursorRef\.current : null \}\)/);
  assert.match(history, /item\.my_membership_status !== 'active'/);
  assert.match(history, /pathname: '\/messages\/\[id\]'/);
  assert.match(history, /only your permitted history/i);
  assert.match(history, /load\(true\)/);
});

test('group management uses one snapshot revision and exact membership-period tokens', () => {
  const details = source('src/app/messages/groups/[id].tsx');
  assert.match(details, /loadGroupManagementSnapshot\(userId, conversationId\)/);
  assert.match(details, /const managerRevision = snapshot\?\.management_revision/);
  assert.match(details, /renameGroupConversation\(userId, conversationId, renameTitle, managerRevision\)/);
  assert.match(details, /revokeGroupInvitation\(userId, invitationId, managerRevision\)/);
  assert.match(details, /removeGroupMember\(userId, conversationId, member\.profile_id, member\.membership_period, managerRevision\)/);
  assert.match(details, /setGroupMemberRole\(userId, conversationId, member\.profile_id, member\.membership_period, action, managerRevision\)/);
  assert.match(details, /transferGroupOwnership\(userId, conversationId, member\.profile_id, member\.membership_period, managerRevision\)/);
  assert.match(details, /leaveGroupConversation\(userId, conversationId, summary\.my_membership_period\)/);
});

test('owner and ordinary-member controls mirror transfer-before-leave rules', () => {
  const details = source('src/app/messages/groups/[id].tsx');
  assert.match(details, /summary\.my_role === 'owner' \? <Text[^>]*>Transfer ownership to another active member before leaving this group\.<\/Text>/);
  assert.match(details, />Leave group<\/Text>/);
  assert.match(details, /<SmallButton label="Transfer ownership"/);
  assert.match(details, /summary\.my_membership_status !== 'active'/);
  assert.match(details, /Current membership and later activity remain private/);
});

test('creation and manager invitation routes preserve idempotent IDs and current snapshots', () => {
  const creation = source('src/app/messages/groups/create.tsx');
  assert.match(creation, /validateGroupCreation/);
  assert.match(creation, /createGroupConversation\(userId, operation\)/);
  assert.match(creation, /clientCreationId/);
  assert.match(creation, /globalThis\.crypto\.randomUUID\(\)/);

  const invite = source('src/app/messages/groups/invite/[id].tsx');
  assert.match(invite, /loadGroupManagementSnapshot\(userId, conversationId\)/);
  assert.match(invite, /getGroupInviteOptions\(classmates, snapshot\.members, snapshot\.pending_invitations, userId\)/);
  assert.match(invite, /clientInvitationId: globalThis\.crypto\.randomUUID\(\)/);
  assert.match(invite, /expectedManagementRevision: saved\.revision/);
  assert.match(invite, /existing\?\.profileId === classmate\.profileId \? existing/);
});

console.log(`Group app production integration: ${checks} checks passed.`);
