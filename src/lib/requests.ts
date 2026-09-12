import { supabase } from './supabase';
import { getCampuses } from './profiles';
import type { CampusRequest, RequestCategory } from '../types';

const categories = { DELIVERY: 'delivery', PICKUP: 'pickup', 'EVENT HELP': 'event_help', 'STUDY HELP': 'study_help' } as const;
type Related<T> = T | T[] | null;
const one = <T,>(value: Related<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;
type Row = {
  id: string; owner_id: string; category: string; title: string; description: string;
  campus_id: string; room_location: string; deadline_at: string; points: number;
  item_size: string; status: CampusRequest['status']; created_at: string; is_urgent: boolean;
  campuses: { display_name: string; slug: string } | null;
  delivery_request_details: Related<{ pickup_location: string; dropoff_location: string }>;
  pickup_request_details: Related<{ pickup_location: string; destination: string }>;
  event_help_request_details: Related<{ event_name: string; help_needed: string }>;
  study_help_request_details: Related<{ course_or_subject: string; topic: string }>;
};
const selection = '*,campuses(display_name,slug),delivery_request_details(*),pickup_request_details(*),event_help_request_details(*),study_help_request_details(*)';
function mapRow(row: Row): CampusRequest {
  const delivery = one(row.delivery_request_details);
  const pickup = one(row.pickup_request_details);
  const event = one(row.event_help_request_details);
  const study = one(row.study_help_request_details);
  return {
    id: row.id, ownerId: row.owner_id, campusId: row.campus_id,
    category: Object.keys(categories).find(key => categories[key as keyof typeof categories] === row.category) as CampusRequest['category'],
    title: row.title, description: row.description, campus: row.campuses ? row.campuses.slug[0].toUpperCase() + row.campuses.slug.slice(1) : undefined,
    roomLocation: row.room_location, location: `${row.campuses?.display_name ?? 'Campus'} • ${row.room_location}`,
    deadlineAt: row.deadline_at, timeLabel: new Date(row.deadline_at).toLocaleString(),
    points: row.points, itemSize: (row.item_size[0].toUpperCase() + row.item_size.slice(1)) as CampusRequest['itemSize'],
    status: row.status === 'open' && Date.parse(row.deadline_at) <= Date.now() ? 'expired' : row.status,
    createdAt: row.created_at, isUrgent: row.is_urgent, secondaryCategory: row.is_urgent ? 'URGENT' : undefined,
    pickupLocation: delivery?.pickup_location ?? pickup?.pickup_location,
    dropoffLocation: delivery?.dropoff_location ?? pickup?.destination,
    eventName: event?.event_name, eventTask: event?.help_needed,
    courseOrSubject: study?.course_or_subject, studyTopic: study?.topic,
  };
}
export function requestError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Unable to reach requests. Check your connection and try again.';
}
export async function loadRequest(id: string): Promise<CampusRequest | null> {
  const { data, error } = await supabase.from('requests').select(selection).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as Row) : null;
}
export async function loadRequests(category: RequestCategory, ownerId: string | null, offset: number) {
  let ids: string[];
  if (ownerId) {
    let query = supabase.from('requests').select('id').eq('owner_id', ownerId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 19);
    if (category !== 'ALL') query = query.eq('category', categories[category]);
    const { data, error } = await query;
    if (error) throw error;
    ids = data.map(row => row.id);
  } else {
    const { data, error } = await supabase.rpc('get_request_feed', { p_category: category === 'ALL' ? null : categories[category], p_limit: 20, p_offset: offset });
    if (error) throw error;
    ids = (data as { id: string }[]).map(row => row.id);
  }
  if (!ids.length) return { items: [], hasMore: false, nextOffset: offset };
  const { data, error } = await supabase.from('requests').select(selection).in('id', ids);
  if (error) throw error;
  const rows = new Map((data as unknown as Row[]).map(row => [row.id, mapRow(row)]));
  return { items: ids.flatMap(id => rows.has(id) ? [rows.get(id)!] : []), hasMore: ids.length === 20, nextOffset: offset + ids.length };
}
export async function saveRequest(request: Omit<CampusRequest, 'id'>, id?: string): Promise<string> {
  const { data: initial } = await supabase.auth.getSession();
  const userId = initial.session?.user.id;
  if (!userId) throw new Error('Please sign in again.');
  const campuses = await getCampuses();
  const campusId = campuses.find(campus => campus.slug === request.campus?.toLowerCase())?.id;
  if (!campusId) throw new Error('Campus unavailable. Please try again.');
  const details = request.category === 'DELIVERY' ? { pickup_location: request.pickupLocation, dropoff_location: request.dropoffLocation }
    : request.category === 'PICKUP' ? { pickup_location: request.pickupLocation, destination: request.dropoffLocation }
    : request.category === 'EVENT HELP' ? { event_name: request.eventName, help_needed: request.eventTask }
    : { course_or_subject: request.courseOrSubject, topic: request.studyTopic };
  const { data: current } = await supabase.auth.getSession();
  if (current.session?.user.id !== userId) throw new Error('Your account changed. Please reopen the form.');
  const { data, error } = await supabase.rpc('save_my_request', { p_request_id: id ?? null, p_payload: {
    category: categories[request.category], title: request.title, description: request.description,
    campus_id: campusId, room_location: request.roomLocation, deadline_at: request.deadlineAt,
    points: request.points, item_size: request.itemSize?.toLowerCase(), is_urgent: request.isUrgent ?? false, details,
  } });
  if (error) throw error;
  return data as string;
}
export async function cancelRequest(id: string) {
  const { error } = await supabase.rpc('cancel_my_request', { p_request_id: id });
  if (error) throw error;
}
