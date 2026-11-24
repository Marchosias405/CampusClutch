import { decisionValidation, moderationRpc } from './moderation';
import { isReportId } from './safetyReports';

export const ENFORCEMENT_ACTIONS = ['warn', 'suspend_7_days', 'remove_review', 'remove_request'] as const;
export type EnforcementKind = typeof ENFORCEMENT_ACTIONS[number];
export const enforcementLabel = (kind: EnforcementKind) => ({ warn: 'Issue a warning', suspend_7_days: 'Suspend for 7 days', remove_review: 'Hide course review', remove_request: 'Remove request' })[kind];
export type EnforcementAttempt = {
  reportId: string; operationId: string; expectedVersion: number; kind: EnforcementKind; reason: string; reviewUpdatedAt: string | null;
};
export type EnforcementReceipt = { action_id: string; kind: EnforcementKind; automatic_suspension: boolean; suspended_until: string | null; warning_count: number };
export type EnforcementContext = {
  version: number; is_admin: boolean; can_act: boolean; warning_count: number; suspended_until: string | null;
  review_removed: boolean; review_updated_at: string | null;
  current_review: { comment: string; difficulty: number; workload: number; grade: string | null; tips: string; instructor: string } | null;
  actions: { id: string; kind: EnforcementKind; reason: string; created_at: string; automatic_suspension: boolean; suspended_until: string | null; revoked_at?: string | null }[];
};
export const isEnforcementKind = (value: unknown): value is EnforcementKind => ENFORCEMENT_ACTIONS.some(kind => kind === value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function invalid(): never { throw Object.assign(new Error('Moderation response unavailable.'), { code: 'CC_MOD_RESPONSE' }); }
export function normalizeEnforcement(value: EnforcementAttempt): EnforcementAttempt {
  if (!value || !isReportId(value.reportId) || !isReportId(value.operationId) || !count(value.expectedVersion)
    || !isEnforcementKind(value.kind) || typeof value.reason !== 'string' || decisionValidation(value.reason)
    || (value.reviewUpdatedAt !== null && !date(value.reviewUpdatedAt))
    || (value.kind === 'remove_review' && !date(value.reviewUpdatedAt))) invalid();
  return { reportId: value.reportId.toLowerCase(), operationId: value.operationId.toLowerCase(), expectedVersion: value.expectedVersion,
    kind: value.kind, reason: value.reason.trim(), reviewUpdatedAt: value.reviewUpdatedAt };
}
export async function getEnforcementContext(userId: string, reportId: string): Promise<EnforcementContext> {
  if (!isReportId(reportId)) invalid();
  const data = await moderationRpc(userId, 'get_moderation_enforcement', { p_report_id: reportId }) as EnforcementContext;
  if (!data || !count(data.version) || !count(data.warning_count) || typeof data.is_admin !== 'boolean'
    || typeof data.can_act !== 'boolean' || typeof data.review_removed !== 'boolean'
    || (data.suspended_until !== null && !date(data.suspended_until))
    || (data.review_updated_at !== null && !date(data.review_updated_at)) || !Array.isArray(data.actions)) invalid();
  const current = data.current_review;
  if (current && (typeof current.comment !== 'string' || ![1,2,3,4,5].includes(current.difficulty)
    || ![1,2,3,4,5].includes(current.workload) || typeof current.tips !== 'string' || typeof current.instructor !== 'string'
    || (current.grade !== null && typeof current.grade !== 'string'))) invalid();
  return { version: data.version, is_admin: data.is_admin, can_act: data.can_act, warning_count: data.warning_count,
    suspended_until: data.suspended_until, review_removed: data.review_removed, review_updated_at: data.review_updated_at,
    current_review: current ? { comment: current.comment, difficulty: current.difficulty, workload: current.workload,
      grade: current.grade, tips: current.tips, instructor: current.instructor } : null,
    actions: data.actions.map(item => {
      if (!item || !isReportId(item.id) || !isEnforcementKind(item.kind) || typeof item.reason !== 'string'
        || !date(item.created_at) || typeof item.automatic_suspension !== 'boolean'
        || (item.suspended_until !== null && !date(item.suspended_until)) || (item.revoked_at != null && !date(item.revoked_at))) invalid();
      return { id: item.id, kind: item.kind, reason: item.reason, created_at: item.created_at,
        automatic_suspension: item.automatic_suspension, suspended_until: item.suspended_until, revoked_at: item.revoked_at ?? null };
    }) };
}
export async function enforceReport(userId: string, input: EnforcementAttempt): Promise<EnforcementReceipt> {
  const value = normalizeEnforcement(input);
  const data = await moderationRpc(userId, 'enforce_moderation_report', { p_report_id: value.reportId,
    p_operation_id: value.operationId, p_expected_version: value.expectedVersion, p_kind: value.kind,
    p_reason: value.reason, p_review_updated_at: value.reviewUpdatedAt }) as EnforcementReceipt;
  return readEnforcementReceipt(data, value.kind);
}
export function readEnforcementReceipt(input: unknown, kind: EnforcementKind): EnforcementReceipt {
  const data = input as EnforcementReceipt;
  if (!data || !isReportId(data.action_id) || data.kind !== kind || !count(data.warning_count)
    || typeof data.automatic_suspension !== 'boolean' || (data.suspended_until !== null && !date(data.suspended_until))) invalid();
  return { action_id: data.action_id, kind: data.kind, warning_count: data.warning_count,
    automatic_suspension: data.automatic_suspension, suspended_until: data.suspended_until };
}
