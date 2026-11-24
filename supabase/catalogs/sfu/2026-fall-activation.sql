-- Reviewed reference-data correction for Fall 2026 testing.
-- Run after the Fall catalog import, using an administrative connection.
-- Retains term/course IDs and every enrollment. This is not an automatic rollover.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $$ begin
  if (now() at time zone 'America/Vancouver')::date not between date '2026-09-09' and date '2026-12-20' then
    raise exception 'This activation is only valid during Fall 2026.';
  end if;
  if not exists(select 1 from public.academic_terms where code='2026-fall'
    and starts_on=date '2026-09-09' and ends_on=date '2026-12-20' and status='current') then
    raise exception 'Import the reviewed Fall catalog first.';
  end if;
  if not exists(select 1 from public.courses c join public.academic_terms t on t.id=c.term_id
    where t.code='2026-fall' and c.catalog_source='sfu-course-outlines') then
    raise exception 'The Fall catalog has not been imported.';
  end if;
end $$;
update public.academic_terms set status='past'
where code='2026-summer' and status='current'
  and ends_on < (now() at time zone 'America/Vancouver')::date;
do $$ begin
  if (select count(*) from public.academic_terms where status='current') <> 1 then
    raise exception 'Unexpected current terms; review before activating Fall.';
  end if;
end $$;
commit;
