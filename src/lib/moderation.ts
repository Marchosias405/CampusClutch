import { assertOfferSession } from './offers';
import { isReportId, isReportReason, isReportTargetType } from './safetyReports';
import type { ReportReason, ReportTargetType } from './safetyReports';
import { supabase } from './supabase';

export const TRIAGE_STATUSES = ['new', 'reviewing', 'escalated', 'dismissed'] as const;
export type TriageStatus = typeof TRIAGE_STATUSES[number];
export type StaffRole = 'admin' | 'moderator';
export type ReportSummary = {
  report_id: string; target_type: ReportTargetType; reason: ReportReason; created_at: string;
  triage_status: TriageStatus; triage_version: number;
};
export type ReportCursor = { created_at: string; report_id: string };
export type ReportDecision = {
  decision_id: string; from_status: TriageStatus; to_status: TriageStatus;
  version: number; note: string; created_at: string; is_mine: boolean;
};
export type ModerationReport = ReportSummary & {
  details: string; evidence: { label: string; value: string }[]; history: ReportDecision[];
};
export type DecisionAttempt = {
  reportId: string; operationId: string; expectedVersion: number; status: TriageStatus; note: string;
};
export type DecisionReceipt = {
  decision_id: string; report_id: string; triage_status: TriageStatus; triage_version: number; created_at: string;
};
export const isTriageStatus = (value: unknown): value is TriageStatus => TRIAGE_STATUSES.some(status => status === value);
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function fail(code = 'CC_MOD_RESPONSE'): never { throw Object.assign(new Error('Moderation request unavailable.'), { code }); }
export const moderationCode = (error: unknown) => record(error) && typeof error.code === 'string' ? error.code : '';
export const moderationAccessLost = (error: unknown) => ['42501', 'PT403', 'CC_MOD_SESSION', 'PGRST301', 'PGRST303'].includes(moderationCode(error));

export function decisionValidation(note: string) {
  const length = Array.from(note.trim()).length;
  return length < 10 || length > 2000 ? 'Explain this decision in 10–2,000 characters.' : '';
}
export function normalizeDecision(input: DecisionAttempt): DecisionAttempt {
  if (!input || !isReportId(input.reportId) || !isReportId(input.operationId) || !version(input.expectedVersion)
    || !isTriageStatus(input.status) || typeof input.note !== 'string' || decisionValidation(input.note)) fail('CC_MOD_INPUT');
  return { reportId: input.reportId.toLowerCase(), operationId: input.operationId.toLowerCase(),
    expectedVersion: input.expectedVersion, status: input.status, note: input.note.trim() };
}

async function sessionFor(userId: string) {
  if (!isReportId(userId)) fail('CC_MOD_SESSION');
  try { return await assertOfferSession(userId); } catch { return fail('CC_MOD_SESSION'); }
}
export async function moderationRpc(userId: string, name: string, args: Record<string, unknown> = {}) {
  const session = await sessionFor(userId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase.rpc(name, args)
      .setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(controller.signal);
    // Do not deliver private results to a newly signed-in account, including
    // a replacement session for the same user.
    const current = await sessionFor(userId);
    if (current.access_token !== session.access_token) fail('CC_MOD_SESSION');
    if (error) fail(error.code || 'CC_MOD_NETWORK');
    return data as unknown;
  } finally { clearTimeout(timeout); }
}
const rpc = moderationRpc;
export async function getModerationAccess(userId: string): Promise<StaffRole | null> {
  const data = await rpc(userId, 'get_my_moderation_access');
  if (!record(data) || !['admin', 'moderator', null].includes(data.role)) fail();
  return data.role;
}
function summary(data: unknown): ReportSummary {
  if (!record(data) || !isReportId(data.report_id) || !isReportTargetType(data.target_type) || !isReportReason(data.reason)
    || !timestamp(data.created_at) || !isTriageStatus(data.triage_status) || !version(data.triage_version)) fail();
  return { report_id: data.report_id.toLowerCase(), target_type: data.target_type, reason: data.reason,
    created_at: data.created_at, triage_status: data.triage_status, triage_version: data.triage_version };
}
export async function listModerationReports(userId: string, status: TriageStatus, cursor?: ReportCursor): Promise<ReportSummary[]> {
  if (!isTriageStatus(status) || (cursor && (!isReportId(cursor.report_id) || !timestamp(cursor.created_at)))) fail('CC_MOD_INPUT');
  const data = await rpc(userId, 'list_moderation_reports', {
    p_status: status, p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.report_id ?? null,
  });
  if (!Array.isArray(data) || data.length > 20) fail();
  const rows = data.map(summary);
  if (rows.some(row => row.triage_status !== status) || new Set(rows.map(row => row.report_id)).size !== rows.length) fail();
  return rows;
}
const evidenceFields: Record<ReportTargetType, [string, string][]> = {
  student: [['display_name', 'Display name']],
  request: [['title', 'Title'], ['description', 'Description'], ['category', 'Category'], ['points', 'Points'], ['status', 'Request status']],
  message: [['body', 'Message'], ['created_at', 'Sent']],
  course_review: [['course_code', 'Course'], ['term_name', 'Term'], ['difficulty', 'Difficulty'], ['workload', 'Workload'], ['grade', 'Grade'], ['comment', 'Review'], ['tips', 'Study tips'], ['instructor', 'Instructor'], ['created_at', 'Posted']],
};
export async function getModerationReport(userId: string, reportId: string): Promise<ModerationReport> {
  if (!isReportId(reportId)) fail('CC_MOD_INPUT');
  const data = await rpc(userId, 'get_moderation_report', { p_report_id: reportId.toLowerCase() });
  const head = summary(data);
  if (!record(data) || head.report_id !== reportId.toLowerCase() || typeof data.details !== 'string'
    || !record(data.evidence) || !Array.isArray(data.history)) fail();
  // Display known scalar snapshots only; never forward identities or arbitrary
  // JSON/HTML from the transport. Evidence stays in the focused screen's memory.
  const evidence = evidenceFields[head.target_type].flatMap(([key, label]) => {
    const value = data.evidence[key];
    if (key === 'difficulty' || key === 'workload') {
      return [{ label, value: Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
        ? `${value}/5` : 'Not captured in this report' }];
    }
    return (typeof value === 'string' || typeof value === 'number') ? [{ label, value: String(value) }] : [];
  });
  const history = data.history.map((item: unknown): ReportDecision => {
    if (!record(item) || !isReportId(item.decision_id) || !isTriageStatus(item.from_status) || !isTriageStatus(item.to_status)
      || !version(item.version) || typeof item.note !== 'string' || !timestamp(item.created_at) || typeof item.is_mine !== 'boolean') fail();
    return { decision_id: item.decision_id, from_status: item.from_status, to_status: item.to_status,
      version: item.version, note: item.note, created_at: item.created_at, is_mine: item.is_mine };
  });
  return { ...head, details: data.details, evidence, history };
}
export async function recordModerationDecision(userId: string, input: DecisionAttempt): Promise<DecisionReceipt> {
  const attempt = normalizeDecision(input);
  const data = await rpc(userId, 'record_moderation_decision', {
    p_report_id: attempt.reportId, p_operation_id: attempt.operationId, p_expected_version: attempt.expectedVersion,
    p_status: attempt.status, p_note: attempt.note,
  });
  if (!record(data) || !isReportId(data.decision_id) || data.report_id !== attempt.reportId
    || data.triage_status !== attempt.status || data.triage_version !== attempt.expectedVersion + 1 || !timestamp(data.created_at)) fail();
  return { decision_id: data.decision_id, report_id: data.report_id, triage_status: data.triage_status,
    triage_version: data.triage_version, created_at: data.created_at };
}
