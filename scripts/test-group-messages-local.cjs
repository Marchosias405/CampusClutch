/* global __dirname */
// Exercise the real group-conversation clients against local Auth/PostgREST.
// Creates isolated accounts/course data and removes only those fixtures.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'));
const ts = require(path.join(root, 'node_modules/typescript'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(line => line.includes('=') && !line.startsWith('#'))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (env.EXPO_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') {
  throw Error('Local API required; hosted projects are never used by this test.');
}
const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!key) throw Error('A local publishable/anon key is required.');

function compile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}
const compiledMessages = compile('src/lib/messages.ts');
const compiledGroups = compile('src/lib/groupConversations.ts');
const users = [];
let courseId = null;
let checks = 0;
const pass = label => { checks += 1; console.log('PASS ' + label); };

function sql(query) {
  const out = cp.spawnSync('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', '54322',
    '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    env: { ...process.env, PGPASSWORD: 'postgres', PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'group-messages-api' },
    encoding: 'utf8', timeout: 30000,
  });
  if (out.error) throw out.error;
  if (out.status !== 0) throw Error(out.stderr);
  return out.stdout.trim();
}

function service(client) {
  const messages = {};
  vm.runInNewContext(compiledMessages, { exports: messages, Error, require: name => {
    if (name === './supabase') return { supabase: client };
    throw Error('Unexpected messages import: ' + name);
  } });
  const groups = {};
  vm.runInNewContext(compiledGroups, { exports: groups, Error, require: name => {
    if (name === './supabase') return { supabase: client };
    if (name === './messages') return messages;
    throw Error('Unexpected groups import: ' + name);
  } });
  return { ...messages, ...groups };
}

function dataFingerprint() {
  const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename")
    .split(/\r?\n/).filter(Boolean);
  assert.ok(tables.every(table => /^[a-z_]+$/.test(table)));
  return tables.map(table => table + ':' + sql(`select count(*)::text || ':' || md5(coalesce(string_agg(row_to_json(t)::text, chr(10) order by row_to_json(t)::text), '')) from public.${table} t`)).join('\n');
}

async function account(label, enrolled = true) {
  const client = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = 'group-api-' + crypto.randomUUID() + '@test.local';
  const password = crypto.randomBytes(24).toString('hex');
  const signup = await client.auth.signUp({ email, password });
  if (signup.error) throw signup.error;
  const id = signup.data.user.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const user = { id, label, client, api: service(client) };
  users.push(user);
  sql(`update auth.users set email_confirmed_at=now() where id='${id}';
    update public.profiles set display_name='${label}', major='Testing', year_of_study=2,
      is_discoverable=true, onboarding_completed_at=now(),
      campus_id=(select id from public.campuses where slug='burnaby') where id='${id}';
    ${enrolled ? `insert into public.course_memberships(course_id,profile_id,status) values('${courseId}','${id}','enrolled');` : ''}`);
  const signin = await client.auth.signInWithPassword({ email, password });
  if (signin.error) throw signin.error;
  return user;
}

async function denied(user, name, args) {
  const { error } = await user.client.rpc(name, args);
  assert.ok(error, name + ' must reject this caller');
  return error;
}

async function assertRowsHidden(user, table, conversationId) {
  const result = await user.client.from(table).select('*').eq('conversation_id', conversationId);
  if (!result.error) assert.deepEqual(result.data, []);
}

(async () => {
  const before = dataFingerprint();
  try {
    const termId = sql("select id from public.academic_terms where status='current' order by id limit 1");
    if (!termId) throw Error('A current local academic term is required.');
    courseId = crypto.randomUUID();
    const code = 'GRP ' + crypto.randomBytes(4).toString('hex').toUpperCase();
    sql(`insert into public.courses(id,code,title,term_id,status) values('${courseId}','${code}','Group API Fixture','${termId}','active')`);

    const a = await account('Group Owner A');
    const b = await account('Group Member B');
    const c = await account('Group Member C');
    const d = await account('Group Member D');
    const outsider = await account('Group Outsider E', false);
    const creationId = crypto.randomUUID();
    const input = { clientCreationId: creationId, courseId, title: '  CMPT Test Group  ', inviteeIds: [b.id, c.id] };
    const groupId = await a.api.createGroupConversation(a.id, input);
    assert.equal(await a.api.createGroupConversation(a.id, input), groupId);
    await assert.rejects(a.api.createGroupConversation(a.id, { ...input, title: 'Changed retry' }));
    assert.equal(sql(`select count(*) from public.conversations where id='${groupId}' and type='group'`), '1');
    assert.equal(sql(`select count(*) from public.group_conversation_invitations where conversation_id='${groupId}' and status='pending'`), '2');
    pass('group creation is atomic and an unchanged client creation ID is idempotent');

    let summary = await a.api.loadConversationSummary(a.id, groupId);
    assert.equal(summary.type, 'group');
    assert.equal(summary.group_title, 'CMPT Test Group');
    assert.equal(summary.group_course_id, courseId);
    assert.equal(summary.my_role, 'owner');
    assert.equal(summary.active_member_count, 1);
    assert.equal(summary.management_revision, '0');
    assert.equal(summary.can_send, true);
    pass('owner receives a course-linked group summary with no fabricated counterpart');

    const bInvites = await b.api.loadMyGroupInvitations(b.id);
    const cInvites = await c.api.loadMyGroupInvitations(c.id);
    assert.equal(bInvites.length, 1);
    assert.equal(cInvites.length, 1);
    assert.equal(bInvites[0].conversation_id, groupId);
    assert.equal(bInvites[0].invited_by_display_name, a.label);
    assert.equal((await outsider.api.loadMyGroupInvitations(outsider.id)).length, 0);
    const firstBInvitationPage = await b.api.loadGroupInvitationPage(b.id, { limit: 1 });
    assert.equal(firstBInvitationPage.items[0].id, bInvites[0].id);
    assert.equal(firstBInvitationPage.hasMore, true);
    assert.deepEqual((await b.api.loadGroupInvitationPage(b.id, {
      limit: 1, before: firstBInvitationPage.nextCursor,
    })).items, []);
    pass('pending invitation previews support bounded keyset paging without exposing another account');
    pass('only each invitee receives the limited pending invitation preview');

    const beforeJoin = await a.api.sendMessage(a.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Before B accepted',
    });
    assert.equal(beforeJoin.sequence, '1');
    await assert.rejects(b.api.loadConversationSummary(b.id, groupId));
    await assert.rejects(b.api.loadMessagePage(b.id, groupId));
    await assert.rejects(b.api.sendMessage(b.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Pending user',
    }));
    await assertRowsHidden(b, 'messages', groupId);
    await assertRowsHidden(outsider, 'group_conversations', groupId);
    pass('pending invitees and outsiders cannot discover or use group conversation data');

    assert.equal(await b.api.respondToGroupInvitation(b.id, bInvites[0].id, 'accepted'), groupId);
    assert.equal(await b.api.respondToGroupInvitation(b.id, bInvites[0].id, 'accepted'), groupId);
    assert.equal(await c.api.respondToGroupInvitation(c.id, cInvites[0].id, 'declined'), groupId);
    assert.equal(await c.api.respondToGroupInvitation(c.id, cInvites[0].id, 'declined'), groupId);
    assert.equal((await b.api.loadMyGroupInvitations(b.id)).length, 0);
    assert.equal((await c.api.loadMyGroupInvitations(c.id)).length, 0);
    assert.equal((await b.api.loadMessagePage(b.id, groupId)).items.length, 0);
    await assert.rejects(c.api.loadConversationSummary(c.id, groupId));
    pass('acceptance is idempotent, decline grants nothing, and prejoin history remains hidden');

    const visibleA = await a.api.sendMessage(a.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Visible after B joined',
    });
    assert.equal(visibleA.sequence, '2');
    summary = await b.api.loadConversationSummary(b.id, groupId);
    assert.equal(summary.unread_count, 1);
    assert.equal(summary.last_message_body, visibleA.body);
    assert.equal(await b.api.loadUnreadMessageCount(b.id), 1);
    const visibleB = await b.api.sendMessage(b.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Reply from B',
    });
    const bHistory = await b.api.loadMessagePage(b.id, groupId);
    assert.deepEqual(bHistory.items.map(item => item.sequence), ['3', '2']);
    assert.deepEqual(bHistory.items.map(item => item.sender_display_name), [b.label, a.label]);
    assert.equal(await b.api.markConversationRead(b.id, groupId, visibleB.sequence), '3');
    assert.equal((await b.api.loadConversationSummary(b.id, groupId)).unread_count, 0);
    pass('visible group history includes sender names and exact visible unread state');

    let members = await a.api.loadGroupMembers(a.id, groupId);
    assert.deepEqual(members.map(item => item.profile_id).sort(), [a.id, b.id].sort());
    let management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    assert.deepEqual(management.members.map(item => item.profile_id).sort(), [a.id, b.id].sort());
    assert.equal(await a.api.setGroupMemberRole(a.id, groupId, b.id,
      management.members.find(item => item.profile_id === b.id).membership_period,
      'administrator', management.management_revision), 'administrator');
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    await assert.rejects(b.api.setGroupMemberRole(b.id, groupId, a.id,
      management.members.find(item => item.profile_id === a.id).membership_period,
      'member', management.management_revision));
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    assert.equal(await b.api.renameGroupConversation(b.id, groupId, 'Admin-managed Course Group',
      management.management_revision),
      'Admin-managed Course Group');
    assert.equal((await a.api.loadConversationSummary(a.id, groupId)).group_title, 'Admin-managed Course Group');
    pass('owner role management protects the owner while administrators can manage the group title');

    const dInvitationId = crypto.randomUUID();
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    assert.equal(await b.api.inviteGroupMember(b.id, {
      conversationId: groupId, clientInvitationId: dInvitationId, inviteeId: d.id,
      expectedManagementRevision: management.management_revision,
    }), dInvitationId);
    assert.equal(await b.api.inviteGroupMember(b.id, {
      conversationId: groupId, clientInvitationId: dInvitationId, inviteeId: d.id,
      expectedManagementRevision: management.management_revision,
    }), dInvitationId);
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    await assert.rejects(b.api.inviteGroupMember(b.id, {
      conversationId: groupId, clientInvitationId: crypto.randomUUID(), inviteeId: outsider.id,
      expectedManagementRevision: management.management_revision,
    }));
    assert.equal((await a.api.loadGroupPendingInvitations(a.id, groupId)).length, 1);
    assert.equal((await d.api.loadMyGroupInvitations(d.id)).length, 1);
    await d.api.respondToGroupInvitation(d.id, dInvitationId, 'accepted');
    assert.equal((await d.api.loadMessagePage(d.id, groupId)).items.length, 0);
    pass('administrator invitations are retry-safe and require an eligible consenting classmate');

    const visibleD = await a.api.sendMessage(a.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Visible during D membership',
    });
    assert.equal((await d.api.loadMessagePage(d.id, groupId)).items[0].id, visibleD.id);
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    const dFirstPeriod = management.members.find(item => item.profile_id === d.id).membership_period;
    const beforeDRemovalRevision = management.management_revision;
    assert.equal(await b.api.removeGroupMember(b.id, groupId, d.id,
      dFirstPeriod, beforeDRemovalRevision), 'removed');
    assert.equal(await b.api.removeGroupMember(b.id, groupId, d.id,
      dFirstPeriod, beforeDRemovalRevision), 'removed');
    await assert.rejects(d.api.sendMessage(d.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Removed send',
    }));
    const hiddenFromD = await a.api.sendMessage(a.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Hidden after D removal',
    });
    management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    const beforeFormerPrivacyRename = management.management_revision;
    assert.equal(await a.api.renameGroupConversation(a.id, groupId, 'Active Members Only',
      beforeFormerPrivacyRename), 'Active Members Only');
    const activeAfterPrivacyRename = await a.api.loadConversationSummary(a.id, groupId);
    assert.equal(activeAfterPrivacyRename.group_title, 'Active Members Only');
    assert.equal(activeAfterPrivacyRename.management_revision,
      (BigInt(beforeFormerPrivacyRename) + 1n).toString());
    assert.deepEqual((await d.api.loadMessagePage(d.id, groupId)).items.map(item => item.sequence), [visibleD.sequence]);
    const formerDSummary = await d.api.loadConversationSummary(d.id, groupId);
    assert.equal(formerDSummary.can_send, false);
    assert.equal(formerDSummary.last_message_body, visibleD.body);
    assert.equal(formerDSummary.group_title, 'Admin-managed Course Group');
    assert.equal(formerDSummary.management_revision, '0');
    assert.notEqual(hiddenFromD.id, visibleD.id);
    const firstFormerDPage = await d.api.loadFormerGroupPage(d.id, { limit: 1 });
    assert.equal(firstFormerDPage.items[0].id, groupId);
    assert.equal(firstFormerDPage.items[0].my_membership_status, 'removed');
    assert.equal(firstFormerDPage.items[0].active_member_count, 0);
    assert.equal(firstFormerDPage.items[0].can_send, false);
    assert.deepEqual((await d.api.loadFormerGroupPage(d.id, {
      limit: 1, before: firstFormerDPage.nextCursor,
    })).items, []);
    pass('former-group discovery pages expose only the caller\'s frozen read-only summary');
    pass('removed members retain bounded history without observing later title or management changes');

    const rejoinD = crypto.randomUUID();
    management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    await a.api.inviteGroupMember(a.id, {
      conversationId: groupId, clientInvitationId: rejoinD, inviteeId: d.id,
      expectedManagementRevision: management.management_revision,
    });
    await d.api.respondToGroupInvitation(d.id, rejoinD, 'accepted');
    await assert.rejects(b.api.removeGroupMember(b.id, groupId, d.id,
      dFirstPeriod, beforeDRemovalRevision));
    const rejoinedDSummary = await d.api.loadConversationSummary(d.id, groupId);
    assert.equal(rejoinedDSummary.my_membership_status, 'active');
    assert.equal(rejoinedDSummary.group_title, 'Active Members Only');
    assert.notEqual(rejoinedDSummary.management_revision, '0');
    const afterDRejoin = await a.api.sendMessage(a.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Visible after D rejoined',
    });
    assert.deepEqual((await d.api.loadMessagePage(d.id, groupId)).items.map(item => item.sequence),
      [afterDRejoin.sequence, visibleD.sequence]);
    assert.equal(sql(`select count(*) from public.group_membership_periods where conversation_id='${groupId}' and profile_id='${d.id}'`), '2');
    assert.equal((await d.api.loadFormerGroupPage(d.id)).items.some(item => item.id === groupId), false);
    pass('fresh consent reopens a new history period without revealing the absence gap');

    const cAgain = crypto.randomUUID();
    management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    await a.api.inviteGroupMember(a.id, {
      conversationId: groupId, clientInvitationId: cAgain, inviteeId: c.id,
      expectedManagementRevision: management.management_revision,
    });
    management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    const beforeCRevokeRevision = management.management_revision;
    assert.equal(await a.api.revokeGroupInvitation(a.id, cAgain, beforeCRevokeRevision), 'revoked');
    assert.equal(await a.api.revokeGroupInvitation(a.id, cAgain, beforeCRevokeRevision), 'revoked');
    await assert.rejects(c.api.respondToGroupInvitation(c.id, cAgain, 'accepted'));
    pass('manager revocation wins permanently over later invitation acceptance');

    management = await a.api.loadGroupManagementSnapshot(a.id, groupId);
    assert.equal(await a.api.transferGroupOwnership(a.id, groupId, b.id,
      management.members.find(item => item.profile_id === b.id).membership_period,
      management.management_revision), 'transferred');
    members = await b.api.loadGroupMembers(b.id, groupId);
    assert.equal(members.find(item => item.profile_id === b.id).role, 'owner');
    assert.equal(members.find(item => item.profile_id === a.id).role, 'administrator');
    const aFirstPeriod = (await a.api.loadConversationSummary(a.id, groupId)).my_membership_period;
    assert.equal(await a.api.leaveGroupConversation(a.id, groupId, aFirstPeriod), 'left');
    assert.equal(await a.api.leaveGroupConversation(a.id, groupId, aFirstPeriod), 'left');
    const gapForA = await b.api.sendMessage(b.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Hidden while A left',
    });
    assert.equal((await a.api.loadMessagePage(a.id, groupId)).items.some(item => item.id === gapForA.id), false);
    assert.equal((await a.api.loadConversationPage(a.id)).items.some(item => item.id === groupId), false);
    pass('ownership transfer permits the former owner to leave without exposing later activity');

    const rejoinA = crypto.randomUUID();
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    await b.api.inviteGroupMember(b.id, {
      conversationId: groupId, clientInvitationId: rejoinA, inviteeId: a.id,
      expectedManagementRevision: management.management_revision,
    });
    await a.api.respondToGroupInvitation(a.id, rejoinA, 'accepted');
    assert.equal(await a.api.leaveGroupConversation(a.id, groupId, aFirstPeriod), 'left');
    assert.equal((await a.api.loadConversationSummary(a.id, groupId)).my_membership_status, 'active');
    const afterARejoin = await b.api.sendMessage(b.id, {
      conversationId: groupId, clientMessageId: crypto.randomUUID(), body: 'Visible after A returned',
    });
    const aBodies = (await a.api.loadMessagePage(a.id, groupId)).items.map(item => item.body);
    assert.ok(aBodies.includes(afterARejoin.body));
    assert.ok(!aBodies.includes(gapForA.body));
    management = await b.api.loadGroupManagementSnapshot(b.id, groupId);
    assert.equal(await b.api.renameGroupConversation(b.id, groupId, 'Renamed Course Group',
      management.management_revision), 'Renamed Course Group');
    assert.equal((await a.api.loadConversationSummary(a.id, groupId)).group_title, 'Renamed Course Group');
    pass('rejoined members keep disjoint history and owner rename updates summaries');

    const anonClient = createClient(env.EXPO_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } });
    await denied({ client: anonClient }, 'get_my_group_invitations', { p_limit: 20 });
    await denied({ client: anonClient }, 'get_my_group_invitations_page', {
      p_limit: 20, p_before_created_at: null, p_before_id: null,
    });
    await denied({ client: anonClient }, 'get_my_former_group_conversations', {
      p_limit: 20, p_before_activity_at: null, p_before_id: null,
    });
    await denied({ client: anonClient }, 'create_group_conversation', {
      p_client_creation_id: crypto.randomUUID(), p_course_id: courseId,
      p_title: 'Anonymous', p_invitee_ids: [b.id],
    });
    pass('anonymous clients cannot inspect invitations or create groups');

    assert.equal(sql(`select count(*) from public.conversation_members where conversation_id='${groupId}' and membership_status='active' and role='owner'`), '1');
    assert.equal(sql(`select count(*) from public.group_membership_periods where conversation_id='${groupId}' and ends_at_sequence is null`),
      sql(`select count(*) from public.conversation_members where conversation_id='${groupId}' and membership_status='active'`));
    pass('final membership graph has exactly one owner and one open period per active member');

    console.log('Local group messaging API checks passed: ' + checks + '.');
  } finally {
    if (users.length) {
      const ids = users.map(user => `'${user.id}'`).join(',');
      const owned = `select id from public.conversations where created_by in (${ids})`;
      sql(`begin;
        delete from public.group_conversation_invitations where conversation_id in (${owned});
        delete from public.request_conversations where conversation_id in (${owned});
        delete from public.messages where conversation_id in (${owned});
        delete from public.group_membership_periods where conversation_id in (${owned});
        delete from public.direct_conversation_pairs where conversation_id in (${owned});
        delete from public.conversation_members where conversation_id in (${owned});
        delete from public.group_conversations where conversation_id in (${owned});
        delete from public.conversations where created_by in (${ids});
        delete from public.course_memberships where profile_id in (${ids});
        ${courseId ? `delete from public.courses where id='${courseId}';` : ''}
        delete from auth.users where id in (${ids});
        commit;`);
    } else if (courseId) {
      sql(`delete from public.courses where id='${courseId}'`);
    }
    assert.equal(dataFingerprint(), before, 'Existing application rows must remain unchanged after fixture cleanup');
    console.log('PASS all existing public-table data remains unchanged after exact group fixture cleanup');
  }
})().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
