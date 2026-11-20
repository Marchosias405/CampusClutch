import { assertOfferSession } from './offers';
import { supabase } from './supabase';

export const REPORT_REASONS = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'unsafe', label: 'Unsafe behavior' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
] as const;
export type ReportReason = typeof REPORT_REASONS[number]['value'];
export type ReportTargetType = 'student' | 'request' | 'message' | 'course_review';
export type ContentReportTargetType = Extract<ReportTargetType, 'message' | 'course_review'>;
export type SafetyReportTarget = {
  target_type: ContentReportTargetType; target_id: string; target_label: string;
};
export type SafetyReportAttempt = {
  operationId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string;
};
export type ReportReceipt = { report_id: string; created_at: string };
class ReportInputError extends Error { readonly code = 'CC_REPORT_INPUT'; }

export const isReportId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isReportTargetType = (value: unknown): value is ReportTargetType => value === 'student' || value === 'request'
  || value === 'message' || value === 'course_review';
export const isReportReason = (value: unknown): value is ReportReason => REPORT_REASONS.some(reason => reason.value === value);

export function validateReportFields(reason: unknown, details: unknown): string | null {
  if (!isReportReason(reason)) return 'Choose a reason for this report.';
  if (typeof details !== 'string' || Array.from(details.trim()).length > 2000) return 'Keep the details within 2,000 characters.';
  if (reason === 'other' && Array.from(details.trim()).length < 10) return 'Add at least 10 characters to explain this report.';
  return null;
}

export function normalizeReportAttempt(input: SafetyReportAttempt): SafetyReportAttempt {
  if (!input || !isReportId(input.operationId) || !isReportTargetType(input.targetType) || !isReportId(input.targetId)) {
    throw new ReportInputError('This report link is unavailable. Reopen the student profile, request, message, or course review.');
  }
  const issue = validateReportFields(input.reason, input.details);
  if (issue) throw new ReportInputError(issue);
  return {
    operationId: input.operationId.toLowerCase(), targetType: input.targetType,
    targetId: input.targetId.toLowerCase(), reason: input.reason, details: input.details.trim(),
  };
}

export function safetyReportError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (error instanceof ReportInputError) return error.message;
  if (code === 'CC_REPORT_SESSION') return 'Your session changed or could not be verified. Sign in again before retrying your saved report.';
  if (code === '42501') return 'This report target is unavailable to your account. Your saved report has been kept.';
  if (code === '54000') return 'You have reached the report limit for now. Your saved report has been kept; try again later.';
  if (code === '22023') return 'This report could not be submitted with the saved details. Reopen the report or discard the saved attempt before changing it.';
  return 'Unable to confirm the report. Check your connection and retry the same saved report; it may already have been received.';
}

async function reportSession(userId: string) {
  try { return await assertOfferSession(userId); }
  catch { throw Object.assign(new Error('Report session unavailable.'), { code: 'CC_REPORT_SESSION' }); }
}

export async function getSafetyReportTarget(userId: string, targetType: ContentReportTargetType, targetId: string): Promise<SafetyReportTarget> {
  if ((targetType !== 'message' && targetType !== 'course_review') || !isReportId(targetId)) {
    throw new ReportInputError('This report link is unavailable. Reopen the message or course review.');
  }
  if (!isReportId(userId)) throw Object.assign(new Error('Report session unavailable.'), { code: 'CC_REPORT_SESSION' });
  const session = await reportSession(userId);
  const { data, error } = await supabase.rpc('get_safety_report_target', {
    p_target_type: targetType, p_target_id: targetId.toLowerCase(),
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error) throw Object.assign(new Error('Unable to load this report target.'), { code: error.code });
  await reportSession(userId);
  if (!data || Array.isArray(data) || data.target_type !== targetType || !isReportId(data.target_id)
    || data.target_id.toLowerCase() !== targetId.toLowerCase() || typeof data.target_label !== 'string'
    || !data.target_label.trim() || Array.from(data.target_label).length > 200) {
    throw new Error('Unable to load this report target.');
  }
  // Only the server-authorized safe label reaches the form. Never forward a
  // message body, reviewer identity, or extra fields returned by the transport.
  return { target_type: targetType, target_id: targetId.toLowerCase(), target_label: data.target_label.trim() };
}

export async function submitSafetyReport(userId: string, input: SafetyReportAttempt): Promise<ReportReceipt> {
  const attempt = normalizeReportAttempt(input);
  if (!isReportId(userId)) throw Object.assign(new Error('Report session unavailable.'), { code: 'CC_REPORT_SESSION' });
  const session = await reportSession(userId);
  let response;
  try {
    response = await supabase.rpc('submit_safety_report', {
      p_operation_id: attempt.operationId, p_target_type: attempt.targetType, p_target_id: attempt.targetId,
      p_reason: attempt.reason, p_details: attempt.details,
    }).setHeader('Authorization', `Bearer ${session.access_token}`);
  } catch (error) { throw new Error(safetyReportError(error)); }
  const { data, error } = response;
  if (error) throw Object.assign(new Error(safetyReportError(error)), { code: error.code });
  await reportSession(userId);
  if (!data || !isReportId(data.report_id) || typeof data.created_at !== 'string' || !Number.isFinite(Date.parse(data.created_at))) {
    throw new Error(safetyReportError(null));
  }
  // The receipt never forwards moderation fields or identities from a response.
  return { report_id: data.report_id, created_at: data.created_at };
}
