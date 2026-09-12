-- Task 9 checkpoint 2: bounded review and history with explicit profile fields.
create function request_private.offer_page(p_request_id uuid,p_limit integer,p_offset integer)
returns table (
 id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text
) language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_ids uuid[]; v_request public.requests;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or p_offset is null or p_offset<0 then
   raise exception 'Invalid offer page' using errcode='22023'; end if;
 select array_agg(page.id) into v_ids from (
   select o.id from public.request_offers o join public.requests r on r.id=o.request_id
   where (p_request_id is null and o.offering_user_id=v_user)
      or (r.id=p_request_id and (r.owner_id=v_user or o.offering_user_id=v_user))
   order by o.created_at desc,o.id desc limit p_limit offset p_offset
 ) page;
 -- Lock parents in a stable order. Only authorized requests in this page (or an
 -- explicitly requested owned request without offers) can be settled by a read.
 for v_request in select r.* from public.requests r
   where r.status='open' and r.deadline_at<=clock_timestamp()
   and ((r.id=p_request_id and r.owner_id=v_user) or exists (
     select 1 from public.request_offers o where o.id=any(v_ids) and o.request_id=r.id))
   order by r.id for update
 loop
   update public.requests set status='expired',updated_at=clock_timestamp() where public.requests.id=v_request.id;
 end loop;
 return query select o.id,o.request_id,o.offering_user_id,o.status,o.message,o.created_at,
   r.title,r.status,r.deadline_at,p.display_name,p.major,p.year_of_study,c.display_name
 from public.request_offers o join public.requests r on r.id=o.request_id
 join public.profiles p on p.id=o.offering_user_id left join public.campuses c on c.id=p.campus_id
 where o.id=any(v_ids) order by o.created_at desc,o.id desc;
end $$;
revoke all on function request_private.offer_page(uuid,integer,integer) from public,anon,authenticated;
grant execute on function request_private.offer_page(uuid,integer,integer) to authenticated;
create function public.get_request_offer_page(p_request_id uuid default null,p_limit integer default 20,p_offset integer default 0)
returns table (
 id uuid,request_id uuid,offering_user_id uuid,status text,message text,created_at timestamptz,
 request_title text,request_status text,request_deadline_at timestamptz,
 helper_display_name text,helper_major text,helper_year smallint,helper_campus text
) language sql security invoker set search_path='' as $$
 select * from request_private.offer_page(p_request_id,p_limit,p_offset);
$$;
revoke all on function public.get_request_offer_page(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_request_offer_page(uuid,integer,integer) to authenticated;
