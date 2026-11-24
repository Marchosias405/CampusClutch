import { moderationRpc } from './moderation';
import { isEnforcementKind } from './moderationEnforcement';
import type { EnforcementKind } from './moderationEnforcement';
import { isReportId } from './safetyReports';

export type AccountStanding = {
  warning_count: number; suspended_until: string | null; suspended: boolean;
  notices: { id: string; kind: EnforcementKind; reason: string; created_at: string; automatic_suspension: boolean }[];
};
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export async function getAccountStanding(userId: string): Promise<AccountStanding> {
  const data = await moderationRpc(userId, 'get_my_account_standing') as AccountStanding;
  if (!data || !Number.isSafeInteger(data.warning_count) || data.warning_count < 0 || typeof data.suspended !== 'boolean'
    || (data.suspended_until !== null && !date(data.suspended_until)) || (data.suspended && !data.suspended_until)
    || !Array.isArray(data.notices) || data.notices.length > 20) throw new Error('Unable to check account status.');
  return { warning_count: data.warning_count, suspended: data.suspended, suspended_until: data.suspended_until,
    notices: data.notices.map(item => {
      if (!item || !isReportId(item.id) || !isEnforcementKind(item.kind) || !date(item.created_at)
        || typeof item.reason !== 'string' || typeof item.automatic_suspension !== 'boolean') throw new Error('Invalid account notice.');
      return { id: item.id, kind: item.kind, reason: item.reason, created_at: item.created_at, automatic_suspension: item.automatic_suspension };
    }) };
}
export async function acknowledgeAccountNotice(userId: string, through: string) {
  if (!date(through)) throw new Error('Invalid account notice.');
  await moderationRpc(userId, 'acknowledge_account_notice', { p_through: through });
}
