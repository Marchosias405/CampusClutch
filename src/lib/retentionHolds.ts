import { decisionValidation, moderationRpc } from './moderation';
import { isReportId } from './safetyReports';

export const retentionTargets = { case: 'Moderation case', job: 'Request', thread: 'Direct conversation', notice: 'Bell notice' } as const;
export type TargetKind = keyof typeof retentionTargets;
export type Hold = {
  id: string; placed_by: string; placed_at: string; reason: string;
  through_date?: string | null; released_by: string | null; released_at: string | null; release_reason: string | null;
};
export type HoldChange = { action: 'place' | 'release'; holdId: string; reason: string; through?: string };
export type EvidenceItem = { id: string; label: string; captured_at: string; fields: Record<string, string | number | boolean> };
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validHoldDate(value: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validHold(row: unknown): row is Hold {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isReportId(r.id) && isReportId(r.placed_by) && date(r.placed_at) && typeof r.reason === 'string'
    && (r.through_date == null || (typeof r.through_date === 'string' && validHoldDate(r.through_date)))
    && ((r.released_by === null && r.released_at === null && r.release_reason === null)
      || (isReportId(r.released_by) && date(r.released_at) && typeof r.release_reason === 'string'));
}
export async function loadHolds(user: string, kind: TargetKind, id: string): Promise<Hold[]> {
  const rows = await moderationRpc(user, 'get_retention_holds', { p_kind: kind, p_id: id });
  if (!Array.isArray(rows) || !rows.every(validHold)) throw new Error('Hold history unavailable');
  return rows;
}
function validItem(row: unknown): row is EvidenceItem {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === 'string' && /^[1-9][0-9]*$/.test(r.id) && typeof r.label === 'string'
    && date(r.captured_at) && Boolean(r.fields) && typeof r.fields === 'object' && !Array.isArray(r.fields)
    && Object.values(r.fields ?? {}).every(v => ['string', 'number', 'boolean'].includes(typeof v));
}
export async function loadDeletionEvidence(user: string, kind: TargetKind, id: string, before?: string): Promise<EvidenceItem[]> {
  const rows = await moderationRpc(user, 'get_held_deletion_evidence', { p_kind: kind, p_id: id, p_before: before ?? null });
  if (!Array.isArray(rows) || rows.length > 20 || !rows.every(validItem)) throw new Error('Evidence unavailable');
  return rows;
}
export async function changeHold(user: string, kind: TargetKind, id: string, change: HoldChange) {
  if (decisionValidation(change.reason) || !isReportId(change.holdId)) throw new Error('Invalid hold');
  const args = { p_kind: kind, p_id: id, p_hold_id: change.holdId, p_reason: change.reason.trim() };
  if (change.through && (change.action !== 'place' || !validHoldDate(change.through))) throw new Error('Invalid retention date');
  const receipt = change.through
    ? await moderationRpc(user, 'place_dated_retention_hold', { ...args, p_through: change.through })
    : await moderationRpc(user, 'change_retention_hold', { ...args, p_action: change.action });
  if (receipt !== change.holdId) throw new Error('Hold status unknown');
}
