-- The Ask chat on each essay, shared with the people the student shares the desk with.
--
-- Braxton's call (9/27/26): people the desk is shared with see the Ask chat on its essays, and
-- those who can suggest or edit can ask in it while the student's counselor is on. The student's
-- counselor answers on the student's computer, and everyone sees the same thread. Each question
-- says who asked it. The Counselor page's chat, the profile interview, transcripts and odds stay
-- the student's.

alter table public.desk_requests
  add column if not exists asked_by text not null default '' check (length(asked_by) <= 80),
  add column if not exists asked_by_user uuid references auth.users (id) on delete set null;

drop policy if exists "shared read the essay chat" on public.desk_requests;
create policy "shared read the essay chat" on public.desk_requests
  for select using (piece_id is not null and kind in ('ask', 'polish') and public.can_read_desk(desk_id));

-- Whether the student's counselor is on right now (so a question would be answered).
create or replace function public.desk_counselor_on(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_desk(d) and exists (
    select 1 from public.connector_links o
     where o.desk_id = d and o.revoked_at is null and o.counselor_at is not null
       and not o.counselor_paused and not o.counselor_remove
       and coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') > now() - interval '2 minutes');
$$;
revoke all on function public.desk_counselor_on(uuid) from public, anon;
grant execute on function public.desk_counselor_on(uuid) to authenticated;

-- Someone the desk is shared with (who can suggest or edit) asks about one of its essays, while
-- the counselor is on. At most 20 questions an hour each: the answers use the student's plan.
create or replace function public.ask_on_shared_desk(piece uuid, question text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(piece);
  me uuid := auth.uid();
  who text;
  made public.desk_requests;
begin
  if d is null or me is null or not public.can_suggest_desk(d) then raise exception 'not allowed'; end if;
  if length(trim(coalesce(question, ''))) = 0 then raise exception 'Type a question first.'; end if;
  if not public.desk_counselor_on(d) then
    raise exception 'The student''s counselor isn''t on right now, so nobody would answer. Try again once their computer is on.';
  end if;
  if (select count(*) from public.desk_requests where asked_by_user = me and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'That''s 20 questions this hour. Try again a little later.';
  end if;
  select display_name into who from public.desk_members where desk_id = d and user_id = me;
  insert into public.desk_requests (desk_id, piece_id, kind, prompt, asked_by, asked_by_user)
  values (d, piece, 'ask', left(trim(question), 4000), left(coalesce(nullif(trim(who), ''), 'Someone'), 80), me)
  returning * into made;
  return to_jsonb(made);
end;
$$;
revoke all on function public.ask_on_shared_desk(uuid, text) from public, anon;
grant execute on function public.ask_on_shared_desk(uuid, text) to authenticated;

-- What the counselor (and a chat watching the desk) is handed says who asked.
create or replace function public.connector_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at, 'model', r.model, 'asked_by', r.asked_by) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending'), '[]'::jsonb);
end;
$$;

create or replace function public.connector_counselor_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at, 'model', r.model, 'asked_by', r.asked_by) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link = l.id), '[]'::jsonb);
end;
$$;
