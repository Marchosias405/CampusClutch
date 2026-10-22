-- Captured with Supabase db pull; scoped to the reviewed catalog changes.
-- SFU catalog checkpoint: additive provenance and bounded term search.
-- Existing course IDs and memberships remain unchanged. Reference-data imports
-- run through a reviewed administrative SQL transaction, never a client RPC.
alter table public.courses
  add column units numeric(5, 2),
  add column degree_level text,
  add column delivery_mode text,
  add column catalog_source text,
  add column source_fetched_at timestamptz,
  add column source_sections jsonb not null default '[]'::jsonb,
  add constraint courses_units_check check (units > 0 and units <= 100),
  add constraint courses_degree_level_check
    check (degree_level in ('undergraduate', 'graduate')),
  add constraint courses_delivery_mode_check
    check (delivery_mode in ('in_person', 'online', 'mixed')),
  add constraint courses_catalog_source_check
    check (catalog_source = 'sfu-course-outlines'),
  add constraint courses_source_sections_check
    check (jsonb_typeof(source_sections) = 'array'),
  add constraint courses_sfu_catalog_eligibility_check check (
    catalog_source is null or (
      units is not null and units >= 3
      and degree_level is not null and degree_level = 'undergraduate'
      and delivery_mode is not null
      and source_fetched_at is not null
      and jsonb_array_length(source_sections) > 0
    )
  );

comment on column public.courses.units is
  'Minimum published units across included enrollment sections at this campus. NULL for legacy fixtures.';
comment on column public.courses.catalog_source is
  'Administrative catalog provenance. SFU imports currently require undergraduate offerings of at least 3 units.';
comment on column public.courses.source_sections is
  'Public section codes and official source URLs; no student or instructor personal data.';

create index courses_active_catalog_page_idx
  on public.courses (term_id, code collate "C", id)
  where status = 'active';

create or replace function public.search_course_catalog(
  p_term_id uuid,
  p_query text default '',
  p_after_code text default null,
  p_after_id uuid default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  code text,
  title text,
  status text,
  campus_id uuid,
  campus_display_name text,
  units numeric,
  degree_level text,
  delivery_mode text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  search_pattern text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_term_id is null then
    raise exception 'Academic term is required.' using errcode = '22023';
  end if;
  if char_length(normalized_query) > 100 then
    raise exception 'Search query must be at most 100 characters.' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Page size must be between 1 and 100.' using errcode = '22023';
  end if;
  if (p_after_code is null) <> (p_after_id is null) then
    raise exception 'Both cursor values are required.' using errcode = '22023';
  end if;
  if p_after_code is not null and (
    char_length(p_after_code) < 2 or char_length(p_after_code) > 32
    or p_after_code <> btrim(p_after_code)
  ) then
    raise exception 'Invalid course cursor.' using errcode = '22023';
  end if;

  -- Search text is literal: %, _ and backslash cannot broaden a query.
  search_pattern := '%' || replace(replace(replace(
    normalized_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';

  return query
    select c.id, c.code, c.title, c.status, c.campus_id,
           ca.display_name, c.units, c.degree_level, c.delivery_mode
    from public.courses c
    left join public.campuses ca on ca.id = c.campus_id
    where c.term_id = p_term_id
      and c.status = 'active'
      and (normalized_query = ''
           or c.code ilike search_pattern escape E'\\'
           or c.title ilike search_pattern escape E'\\')
      and (p_after_code is null
           or (c.code collate "C", c.id) > (p_after_code collate "C", p_after_id))
    order by c.code collate "C", c.id
    limit p_limit;
end;
$$;

revoke all on function public.search_course_catalog(uuid, text, text, uuid, integer)
  from public, anon;
grant execute on function public.search_course_catalog(uuid, text, text, uuid, integer)
  to authenticated;

comment on function public.search_course_catalog(uuid, text, text, uuid, integer) is
  'Authenticated, RLS-preserving course search for one term with literal search and stable cursor pagination.';
