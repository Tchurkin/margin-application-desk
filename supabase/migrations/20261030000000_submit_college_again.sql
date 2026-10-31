-- Submitting a college through the connector, put back.
--
-- A database had colleges.submitted_at but not connector_submit_college (10/31/26: the counselor's
-- update_college {submitted: true} failed with "Could not find the function ... in the schema
-- cache"), so setup.sql took 20261007 as applied and never made the function. This makes it again,
-- the same as 20261007 did, and has the API reload its list of functions.

alter table public.colleges add column if not exists submitted_at timestamptz;

create or replace function public.connector_submit_college(token text, college uuid, submitted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  update public.colleges
     set submitted_at = case when submitted then coalesce(submitted_at, now()) else null end
   where id = college and desk_id = l.desk_id;
  if not found then raise exception 'No college with that id on this desk.'; end if;
  if submitted then
    update public.pieces set status = 'submitted' where college_id = college and status <> 'submitted';
  else
    update public.pieces set status = 'final' where college_id = college and status = 'submitted';
  end if;
end;
$$;
revoke all on function public.connector_submit_college(text, uuid, boolean) from public;
grant execute on function public.connector_submit_college(text, uuid, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
