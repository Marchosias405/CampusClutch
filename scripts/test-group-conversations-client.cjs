/* global __dirname */
// Exercise the real group client with deterministic Auth/PostgREST doubles. No network or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const CHAT = '30000000-0000-4000-8000-000000000003';
const OTHER_CHAT = '30000000-0000-4000-8000-000000000004';
const COURSE = '40000000-0000-4000-8000-000000000004';
const CREATION = '50000000-0000-4000-8000-000000000005';
const INVITATION = '60000000-0000-4000-8000-000000000006';
const OTHER_INVITATION = '60000000-0000-4000-8000-000000000007';
const REVISION = '7';
const CREATED = '2026-10-09T12:00:00.000Z';
const OLDER = '2026-10-08T12:00:00.000Z';
const plain = value => JSON.parse(JSON.stringify(value));
const codeIs = code => error => error.code === code;
const invitation = (patch = {}) => ({
  id: INVITATION, conversation_id: CHAT, group_title: 'Algorithms Group', course_id: COURSE,
  course_code: 'CMPT 125', course_title: 'Introduction to Computing Science and Programming II',
  invited_by_profile_id: B, invited_by_display_name: 'Student B', active_member_count: 1,
  status: 'pending', created_at: CREATED, ...patch,
});
const member = (patch = {}) => ({
  profile_id: B, display_name: 'Student B', role: 'member',
  joined_at: CREATED, ...patch,
});
const managementMember = (patch = {}) => ({ membership_period: 1, ...member(patch) });
const pending = (patch = {}) => ({
  id: INVITATION, invitee_profile_id: C, invitee_display_name: 'Student C',
  invited_by_profile_id: A, invited_by_display_name: 'Student A',
  created_at: CREATED, ...patch,
});
const snapshot = (patch = {}) => ({
  conversation_id: CHAT, title: 'Algorithms Group', management_revision: REVISION,
  members: [managementMember({ profile_id: A, display_name: 'Student A', role: 'owner' }), managementMember()],
  pending_invitations: [pending()], ...patch,
});
const formerSummary = (patch = {}) => ({
  id: CHAT, type: 'group', status: 'active', other_profile_id: null, other_display_name: null,
  group_title: 'Algorithms Group', group_course_id: COURSE, group_course_code: 'CMPT 125',
  active_member_count: 0, my_role: 'member', my_membership_status: 'removed',
  my_membership_period: 1, management_revision: '0', can_send: false,
  last_message_body: 'Visible before removal', last_message_at: CREATED,
  last_activity_at: CREATED, last_message_sequence: '3', last_read_sequence: '3',
  unread_count: 0, created_at: OLDER, ...patch,
});

const messagesCode = compile('src/lib/messages.ts');
const groupsCode = compile('src/lib/groupConversations.ts');
let checks = 0;
async function test(name, run) { await run(); checks += 1; console.log('PASS ' + name); }

function client(initialResponse = null) {
  const state = {
    session: { user: { id: A }, access_token: 'original-token' }, authCalls: 0,
    response: initialResponse, authError: null, rpcError: null, calls: [],
    onSession: null, onRpc: null, onExecute: null,
  };
  const supabase = {
    auth: { getSession: async () => {
      state.authCalls += 1;
      if (state.onSession) await state.onSession(state);
      return { data: { session: state.session }, error: state.authError };
    } },
    rpc: (name, args) => {
      if (state.onRpc) state.onRpc(state);
      return { setHeader: async (header, value) => {
        const call = { name, args: plain(args), header, value };
        state.calls.push(call);
        if (state.onExecute) return state.onExecute(call, state);
        return { data: state.response, error: state.rpcError };
      } };
    },
  };
  const messages = {}, groups = {};
  vm.runInNewContext(messagesCode, { exports: messages, Error, require: name => {
    assert.equal(name, './supabase'); return { supabase };
  } }, { filename: 'messages.ts' });
  vm.runInNewContext(groupsCode, { exports: groups, Error, require: name => {
    if (name === './supabase') return { supabase };
    assert.equal(name, './messages'); return messages;
  } }, { filename: 'groupConversations.ts' });
  return { api: groups, state };
}

(async () => {
  await test('all group RPC names, arguments, outputs and pinned bearer headers match the contract', async () => {
    const { api, state } = client(CHAT);
    assert.equal(await api.createGroupConversation(A.toUpperCase(), {
      clientCreationId: CREATION.toUpperCase(), courseId: COURSE.toUpperCase(),
      title: '  Algorithms Group  ', inviteeIds: [B.toUpperCase(), C],
    }), CHAT);
    state.response = [invitation({ internal_private_value: 'hidden' })];
    assert.deepEqual(plain(await api.loadMyGroupInvitations(A, 10)), [invitation()]);
    state.response = CHAT;
    assert.equal(await api.respondToGroupInvitation(A, INVITATION, 'accepted'), CHAT);
    state.response = OTHER_INVITATION;
    assert.equal(await api.inviteGroupMember(A, {
      conversationId: CHAT, clientInvitationId: OTHER_INVITATION, inviteeId: B,
      expectedManagementRevision: REVISION,
    }), OTHER_INVITATION);
    state.response = 'revoked'; assert.equal(await api.revokeGroupInvitation(A, INVITATION, REVISION), 'revoked');
    state.response = [member({ membership_period: 9, internal_read_cursor: '99' })];
    assert.deepEqual(plain(await api.loadGroupMembers(A, CHAT)), [member()]);
    state.response = [pending({ internal_email: 'hidden@example.com' })];
    assert.deepEqual(plain(await api.loadGroupPendingInvitations(A, CHAT)), [pending()]);
    state.response = snapshot({ internal_private_value: 'hidden' });
    assert.deepEqual(plain(await api.loadGroupManagementSnapshot(A, CHAT)), snapshot());
    state.response = 'left'; assert.equal(await api.leaveGroupConversation(A, CHAT, 1), 'left');
    state.response = 'removed'; assert.equal(await api.removeGroupMember(A, CHAT, B, 1, REVISION), 'removed');
    state.response = 'administrator'; assert.equal(await api.setGroupMemberRole(A, CHAT, B, 1, 'administrator', REVISION), 'administrator');
    state.response = 'transferred'; assert.equal(await api.transferGroupOwnership(A, CHAT, B, 1, REVISION), 'transferred');
    state.response = 'New Group'; assert.equal(await api.renameGroupConversation(A, CHAT, '  New Group ', REVISION), 'New Group');
    assert.deepEqual(state.calls.map(({ name, args }) => ({ name, args })), [
      { name: 'create_group_conversation', args: { p_client_creation_id: CREATION, p_course_id: COURSE, p_title: 'Algorithms Group', p_invitee_ids: [B, C] } },
      { name: 'get_my_group_invitations', args: { p_limit: 10 } },
      { name: 'respond_to_group_invitation', args: { p_invitation_id: INVITATION, p_response: 'accepted' } },
      { name: 'invite_group_member', args: { p_conversation_id: CHAT, p_client_invitation_id: OTHER_INVITATION, p_invitee_id: B, p_expected_management_revision: REVISION } },
      { name: 'revoke_group_invitation', args: { p_invitation_id: INVITATION, p_expected_management_revision: REVISION } },
      { name: 'get_group_members', args: { p_conversation_id: CHAT } },
      { name: 'get_group_pending_invitations', args: { p_conversation_id: CHAT } },
      { name: 'get_group_management_snapshot', args: { p_conversation_id: CHAT } },
      { name: 'leave_group_conversation', args: { p_conversation_id: CHAT, p_expected_membership_period: 1 } },
      { name: 'remove_group_member', args: { p_conversation_id: CHAT, p_profile_id: B, p_expected_membership_period: 1, p_expected_management_revision: REVISION } },
      { name: 'set_group_member_role', args: { p_conversation_id: CHAT, p_profile_id: B, p_expected_membership_period: 1, p_role: 'administrator', p_expected_management_revision: REVISION } },
      { name: 'transfer_group_ownership', args: { p_conversation_id: CHAT, p_new_owner_id: B, p_expected_membership_period: 1, p_expected_management_revision: REVISION } },
      { name: 'rename_group_conversation', args: { p_conversation_id: CHAT, p_title: 'New Group', p_expected_management_revision: REVISION } },
    ]);
    assert.ok(state.calls.every(call => call.header === 'Authorization' && call.value === 'Bearer original-token'));
    assert.equal(state.authCalls, state.calls.length * 2);
  });

  await test('paged invitation and former-group discovery use exact keyset cursors and pinned sessions', async () => {
    const invitationBefore = { createdAt: '2026-10-10T12:00:00.000Z', id: CREATION };
    const olderInvitation = invitation({ id: OTHER_INVITATION, conversation_id: COURSE, created_at: OLDER });
    const { api, state } = client([invitation(), olderInvitation]);
    const invitationPage = await api.loadGroupInvitationPage(A, { limit: 2, before: invitationBefore });
    assert.deepEqual(plain(invitationPage), {
      items: [invitation(), olderInvitation],
      hasMore: true,
      nextCursor: { createdAt: OLDER, id: OTHER_INVITATION },
    });
    state.response = [formerSummary()];
    const formerBefore = { activityAt: '2026-10-10T12:00:00.000Z', id: CREATION };
    const formerPage = await api.loadFormerGroupPage(A, { limit: 1, before: formerBefore });
    assert.deepEqual(plain(formerPage), {
      items: [formerSummary()],
      hasMore: true,
      nextCursor: { activityAt: CREATED, id: CHAT },
    });
    assert.deepEqual(state.calls.map(({ name, args }) => ({ name, args })), [
      { name: 'get_my_group_invitations_page', args: {
        p_limit: 2, p_before_created_at: invitationBefore.createdAt, p_before_id: CREATION,
      } },
      { name: 'get_my_former_group_conversations', args: {
        p_limit: 1, p_before_activity_at: formerBefore.activityAt, p_before_id: CREATION,
      } },
    ]);
    assert.ok(state.calls.every(call => call.value === 'Bearer original-token'));
    assert.equal(state.authCalls, 4);
  });

  await test('paged discovery rejects malformed cursors, order violations and active or unmasked former rows', async () => {
    const { api, state } = client([]);
    for (const before of [
      { createdAt: 'invalid', id: INVITATION },
      { createdAt: CREATED, id: 'invalid' },
      { createdAt: CREATED },
    ]) {
      await assert.rejects(
        () => api.loadGroupInvitationPage(A, { before }),
        codeIs('INVALID_INPUT'),
      );
    }
    assert.equal(state.calls.length, 0);

    state.response = [
      invitation({ created_at: '2026-10-09T12:00:00.000900Z' }),
      invitation({ id: OTHER_INVITATION, created_at: '2026-10-09T12:00:00.000100Z' }),
    ];
    assert.equal((await api.loadGroupInvitationPage(A, { limit: 2 })).items.length, 2);
    state.response = [
      invitation({ created_at: '2026-10-09T12:00:00.000100Z' }),
      invitation({ id: OTHER_INVITATION, created_at: '2026-10-09T12:00:00.000900Z' }),
    ];
    await assert.rejects(
      () => api.loadGroupInvitationPage(A, { limit: 2 }),
      codeIs('INVALID_RESPONSE'),
    );
    state.response = [
      invitation({ id: OTHER_INVITATION }),
      invitation(),
    ];
    assert.equal((await api.loadGroupInvitationPage(A, { limit: 2 })).items.length, 2);
    state.response.reverse();
    await assert.rejects(
      () => api.loadGroupInvitationPage(A, { limit: 2 }),
      codeIs('INVALID_RESPONSE'),
    );
    state.response = [
      invitation({ id: OTHER_INVITATION, created_at: OLDER }),
      invitation({ created_at: CREATED }),
    ];
    await assert.rejects(
      () => api.loadGroupInvitationPage(A, { limit: 2 }),
      codeIs('INVALID_RESPONSE'),
    );
    state.response = [formerSummary({ my_membership_status: 'active', active_member_count: 2, management_revision: '4', can_send: true })];
    await assert.rejects(
      () => api.loadFormerGroupPage(A),
      codeIs('INVALID_RESPONSE'),
    );
    state.response = [formerSummary({ active_member_count: 1 })];
    await assert.rejects(
      () => api.loadFormerGroupPage(A),
      codeIs('INVALID_RESPONSE'),
    );
    const formerBefore = { activityAt: CREATED, id: CHAT };
    state.response = [formerSummary()];
    await assert.rejects(
      () => api.loadFormerGroupPage(A, { limit: 1, before: formerBefore }),
      codeIs('INVALID_RESPONSE'),
    );
    state.response = [
      formerSummary({ last_activity_at: '2026-10-09T12:00:00.000900Z' }),
      formerSummary({ id: OTHER_CHAT, last_activity_at: '2026-10-09T12:00:00.000100Z' }),
    ];
    assert.equal((await api.loadFormerGroupPage(A, { limit: 2 })).items.length, 2);
    state.response.reverse();
    await assert.rejects(
      () => api.loadFormerGroupPage(A, { limit: 2 }),
      codeIs('INVALID_RESPONSE'),
    );
  });

  await test('creation validates and normalizes title, idempotency identity and unique invitees before dispatch', async () => {
    const { api, state } = client(CHAT);
    const input = Object.freeze({ clientCreationId: CREATION, courseId: COURSE, title: '😀'.repeat(80), inviteeIds: Object.freeze([B, C]) });
    assert.equal(await api.createGroupConversation(A, input), CHAT);
    assert.equal(state.calls[0].args.p_title, '😀'.repeat(80));
    assert.deepEqual(input.inviteeIds, [B, C]);
    const invalid = [
      { ...input, clientCreationId: 'invalid' }, { ...input, courseId: 'invalid' },
      { ...input, title: ' ' }, { ...input, title: '😀'.repeat(81) },
      { ...input, inviteeIds: [] }, { ...input, inviteeIds: Array.from({ length: 20 }, (_, index) => `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`) },
      { ...input, inviteeIds: [B, B.toUpperCase()] }, { ...input, inviteeIds: [A] },
      { ...input, inviteeIds: ['invalid'] }, { ...input, inviteeIds: null }, null,
    ];
    for (const value of invalid) await assert.rejects(() => api.createGroupConversation(A, value), codeIs('INVALID_INPUT'));
    assert.equal(state.calls.length, 1);
  });

  await test('invitation inbox is bounded, pending-only, deduplicated and projects approved fields', async () => {
    const { api, state } = client([invitation(), invitation({ id: OTHER_INVITATION, conversation_id: COURSE })]);
    assert.equal((await api.loadMyGroupInvitations(A, 2)).length, 2);
    for (const value of [null, {}, [invitation(), invitation()],
      [invitation({ status: 'accepted' })], [invitation({ active_member_count: 0 })],
      [invitation({ created_at: 'invalid' })], [invitation({ invited_by_display_name: '' })],
      [invitation(), invitation({ id: OTHER_INVITATION }), invitation({ id: CREATION })]]) {
      state.response = value;
      await assert.rejects(() => api.loadMyGroupInvitations(A, 2), codeIs('INVALID_RESPONSE'));
    }
  });

  await test('member and pending-invitation lists reject malformed, excessive and duplicate projections', async () => {
    const { api, state } = client();
    for (const value of [null, [member(), member()], [member({ role: 'moderator' })],
      [member({ display_name: '' })], [member({ joined_at: 'invalid' })],
      Array.from({ length: 21 }, (_, index) => member({ profile_id: `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }))]) {
      state.response = value;
      await assert.rejects(() => api.loadGroupMembers(A, CHAT), codeIs('INVALID_RESPONSE'));
    }
    for (const value of [null, [pending(), pending()],
      [pending(), pending({ id: OTHER_INVITATION })], [pending({ created_at: 'invalid' })],
      [pending({ invitee_display_name: null })], Array.from({ length: 20 }, (_, index) => pending({ id: `60000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`, invitee_profile_id: `c0000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}` }))]) {
      state.response = value;
      await assert.rejects(() => api.loadGroupPendingInvitations(A, CHAT), codeIs('INVALID_RESPONSE'));
    }
  });

  await test('manager snapshot is atomic, exact-revisioned and rejects mixed or malformed management state', async () => {
    const { api, state } = client(snapshot());
    assert.deepEqual(plain(await api.loadGroupManagementSnapshot(A, CHAT)), snapshot());
    for (const value of [null, snapshot({ conversation_id: COURSE }), snapshot({ title: ' Group ' }),
      snapshot({ management_revision: 7 }), snapshot({ management_revision: '-1' }),
      snapshot({ members: [managementMember()] }),
      snapshot({ members: [managementMember({ profile_id: A, role: 'owner' }), managementMember({ profile_id: C, role: 'owner' })] }),
      snapshot({ members: [managementMember({ profile_id: A, role: 'owner' }), managementMember(), managementMember()] }),
      snapshot({ members: [managementMember({ profile_id: A, role: 'owner' }), managementMember({ membership_period: 0 })] }),
      snapshot({ pending_invitations: [pending(), pending()] }),
      snapshot({ pending_invitations: [pending({ invitee_profile_id: B })] })]) {
      state.response = value;
      await assert.rejects(() => api.loadGroupManagementSnapshot(A, CHAT), codeIs('INVALID_RESPONSE'));
    }
  });

  await test('invalid IDs, decisions, page sizes, self-management and owner role never reach an RPC', async () => {
    const { api, state } = client();
    const calls = [
      () => api.loadMyGroupInvitations(A, 0), () => api.loadMyGroupInvitations(A, 51),
      () => api.respondToGroupInvitation(A, 'invalid', 'accepted'),
      () => api.respondToGroupInvitation(A, INVITATION, 'maybe'),
      () => api.inviteGroupMember(A, null),
      () => api.inviteGroupMember(A, { conversationId: CHAT, clientInvitationId: INVITATION, inviteeId: A, expectedManagementRevision: REVISION }),
      () => api.inviteGroupMember(A, { conversationId: CHAT, clientInvitationId: INVITATION, inviteeId: B, expectedManagementRevision: '-1' }),
      () => api.revokeGroupInvitation(A, 'invalid', REVISION),
      () => api.revokeGroupInvitation(A, INVITATION, '9223372036854775807'),
      () => api.loadGroupMembers(A, 'invalid'),
      () => api.loadGroupPendingInvitations(A, 'invalid'), () => api.leaveGroupConversation(A, 'invalid', 1),
      () => api.loadGroupManagementSnapshot(A, 'invalid'),
      () => api.leaveGroupConversation(A, CHAT, 0),
      () => api.removeGroupMember(A, CHAT, A, 1, REVISION), () => api.removeGroupMember(A, CHAT, B, 0, REVISION),
      () => api.removeGroupMember(A, CHAT, B, 1, 7),
      () => api.setGroupMemberRole(A, CHAT, A, 1, 'member', REVISION),
      () => api.setGroupMemberRole(A, CHAT, B, 0, 'member', REVISION),
      () => api.setGroupMemberRole(A, CHAT, B, 1, 'owner', REVISION),
      () => api.transferGroupOwnership(A, CHAT, A, 1, REVISION),
      () => api.transferGroupOwnership(A, CHAT, B, 0, REVISION),
      () => api.renameGroupConversation(A, CHAT, '', REVISION), () => api.renameGroupConversation(A, CHAT, 'x'.repeat(81), REVISION),
    ];
    for (const run of calls) await assert.rejects(run, codeIs('INVALID_INPUT'));
    assert.equal(state.calls.length, 0); assert.equal(state.authCalls, 0);
  });

  await test('mutation responses fail closed when UUIDs, exact result values or normalized titles do not match', async () => {
    const { api } = client('invalid');
    await assert.rejects(() => api.createGroupConversation(A, { clientCreationId: CREATION, courseId: COURSE, title: 'Group', inviteeIds: [B] }), codeIs('INVALID_RESPONSE'));
    await assert.rejects(() => api.respondToGroupInvitation(A, INVITATION, 'declined'), codeIs('INVALID_RESPONSE'));
    await assert.rejects(() => api.inviteGroupMember(A, { conversationId: CHAT, clientInvitationId: INVITATION, inviteeId: B, expectedManagementRevision: REVISION }), codeIs('INVALID_RESPONSE'));
    for (const [method, args] of [
      ['revokeGroupInvitation', [A, INVITATION, REVISION]], ['leaveGroupConversation', [A, CHAT, 1]],
      ['removeGroupMember', [A, CHAT, B, 1, REVISION]], ['setGroupMemberRole', [A, CHAT, B, 1, 'member', REVISION]],
      ['transferGroupOwnership', [A, CHAT, B, 1, REVISION]], ['renameGroupConversation', [A, CHAT, 'Group', REVISION]],
    ]) await assert.rejects(() => api[method](...args), codeIs('INVALID_RESPONSE'));
  });

  await test('signed-out and wrong-account sessions reject before dispatch', async () => {
    for (const session of [null, { user: { id: B }, access_token: 'other-token' }]) {
      const { api, state } = client(); state.session = session;
      await assert.rejects(() => api.loadMyGroupInvitations(A), codeIs('ACCOUNT_CHANGED'));
      await assert.rejects(() => api.loadGroupMembers(A, CHAT), codeIs('ACCOUNT_CHANGED'));
      assert.equal(state.calls.length, 0);
    }
  });

  await test('in-flight account changes suppress successful, returned-error and thrown-error results', async () => {
    for (const outcome of ['success', 'returned-error', 'thrown-error']) {
      const { api, state } = client([invitation()]);
      state.onExecute = () => {
        state.session = { user: { id: B }, access_token: 'other-token' };
        if (outcome === 'thrown-error') throw new Error('private-old-account-details');
        return { data: state.response, error: outcome === 'returned-error' ? { code: '42501', message: 'private-old-account-details' } : null };
      };
      await assert.rejects(() => api.loadMyGroupInvitations(A), codeIs('ACCOUNT_CHANGED'));
      assert.equal(state.calls[0].value, 'Bearer original-token');
    }
  });

  await test('same-account token refresh preserves results while the outgoing credential remains pinned', async () => {
    const { api, state } = client([invitation()]);
    state.onExecute = () => {
      state.session = { user: { id: A }, access_token: 'refreshed-token' };
      return { data: state.response, error: null };
    };
    assert.equal((await api.loadMyGroupInvitations(A))[0].id, INVITATION);
    assert.equal(state.calls[0].value, 'Bearer original-token');
  });

  await test('backend and transport failures expose stable safe errors without private diagnostics', async () => {
    for (const code of ['42501', '22023', '23505', '55000', 'XX000']) {
      const { api, state } = client(); state.rpcError = { code, message: 'private SQL', details: 'private details' };
      await assert.rejects(() => api.loadGroupMembers(A, CHAT), error => {
        assert.equal(error.code, code === 'XX000' ? 'GROUP_UNCONFIRMED' : code);
        assert.doesNotMatch(error.message, /private/); assert.equal(error.details, undefined);
        return true;
      });
    }
    const { api, state } = client(); state.onExecute = () => { throw new Error('private network'); };
    await assert.rejects(() => api.loadGroupMembers(A, CHAT), error => error.code === 'GROUP_UNCONFIRMED' && !error.message.includes('private'));
  });

  console.log(`Group conversation client: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
