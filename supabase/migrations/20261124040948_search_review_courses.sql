begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function course_reviews_private.search_courses(p_query text, p_after_code text, p_limit integer)
returns table(course_code text, title text)
language plpgsql stable security definer set search_path = '' as $$
declare
  query_text text := lower(btrim(coalesce(p_query, '')));
  code_fragment text := regexp_replace(query_text, '\s+', '', 'g');
begin
  perform safety_private.check_account_access();
  perform course_reviews_private.require_actor();
  if length(query_text) > 80 then
    raise exception 'Use a shorter course search.' using errcode = '22023';
  end if;

  return query
    with names as materialized (
      select c.code, c.title, 1 as priority, t.starts_on, c.id
      from public.courses c join public.academic_terms t on t.id = c.term_id
      where p_after_code is null or c.code > p_after_code
      union all
      select h.course_code, h.title, 2, null::date, null::uuid
      from course_reviews_private.catalog_history h
      where p_after_code is null or h.course_code > p_after_code
      union all
      -- An unlisted code becomes discoverable when it has a visible review.
      select distinct r.course_code, r.course_code, 3, null::date, null::uuid
      from course_reviews_private.reviews r
      where r.removed_at is null and r.archived_at is null
        and (p_after_code is null or r.course_code > p_after_code)
    ), hits as (
      select distinct n.code from names n
      where query_text = '' or strpos(lower(n.title), query_text) > 0
        or strpos(lower(replace(n.code, ' ', '')), code_fragment) > 0
      order by n.code limit greatest(1, least(coalesce(p_limit, 26), 51))
    )
    select distinct on (n.code) n.code, n.title from names n join hits using (code)
    order by n.code, n.priority, n.starts_on desc nulls last, n.id;
end;
$$;

create function public.search_review_courses(p_query text default '', p_after_code text default null,
                                            p_limit integer default 26)
returns table(course_code text, title text)
language sql stable security invoker set search_path = '' as $$
  select safety_private.check_account_access();
  select * from course_reviews_private.search_courses(p_query, p_after_code, p_limit);
$$;

revoke all on function course_reviews_private.search_courses(text,text,integer),
  public.search_review_courses(text,text,integer) from public, anon, authenticated, service_role;
grant execute on function course_reviews_private.search_courses(text,text,integer),
  public.search_review_courses(text,text,integer) to authenticated;
commit;
