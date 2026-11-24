begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local timezone = 'America/Vancouver';
select no_plan();

create function pg_temp.key(n integer) returns uuid language sql immutable as $$
  select ('bac10000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Insert the same parent and subtype shapes accepted by the request form.
create function pg_temp.post(
  n integer, kind text default 'delivery', state text default 'expired',
  deadline timestamptz default now() - interval '120 days',
  edited timestamptz default now() - interval '121 days',
  archived boolean default false, round_no integer default 1, removed boolean default false,
  owner_no integer default 1
) returns void language plpgsql as $$
begin
  insert into public.requests(id, owner_id, category, title, description, campus_id,
    room_location, deadline_at, points, item_size, status, created_at, updated_at,
    cancelled_at, accepted_at, completed_at, owner_archived_at, offer_round, moderation_removed_at)
  values(pg_temp.key(n), pg_temp.key(owner_no), kind, 'Help on campus', 'Please help at the library.',
    (select id from public.campuses where slug = 'burnaby'), 'Library', deadline, 5, 'small', state,
    least(deadline, edited) - interval '1 day', edited,
    case when state = 'cancelled' then edited end, case when state in ('accepted','completed') then edited end,
    case when state = 'completed' then edited end, case when archived then edited end,
    round_no, case when removed then edited end);
  case kind
    when 'delivery' then insert into public.delivery_request_details(request_id, pickup_location, dropoff_location)
      values(pg_temp.key(n), 'Cafe', 'Library');
    when 'pickup' then insert into public.pickup_request_details(request_id, pickup_location, destination)
      values(pg_temp.key(n), 'Store', 'Library');
    when 'event_help' then insert into public.event_help_request_details(request_id, event_name, help_needed)
      values(pg_temp.key(n), 'Study night', 'Set up chairs');
    when 'study_help' then insert into public.study_help_request_details(request_id, course_or_subject, topic)
      values(pg_temp.key(n), 'CMPT 120', 'Loops');
  end case;
end $$;

create function pg_temp.remains(n integer) returns boolean language sql as $$
  select exists(select from public.requests where id = pg_temp.key(n))
$$;
create function pg_temp.cutoff(n integer) returns timestamptz language sql as $$
  select window_end from safety_private.unclaimed_request_windows where id = pg_temp.key(n)
$$;
create function pg_temp.due(n integer, as_of timestamptz) returns boolean language sql as $$
  select exists(select from safety_private.unclaimed_request_windows
    where id = pg_temp.key(n) and not protected and window_end <= as_of)
$$;

select ok(not has_function_privilege(role_name, 'safety_private.erase_expired_unclaimed_requests()', 'execute')
  and not has_table_privilege(role_name, 'safety_private.unclaimed_request_windows', 'select'),
  role_name || ' cannot sweep posts or inspect private retention records')
from unnest(array['anon','authenticated','service_role']) role_name;

insert into auth.users(id, email, email_confirmed_at)
select pg_temp.key(n), 'unclaimed-post-' || n || '@test.local', now() from unnest(array[1,2,4,5]) n;
update public.profiles set display_name = 'Retention tester', onboarding_completed_at = now()
where id in (pg_temp.key(1), pg_temp.key(2));
insert into auth.sessions(id, user_id, created_at, updated_at) values(pg_temp.key(3), pg_temp.key(1), now(), now());

-- March crosses the spring DST transition in Vancouver. March 1 at noon plus
-- 2,160 elapsed hours is May 30 at 1 p.m., even under the session time zone.
select pg_temp.post(100, deadline => '2024-03-01 12:00-08', edited => '2024-02-28 12:00-08');
select is(pg_temp.cutoff(100), '2024-05-30 13:00-07'::timestamptz, 'The later deadline starts 90 elapsed days');
select ok(not pg_temp.due(100, '2024-05-30 12:59:59.999999-07') and pg_temp.due(100, '2024-05-30 13:00-07'),
  'Eligibility starts at the exact cutoff');
select pg_temp.post(101, 'pickup', 'open', deadline => '2024-03-01 12:00-08', edited => '2024-03-02 12:00-08');
select is(pg_temp.cutoff(101), '2024-05-31 13:00-07'::timestamptz, 'A later edit resets the elapsed window');
select pg_temp.post(102, 'event_help');
select pg_temp.post(103, 'study_help', 'open');
select pg_temp.post(110, state => 'open', deadline => now() + interval '1 day');
select pg_temp.post(111, deadline => now() - interval '89 days');
select pg_temp.post(112, edited => now() - interval '1 day');
select pg_temp.post(113, state => 'cancelled');
select pg_temp.post(114, state => 'accepted');
select pg_temp.post(115, state => 'completed');
select pg_temp.post(116, archived => true);
select pg_temp.post(117, round_no => 2);
select pg_temp.post(118, removed => true);
select pg_temp.post(n) from generate_series(120, 130) n;
select pg_temp.post(131, state => 'open');
select pg_temp.post(132, owner_no => 4);
select pg_temp.post(133, owner_no => 5);
select pg_temp.post(134, archived => true);
insert into account_private.deletions(id, profile_id, receipt_hash)
values(pg_temp.key(332), pg_temp.key(4), digest('pending expiry fixture','sha256'));
update public.profiles set deleted_at = now() - interval '10 days' where id = pg_temp.key(5);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.key(1)::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.key(1), 'role', 'authenticated',
  'session_id', pg_temp.key(3))::text, true);
select is(public.set_my_request_archived(pg_temp.key(131), true), pg_temp.key(131),
  'The owner can archive a past-deadline listing before its stored status has changed');
reset role;

-- Use independent posts so that one protection cannot mask another.
insert into public.request_offers(id, request_id, offering_user_id, status, withdrawn_at)
values(pg_temp.key(320), pg_temp.key(120), pg_temp.key(2), 'withdrawn', now() - interval '120 days');
delete from public.notifications where request_id = pg_temp.key(120);
insert into public.request_point_reservations(request_id, offer_round, poster_id, helper_id, amount, status, released_at)
values(pg_temp.key(121), 1, pg_temp.key(1), pg_temp.key(2), 5, 'released', now() - interval '120 days');
insert into public.points_ledger(profile_id, kind, amount, request_id, offer_round)
values(pg_temp.key(1), 'request_sent', -5, pg_temp.key(122), 1);
insert into safety_private.reports(id, operation_id, target_type, request_id, reason, details, payload_hash, evidence)
values(pg_temp.key(323), pg_temp.key(423), 'request', pg_temp.key(123), 'spam', '', digest('fixture','sha256'), '{}');
insert into public.notifications(id, recipient_id, event_type, title, body, navigation_key, source_event_key, request_id)
values(pg_temp.key(324), pg_temp.key(1), 'request_expired', 'Request expired', 'Request expired.',
  'request_details', 'unclaimed-post-notice', pg_temp.key(124)),
  (pg_temp.key(334), pg_temp.key(1), 'request_expired', 'Request expired', 'Request expired.',
   'request_details', 'restored-post-notice', pg_temp.key(134));
insert into safety_private.deletion_evidence_batches(target_kind, target_id, notice_request_id)
values('job', pg_temp.key(125), null), ('notice', pg_temp.key(326), pg_temp.key(126));
insert into safety_private.job_dispute_clocks(request_id, resolved_at)
values(pg_temp.key(127), now() - interval '120 days');
insert into safety_private.retention_holds(id, target_kind, target_id, placed_by, reason)
values(pg_temp.key(328), 'job', pg_temp.key(128), pg_temp.key(2), 'First access request'),
      (pg_temp.key(428), 'job', pg_temp.key(128), pg_temp.key(2), 'Second access request'),
      (pg_temp.key(329), 'job', pg_temp.key(129), pg_temp.key(2), 'Keep through today'),
      (pg_temp.key(330), 'job', pg_temp.key(130), pg_temp.key(2), 'Keep through yesterday');
insert into safety_private.retention_deadlines(hold_id, through_date)
values(pg_temp.key(329), (now() at time zone 'UTC')::date),
      (pg_temp.key(330), (now() at time zone 'UTC')::date - 1);
insert into safety_private.retention_hold_releases(hold_id, released_by, reason)
select pg_temp.key(n), pg_temp.key(2), 'Access request complete' from unnest(array[328,329,330]) n;

create function pg_temp.interrupt_sweep() returns trigger language plpgsql as $$
begin raise exception 'retention test interruption'; end $$;
create trigger interrupt_unclaimed_cleanup before delete on public.requests for each row
  when (old.id = 'bac10000-0000-4000-8000-000000000103') execute function pg_temp.interrupt_sweep();
select throws_ok('select safety_private.erase_expired_unclaimed_requests()', 'P0001',
  'retention test interruption', 'An interrupted batch rolls back');
select ok(pg_temp.remains(100) and exists(select from public.study_help_request_details where request_id = pg_temp.key(103)),
  'The failed sweep leaves the parent and subtype data intact');
drop trigger interrupt_unclaimed_cleanup on public.requests;

select is(safety_private.erase_expired_unclaimed_requests(), 5, 'The four ordinary posts and yesterday’s released hold expire');
select ok(not pg_temp.remains(n), message) from (values
  (100,'Expired delivery is removed'), (101,'Overdue open pickup is removed without an offer-page visit'),
  (102,'Expired event help is removed'), (103,'Overdue open study help is removed'),
  (130,'Released hold is eligible after its last UTC day')) cases(n, message);
select ok(not exists(select from public.delivery_request_details where request_id = pg_temp.key(100))
  and not exists(select from public.pickup_request_details where request_id = pg_temp.key(101))
  and not exists(select from public.event_help_request_details where request_id = pg_temp.key(102))
  and not exists(select from public.study_help_request_details where request_id = pg_temp.key(103)),
  'All four request subtype records expire with their posts');
select ok(pg_temp.remains(n), message) from (values
  (110,'A live listing remains'), (111,'The owner still has the full window after its deadline'),
  (112,'A recent edit keeps the post'), (113,'A cancelled post remains'), (114,'An accepted assignment remains'),
  (115,'A completed job remains'), (116,'Owner-archived history remains'), (117,'A reopened round remains'),
  (118,'A moderation removal remains'), (120,'A withdrawn offer keeps prior participation'),
  (121,'A released reservation keeps assignment history'), (122,'An associated points transaction remains linked'),
  (123,'A report keeps its evidence source'), (124,'A bell notification keeps its target'),
  (125,'Held private job evidence keeps its source'), (126,'Held private notice evidence keeps its source request'),
  (127,'A saved dispute clock remains'), (128,'One open hold is sufficient after another closes'),
  (129,'A released dated hold protects the entire specified UTC day'),
  (131,'Archiving from the owner screen preserves the post'), (132,'An account with pending deletion keeps its post'),
  (133,'A tombstoned owner stays under the separate account-deletion retention rules')) cases(n, message);
select is((select amount from public.points_ledger where request_id = pg_temp.key(122)), -5::bigint,
  'Posted-request cleanup preserves the ledger entry and its reference');
select ok(exists(select from public.notifications where id = pg_temp.key(324) and request_id = pg_temp.key(124))
  and exists(select from safety_private.reports where id = pg_temp.key(323) and request_id = pg_temp.key(123)),
  'The original notification and report links survive');
select is(safety_private.erase_expired_unclaimed_requests(), 0, 'Immediate retry has no effect');

insert into safety_private.retention_hold_releases(hold_id, released_by, reason)
values(pg_temp.key(428), pg_temp.key(2), 'Second request complete');
select is(safety_private.erase_expired_unclaimed_requests(), 1, 'Only the last released undated hold allows cleanup');
select ok(not pg_temp.remains(128) and
  (select count(*) from safety_private.retention_holds where target_id = pg_temp.key(128)) = 2 and
  (select count(*) from safety_private.retention_hold_releases where hold_id in (pg_temp.key(328), pg_temp.key(428))) = 2,
  'Placement and release audit rows remain after their source post expires');

set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.key(1)::text, true);
select is(public.set_my_request_archived(pg_temp.key(116), false), pg_temp.key(116), 'Owner restores an archived post');
select is(public.set_my_request_archived(pg_temp.key(131), false), pg_temp.key(131), 'An owner can restore the post they archived');
select is(public.set_my_request_archived(pg_temp.key(134), false), pg_temp.key(134), 'An owner can restore a post with a bell notice');
reset role;
delete from public.notifications where id = pg_temp.key(334);
select ok(pg_temp.cutoff(134) >= now() + interval '2160 hours' and not pg_temp.due(134, now()),
  'After the notice expires, the restored post still receives its full grace period');
select ok(pg_temp.cutoff(116) >= now() + interval '2160 hours' and not pg_temp.due(116, now()),
  'Restoring archived history gives the owner another full window');
select ok((select owner_archived_at is null and status = 'expired' from public.requests where id = pg_temp.key(131)),
  'The restored post is visible to the owner as expired');

select pg_temp.post(n) from generate_series(5000, 5052) n;
select is(safety_private.erase_expired_unclaimed_requests(), 50, 'One sweep processes at most 50 posts');
select is(safety_private.erase_expired_unclaimed_requests(), 3, 'The next sweep recovers the remaining posts');
select is(safety_private.erase_expired_unclaimed_requests(), 0, 'A drained queue is idempotent');
set constraints all immediate;
select * from finish();
rollback;
