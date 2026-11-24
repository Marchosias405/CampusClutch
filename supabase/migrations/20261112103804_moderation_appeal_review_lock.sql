begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Serialize changes to the student's standing without blocking the foreign-key
-- key-share lock acquired when that student publishes a replacement review.
do $$ declare definition text; original text:='perform 1 from public.profiles where id=action.subject_id for update;'; begin
  select pg_get_functiondef('safety_private.resolve_appeal(uuid,uuid,integer,text,text)'::regprocedure) into definition;
  if position(original in definition)=0 then raise exception 'Appeal profile lock changed; inspect before applying'; end if;
  execute replace(definition,original,'perform 1 from public.profiles where id=action.subject_id for no key update;');
end $$;
commit;
