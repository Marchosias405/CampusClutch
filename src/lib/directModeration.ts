import { decisionValidation, moderationRpc } from './moderation';
import { normalizeEnforcement, readEnforcementReceipt } from './moderationEnforcement';
import type { EnforcementAttempt, EnforcementKind } from './moderationEnforcement';
import { createModerationEnforcement } from './moderationEnforcementDraft';
import { env } from './env';
import { isReportId } from './safetyReports';

export const DIRECT_TARGETS = ['student', 'request', 'course_review'] as const;
export type DirectTarget = typeof DIRECT_TARGETS[number];
export const isDirectTarget = (value: unknown): value is DirectTarget => DIRECT_TARGETS.some(item => item === value);
export const directChoices = (target: DirectTarget): EnforcementKind[] => [
  ...(target === 'request' ? ['remove_request' as const] : target === 'course_review' ? ['remove_review' as const] : []),
  'warn', 'suspend_7_days',
];
export type DirectContext = { label: string; updatedAt: string; warningCount: number; suspendedUntil: string | null; evidence: { label: string; value: string }[] };
const fields: Record<DirectTarget, [string, string][]> = {
  student: [['display_name', 'Student']],
  request: [['title', 'Request'], ['description', 'Description'], ['category', 'Type'], ['points', 'Points'], ['status', 'Status']],
  course_review: [['course_code', 'Course'], ['term_name', 'Term'], ['difficulty', 'Difficulty / 5'], ['workload', 'Workload / 5'], ['grade', 'Grade'], ['comment', 'Review'], ['tips', 'Study tips'], ['instructor', 'Instructor']],
};
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function invalid(): never { throw Object.assign(new Error('Admin action unavailable.'), { code: 'CC_MOD_RESPONSE' }); }
export async function getDirectContext(userId: string, target: DirectTarget, id: string): Promise<DirectContext> {
  if (!isDirectTarget(target) || !isReportId(id)) invalid();
  const data = await moderationRpc(userId, 'get_direct_moderation_context', { p_target_type: target, p_target_id: id });
  if (!data || typeof data !== 'object') invalid();
  const value = data as Record<string, unknown>;
  if (typeof value.label !== 'string' || !date(value.updated_at) || !Number.isSafeInteger(value.warning_count) || Number(value.warning_count) < 0
    || (value.suspended_until !== null && !date(value.suspended_until)) || !value.evidence || typeof value.evidence !== 'object' || Array.isArray(value.evidence)) invalid();
  const evidence = value.evidence as Record<string, unknown>;
  return { label: value.label, updatedAt: value.updated_at, warningCount: Number(value.warning_count), suspendedUntil: value.suspended_until,
    evidence: fields[target].flatMap(([key, label]) => typeof evidence[key] === 'string' || typeof evidence[key] === 'number'
      ? [{ label, value: String(evidence[key]) }] : []) };
}
export async function takeDirectAction(userId: string, target: DirectTarget, input: EnforcementAttempt) {
  const value = normalizeEnforcement(input);
  if (!isDirectTarget(target) || !directChoices(target).includes(value.kind) || !date(value.reviewUpdatedAt) || decisionValidation(value.reason)) invalid();
  const data = await moderationRpc(userId, 'take_direct_moderation_action', { p_target_type: target, p_target_id: value.reportId,
    p_operation_id: value.operationId, p_kind: value.kind, p_reason: value.reason, p_updated_at: value.reviewUpdatedAt });
  return readEnforcementReceipt(data, value.kind);
}
export function createDirectAction(userId: string, target: DirectTarget, id: string) {
  if (!isDirectTarget(target)) invalid();
  return createModerationEnforcement(userId, id, { namespace: `${env.supabaseUrl}/direct/${target}`,
    send: (actor, attempt) => takeDirectAction(actor, target, attempt) });
}
