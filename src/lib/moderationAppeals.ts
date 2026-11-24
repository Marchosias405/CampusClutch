import { decisionValidation, moderationRpc } from './moderation';
import { isEnforcementKind } from './moderationEnforcement';
import type { EnforcementKind } from './moderationEnforcement';
import { isReportId } from './safetyReports';

export type AppealStatus = 'pending' | 'upheld' | 'overturned';
export type AppealCursor = { created_at: string; id: string };
export type OwnAction = AppealCursor & { kind: EnforcementKind; reason: string; revoked_at: string | null; automatic_suspension: boolean;
  appeal: { id: string; explanation: string; status: AppealStatus; created_at: string; decision_reason: string | null; effect: string | null } | null };
export type AppealSummary = AppealCursor & { kind: EnforcementKind; status: AppealStatus };
export type AppealDetail = AppealSummary & { version: number; explanation: string; action_id: string; action_reason: string;
  action_created_at: string; report_id: string; original_admin: boolean; revoked_at: string | null; decision_reason: string | null; effect: string | null };
export type AppealAttempt = { targetId: string; operationId: string; kind: 'submit' | 'resolve'; reason: string;
  expectedVersion: number; outcome: 'upheld' | 'overturned' };
export const actionLabel = (kind: EnforcementKind) => ({ warn: 'Formal warning', suspend_7_days: 'Seven-day suspension', remove_review: 'Hidden course review', remove_request: 'Removed request' })[kind];
export const appealStatusLabel = (status: AppealStatus) => ({ pending: 'Awaiting review', upheld: 'Original decision upheld', overturned: 'Original decision overturned' })[status];
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const record = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const status = (v: unknown): v is AppealStatus => ['pending','upheld','overturned'].includes(String(v));
function invalid(): never { throw Object.assign(new Error('Appeal information unavailable.'), { code: 'CC_APPEAL_RESPONSE' }); }
function summary(v: any): AppealSummary {
  if (!record(v) || !isReportId(v.id) || !date(v.created_at) || !isEnforcementKind(v.kind) || !status(v.status)) invalid();
  return { id: v.id, created_at: v.created_at, kind: v.kind, status: v.status };
}
function pageArgs(cursor?: AppealCursor) {
  if (cursor && (!date(cursor.created_at) || !isReportId(cursor.id))) invalid();
  return { p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.id ?? null };
}
export async function listOwnActions(userId: string, cursor?: AppealCursor): Promise<OwnAction[]> {
  const data = await moderationRpc(userId, 'get_my_moderation_actions', pageArgs(cursor));
  if (!Array.isArray(data) || data.length > 20) invalid();
  return data.map(v => {
    if (!record(v) || !isReportId(v.id) || !date(v.created_at) || !isEnforcementKind(v.kind) || typeof v.reason !== 'string'
      || !nullableDate(v.revoked_at) || typeof v.automatic_suspension !== 'boolean') invalid();
    const a = v.appeal;
    if (a !== null && (!record(a) || !isReportId(a.id) || !status(a.status) || !date(a.created_at)
      || typeof a.explanation !== 'string' || !nullableText(a.decision_reason) || !nullableText(a.effect))) invalid();
    return { id: v.id, created_at: v.created_at, kind: v.kind, reason: v.reason, revoked_at: v.revoked_at,
      automatic_suspension: v.automatic_suspension, appeal: a ? { id: a.id, status: a.status, created_at: a.created_at,
        explanation: a.explanation, decision_reason: a.decision_reason, effect: a.effect } : null };
  });
}
export async function listAppeals(userId: string, filter: AppealStatus, cursor?: AppealCursor): Promise<AppealSummary[]> {
  if (!status(filter)) invalid();
  const data = await moderationRpc(userId, 'list_moderation_appeals', { p_status: filter, ...pageArgs(cursor) });
  if (!Array.isArray(data) || data.length > 20) invalid();
  return data.map(summary);
}
export async function getAppeal(userId: string, appealId: string): Promise<AppealDetail> {
  if (!isReportId(appealId)) invalid();
  const data = await moderationRpc(userId, 'get_moderation_appeal', { p_appeal_id: appealId });
  if (!record(data)) invalid();
  const head = summary(data);
  if (head.id !== appealId || ![0,1].includes(data.version) || typeof data.explanation !== 'string' || !isReportId(data.action_id)
    || typeof data.action_reason !== 'string' || !date(data.action_created_at) || !isReportId(data.report_id)
    || typeof data.original_admin !== 'boolean' || !nullableDate(data.revoked_at) || !nullableText(data.decision_reason) || !nullableText(data.effect)) invalid();
  return { ...head, version: data.version, explanation: data.explanation, action_id: data.action_id, action_reason: data.action_reason,
    action_created_at: data.action_created_at, report_id: data.report_id, original_admin: data.original_admin,
    revoked_at: data.revoked_at, decision_reason: data.decision_reason, effect: data.effect };
}
export function normalizeAppealAttempt(a: AppealAttempt): AppealAttempt {
  if (!a || !isReportId(a.targetId) || !isReportId(a.operationId) || !['submit','resolve'].includes(a.kind)
    || typeof a.reason !== 'string' || decisionValidation(a.reason) || ![0,1].includes(a.expectedVersion)
    || !['upheld','overturned'].includes(a.outcome)) invalid();
  return { targetId: a.targetId.toLowerCase(), operationId: a.operationId.toLowerCase(), kind: a.kind, reason: a.reason.trim(),
    expectedVersion: a.expectedVersion, outcome: a.outcome };
}
export async function sendAppealAttempt(userId: string, input: AppealAttempt): Promise<string> {
  const a = normalizeAppealAttempt(input);
  const data = await moderationRpc(userId, a.kind === 'submit' ? 'submit_moderation_appeal' : 'resolve_moderation_appeal', a.kind === 'submit'
    ? { p_action_id: a.targetId, p_operation_id: a.operationId, p_explanation: a.reason }
    : { p_appeal_id: a.targetId, p_operation_id: a.operationId, p_expected_version: a.expectedVersion, p_outcome: a.outcome, p_reason: a.reason });
  if (a.kind === 'submit') { if (!isReportId(data)) invalid(); return data; }
  if (!record(data) || !isReportId(data.id) || data.outcome !== a.outcome || typeof data.effect !== 'string') invalid();
  return data.id;
}
