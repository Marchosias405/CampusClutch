import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CampusRequest } from '../types';
import { env } from './env';

export type RequestType = 'Delivery' | 'Pickup' | 'Event Help' | 'Study Help';
export type CampusName = 'Burnaby' | 'Surrey' | 'Vancouver';

export const emptyRequestForm = {
  selectedRequestType: 'Delivery' as RequestType,
  campus: 'Burnaby' as CampusName,
  requestTitle: '', roomLocation: '', pickupLocation: '', dropoffLocation: '',
  eventName: '', eventTask: '', courseOrSubject: '', studyTopic: '',
  description: '', pointsOffered: '', deadlineAt: '',
};
export type RequestFormValues = typeof emptyRequestForm;

export function formFromRequest(row: CampusRequest): RequestFormValues {
  const labels = { DELIVERY: 'Delivery', PICKUP: 'Pickup', 'EVENT HELP': 'Event Help', 'STUDY HELP': 'Study Help' } as const;
  return {
    ...emptyRequestForm, selectedRequestType: labels[row.category], campus: row.campus as CampusName,
    requestTitle: row.title, description: row.description, pointsOffered: String(row.points),
    roomLocation: row.roomLocation ?? '', pickupLocation: row.pickupLocation ?? '',
    dropoffLocation: row.dropoffLocation ?? '', eventName: row.eventName ?? '',
    eventTask: row.eventTask ?? '', courseOrSubject: row.courseOrSubject ?? '',
    studyTopic: row.studyTopic ?? '', deadlineAt: row.deadlineAt ?? '',
  };
}

export function requestDraftKey(userId: string, editId?: string) {
  return `campusclutch:request-draft:v1:${env.supabaseUrl}:${userId}:${editId ?? 'new'}`;
}

// A read after recreation or a discard after typing must see all preceding writes.
const pending = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(key, next);
  const finish = () => { if (pending.get(key) === next) pending.delete(key); };
  void next.then(finish, finish);
  return next;
}

export function clearRequestDraft(key: string, submitted?: { baseline: string; values: RequestFormValues }) {
  return inOrder(key, async () => {
    // A server response can arrive after the student has left and started another draft.
    if (submitted && await AsyncStorage.getItem(key) !== JSON.stringify(submitted)) return;
    await AsyncStorage.removeItem(key);
  });
}

export function saveRequestDraft(key: string, baseline: string, values: RequestFormValues) {
  return inOrder(key, () => AsyncStorage.setItem(key, JSON.stringify({ baseline, values })));
}

export function readRequestDraft(key: string, baseline: string): Promise<RequestFormValues | null> {
  return inOrder(key, async () => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    let stored;
    try { stored = JSON.parse(raw); } catch { /* Discard unreadable local data below. */ }
    const v = stored?.values;
    if (stored?.baseline === baseline && v &&
        Object.keys(emptyRequestForm).every(field => typeof v[field] === 'string') &&
        ['Delivery', 'Pickup', 'Event Help', 'Study Help'].includes(v.selectedRequestType) &&
        ['Burnaby', 'Surrey', 'Vancouver'].includes(v.campus) &&
        (!v.deadlineAt || Number.isFinite(Date.parse(v.deadlineAt)))) return v;
    await AsyncStorage.removeItem(key);
    return null;
  });
}
