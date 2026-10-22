/* global __dirname */
// Deterministic policy checks for the mixed inbox, group thread and roster screens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'src/lib/groupMessagingUi.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const production = {};
vm.runInNewContext(compiled, { exports: production }, { filename: 'groupMessagingUi.ts' });

const USER = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000002';
const ADMIN = '10000000-0000-4000-8000-000000000003';
const MEMBER = '10000000-0000-4000-8000-000000000004';
const OTHER = '10000000-0000-4000-8000-000000000005';
const CONVERSATION = '20000000-0000-4000-8000-000000000001';
const COURSE = '30000000-0000-4000-8000-000000000001';
const TIME = '2026-10-09T12:00:00Z';

function base(overrides = {}) {
  return {
    id: CONVERSATION,
    status: 'active',
    last_message_body: 'Study plan for Friday',
    last_message_at: TIME,
    last_activity_at: TIME,
    last_message_sequence: '7',
    last_read_sequence: '4',
    unread_count: 3,
    created_at: TIME,
    ...overrides,
  };
}

function direct(overrides = {}) {
  return base({
    type: 'direct',
    other_profile_id: OTHER,
    other_display_name: 'Taylor Student',
    ...overrides,
  });
}

function group(overrides = {}) {
  return base({
    type: 'group',
    other_profile_id: null,
    other_display_name: null,
    group_title: 'CMPT 125 Study Crew',
    group_course_id: COURSE,
    group_course_code: 'CMPT 125',
    active_member_count: 4,
    my_role: 'member',
    my_membership_status: 'active',
    my_membership_period: 1,
    management_revision: '3',
    can_send: true,
    ...overrides,
  });
}

function message(senderId, senderName = 'Taylor Student') {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    conversation_id: CONVERSATION,
    sender_id: senderId,
    sender_display_name: senderName,
    client_message_id: '50000000-0000-4000-8000-000000000001',
    sequence: '7',
    body: 'Hello',
    created_at: TIME,
  };
}

function member(profileId, role) {
  return { profile_id: profileId, display_name: role, role, membership_period: 1, joined_at: TIME };
}

function classmate(profileId, displayName = profileId) {
  return {
    profileId,
    displayName,
    major: null,
    yearOfStudy: null,
    campusId: null,
    campusDisplayName: null,
    avatarPath: null,
    sharedInterests: [],
    sharedInterestCount: 0,
    sameCampus: false,
  };
}

let checks = 0;
function test(name, run) {
  run();
  checks += 1;
  console.log('PASS ' + name);
}

test('direct inbox presentation preserves familiar labels and searchable content', () => {
  const item = production.getConversationInboxPresentation(direct());
  assert.deepEqual(JSON.parse(JSON.stringify(item)), {
    title: 'Taylor Student',
    subtitle: 'Direct message',
    preview: 'Study plan for Friday',
    searchText: 'taylor student direct message study plan for friday',
    avatarKind: 'person',
    isReadOnly: false,
  });
  assert.equal(production.conversationMatchesSearch(direct(), ' TAYLOR '), true);
  assert.equal(production.conversationMatchesSearch(direct(), 'friday'), true);
  assert.equal(production.conversationMatchesSearch(direct(), 'chemistry'), false);
});

test('group inbox presentation includes title, course, member count and group search fields', () => {
  const item = production.getConversationInboxPresentation(group());
  assert.equal(item.title, 'CMPT 125 Study Crew');
  assert.equal(item.subtitle, 'CMPT 125 · 4 members');
  assert.equal(item.avatarKind, 'group');
  assert.equal(item.isReadOnly, false);
  assert.equal(production.conversationMatchesSearch(group(), 'study crew'), true);
  assert.equal(production.conversationMatchesSearch(group(), 'CMPT 125'), true);
  assert.equal(production.conversationMatchesSearch(group(), 'plan for friday'), true);
});

test('empty previews and singular group counts remain readable', () => {
  const item = production.getConversationInboxPresentation(group({
    active_member_count: 1,
    last_message_body: null,
  }));
  assert.equal(item.subtitle, 'CMPT 125 · 1 member');
  assert.equal(item.preview, 'No messages yet');
});

test('former-member inbox and thread presentation hides the current roster size', () => {
  const former = group({
    active_member_count: 17,
    my_membership_status: 'removed',
    can_send: false,
  });
  const inbox = production.getConversationInboxPresentation(former);
  const thread = production.getConversationThreadPresentation(former);
  assert.equal(inbox.subtitle, 'CMPT 125 · Read-only group history');
  assert.equal(inbox.subtitle.includes('17'), false);
  assert.equal(inbox.isReadOnly, true);
  assert.equal(thread.visibleMemberCount, null);
  assert.equal(thread.canOpenGroupDetails, false);
  assert.equal(thread.canCompose, false);
  assert.match(thread.readOnlyMessage, /membership period/i);
  assert.equal(thread.subtitle.includes('17'), false);
});

test('thread presentation treats group can_send as authoritative', () => {
  const active = production.getConversationThreadPresentation(group());
  assert.equal(active.canCompose, true);
  assert.equal(active.canOpenGroupDetails, true);
  assert.equal(active.visibleMemberCount, 4);
  assert.equal(active.readOnlyMessage, null);

  const blocked = production.getConversationThreadPresentation(group({ can_send: false }));
  assert.equal(blocked.isReadOnly, true);
  assert.equal(blocked.canCompose, false);
  assert.equal(blocked.canOpenGroupDetails, true);
  assert.match(blocked.subtitle, /Read-only/);
});

test('direct thread presentation remains compatible with active and closed chats', () => {
  const active = production.getConversationThreadPresentation(direct());
  assert.equal(active.title, 'Taylor Student');
  assert.equal(active.subtitle, 'Direct messages');
  assert.equal(active.canCompose, true);
  assert.equal(active.canOpenGroupDetails, false);

  const closed = production.getConversationThreadPresentation(direct({ status: 'closed' }));
  assert.equal(closed.subtitle, 'Closed conversation');
  assert.equal(closed.canCompose, false);
  assert.match(closed.readOnlyMessage, /closed/i);
});

test('message labels use You, each group sender, and the direct counterpart', () => {
  assert.equal(production.getMessageSenderLabel(message(USER), USER, group()), 'You');
  assert.equal(production.getMessageSenderLabel(message(OTHER, 'Morgan Lee'), USER, group()), 'Morgan Lee');
  assert.equal(production.getMessageSenderLabel(message(OTHER, 'Different API Name'), USER, direct()), 'Taylor Student');
  assert.equal(production.getMessageSenderLabel(message(OTHER, ''), USER, group()), 'CampusClutch member');
});

test('owner, administrator, member and former-member management permissions match the backend', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(production.getGroupManagementPermissions('owner'))), {
    canRename: true,
    canInvite: true,
    canRevokeInvitations: true,
    canChangeRoles: true,
    canTransferOwnership: true,
    canLeave: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(production.getGroupManagementPermissions('administrator'))), {
    canRename: true,
    canInvite: true,
    canRevokeInvitations: true,
    canChangeRoles: false,
    canTransferOwnership: false,
    canLeave: true,
  });
  const ordinary = production.getGroupManagementPermissions('member');
  assert.equal(ordinary.canRename, false);
  assert.equal(ordinary.canInvite, false);
  assert.equal(ordinary.canLeave, true);
  assert.deepEqual(Object.values(production.getGroupManagementPermissions('owner', false)), [false, false, false, false, false, false]);
});

test('member action policy prevents self/owner removal and limits administrators to ordinary members', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(production.getGroupMemberActions(OWNER, 'owner', member(ADMIN, 'administrator')))), {
    canRemove: true,
    canChangeRole: true,
    canTransferOwnership: true,
  });
  assert.equal(production.getGroupMemberActions(ADMIN, 'administrator', member(MEMBER, 'member')).canRemove, true);
  assert.equal(production.getGroupMemberActions(ADMIN, 'administrator', member(OWNER, 'owner')).canRemove, false);
  assert.equal(production.getGroupMemberActions(ADMIN, 'administrator', member(OTHER, 'administrator')).canRemove, false);
  assert.deepEqual(Object.values(production.getGroupMemberActions(MEMBER, 'member', member(OTHER, 'member'))), [false, false, false]);
  assert.deepEqual(Object.values(production.getGroupMemberActions(OWNER, 'owner', member(OWNER, 'owner'))), [false, false, false]);
  assert.deepEqual(Object.values(production.getGroupMemberActions(OWNER, 'owner', member(MEMBER, 'member'), false)), [false, false, false]);
});

test('invite candidates exclude self, active members, pending invitees and duplicates', () => {
  const classmates = [
    classmate(USER, 'Self'),
    classmate(OWNER, 'Owner'),
    classmate(ADMIN, 'Pending'),
    classmate(MEMBER, 'Eligible'),
    classmate(MEMBER.toUpperCase(), 'Duplicate'),
    classmate(OTHER, 'Also eligible'),
  ];
  const result = production.getGroupInviteOptions(
    classmates,
    [member(OWNER, 'owner')],
    [{ invitee_profile_id: ADMIN }],
    USER,
  );
  assert.deepEqual(result.candidates.map(item => item.displayName), ['Eligible', 'Also eligible']);
  assert.equal(result.remainingSlots, 18);
  assert.equal(result.isFull, false);
});

test('a full group exposes no invite candidates or negative capacity', () => {
  const members = Array.from({ length: 19 }, (_, index) => ({
    profile_id: `90000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  const result = production.getGroupInviteOptions(
    [classmate(OTHER)],
    members,
    [{ invitee_profile_id: ADMIN }],
    USER,
  );
  assert.equal(result.remainingSlots, 0);
  assert.equal(result.isFull, true);
  assert.equal(result.candidates.length, 0);
});

test('group creation trims valid data and accepts exactly 19 unique classmates', () => {
  const invitees = Array.from({ length: 19 }, (_, index) =>
    `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  const result = production.validateGroupCreation('  Lab partners  ', invitees, USER);
  assert.equal(result.isValid, true);
  assert.equal(result.normalizedTitle, 'Lab partners');
  assert.deepEqual(result.normalizedInviteeIds, invitees);
  assert.equal(result.titleError, null);
  assert.equal(result.inviteesError, null);
});

test('group creation reports empty and overlong titles by Unicode code points', () => {
  const empty = production.validateGroupCreation('   ', [OTHER], USER);
  assert.equal(empty.isValid, false);
  assert.equal(empty.titleError, 'Enter a group title.');
  const eighty = production.validateGroupCreation('😀'.repeat(80), [OTHER], USER);
  assert.equal(eighty.isValid, true);
  const eightyOne = production.validateGroupCreation('😀'.repeat(81), [OTHER], USER);
  assert.equal(eightyOne.isValid, false);
  assert.match(eightyOne.titleError, /1–80/);
});

test('group creation rejects no invitees, more than 19, duplicates and self-selection', () => {
  assert.equal(production.validateGroupCreation('Group', [], USER).inviteesError, 'Choose at least one classmate.');
  assert.equal(production.validateGroupCreation('Group', Array(20).fill(OTHER), USER).inviteesError, 'Choose no more than 19 classmates.');
  assert.match(production.validateGroupCreation('Group', [OTHER, OTHER.toUpperCase()], USER).inviteesError, /each classmate once/);
  assert.match(production.validateGroupCreation('Group', [USER], USER).inviteesError, /do not include yourself/);
});

console.log(`Group messaging UI policy: ${checks} checks passed.`);
