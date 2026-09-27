-- The counselor on as many computers as the student likes (team request 22).
--
-- Braxton's call (9/27/26): setting the counselor up on a second computer adds one; it doesn't
-- turn off the first.
-- - Each request is given to one counselor, in the same update that takes it, and each counselor
--   is handed only its own: two computers never answer the same question.
-- - A counselor that goes quiet (asleep or offline for about 2 minutes, paused, or being removed)
--   lets go of what it hasn't answered, for another to take; an answer it sends after that isn't
--   kept.
-- - Each counselor says which computer it's on: a name to show, and a machine id (a hash, not the
--   computer's own id) that tells computers apart. An update replaces the counselor it was made
--   for only on that same computer; run on another, it's one more. A new counselor on a computer
--   replaces any other on that computer.

alter table public.connector_links
  add column if not exists counselor_computer text not null default '' check (length(counselor_computer) <= 80),
  add column if not exists counselor_machine text not null default '' check (length(counselor_machine) <= 64);

alter table public.desk_requests
  add column if not exists counselor_link uuid references public.connector_links (id) on delete set null;
create index if not exists desk_requests_counselor_link on public.desk_requests (counselor_link) where status = 'pending';

-- Requests taken before now: taken again, and this time each given to one counselor.
update public.desk_requests set counselor_at = null where status = 'pending' and counselor_link is null and counselor_at is not null;

-- The watcher checks in with its computer; older watchers (without it) still call it as before.
drop function if exists public.connector_counselor_poll(text, text);
create or replace function public.connector_counselor_poll(token text, version text default '', computer text default '', machine text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  pc text := left(trim(coalesce(computer, '')), 80);
  pm text := left(trim(coalesce(machine, '')), 64);
  fresh integer := 0;
  waiting integer;
  pending_ids jsonb;
begin
  update public.connector_links
     set watched_at = now(), counselor_at = now(), counselor_version = v,
         counselor_computer = case when pc <> '' then pc else counselor_computer end,
         counselor_machine = case when pm <> '' then pm else counselor_machine end
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v
          or (pc <> '' and counselor_computer <> pc) or (pm <> '' and counselor_machine <> pm));
  -- An update replaces the counselor it was made for, if that one is on this same computer (or
  -- never said which it's on). Run on another computer, it's one more.
  if l.replaces is not null then
    update public.connector_links o set revoked_at = now()
     where o.id = l.replaces and o.desk_id = l.desk_id and o.revoked_at is null
       and (o.counselor_machine = '' or pm = '' or o.counselor_machine = pm);
    update public.connector_links set replaces = null where id = l.id;
  end if;
  -- Any other counselor on this computer is this one's older self (the setup stopped it).
  if pm <> '' then
    update public.connector_links o set revoked_at = now()
     where o.desk_id = l.desk_id and o.id <> l.id and o.revoked_at is null and o.counselor_machine = pm;
  end if;
  -- What a quiet counselor holds goes back for another to take. Answering streams drafts, which
  -- count as being seen, so a long answer isn't taken away.
  update public.desk_requests r set counselor_at = null, counselor_link = null
   where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link is not null and r.counselor_link <> l.id
     and exists (
       select 1 from public.connector_links o
        where o.id = r.counselor_link
          and (o.revoked_at is not null or o.counselor_paused or o.counselor_remove
               or coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') < now() - interval '2 minutes'));
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now(), counselor_link = l.id
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  -- Waiting: for this counselor, or for any to take. Pending: only its own (the watcher drops
  -- anything else from its queue: withdrawn, or handed to another counselor).
  select count(*) into waiting
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending' and (r.counselor_link = l.id or r.counselor_link is null);
  select coalesce(jsonb_agg(r.id), '[]'::jsonb) into pending_ids
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link = l.id;
  return jsonb_build_object(
    'fresh', fresh, 'waiting', waiting, 'paused', l.counselor_paused, 'remove', l.counselor_remove, 'pending', pending_ids,
    'model', l.counselor_model, 'effort', l.counselor_effort,
    'speed', case when l.counselor_model in ('opus','fable') then 'thorough' when l.counselor_effort = 'low' then 'fast' else 'balanced' end);
end;
$$;
grant execute on function public.connector_counselor_poll(text, text, text, text) to anon, authenticated;

-- The requests given to this counselor, oldest first (connector_requests has every request, for
-- a Claude or ChatGPT chat watching the desk).
create or replace function public.connector_counselor_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at, 'model', r.model) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link = l.id), '[]'::jsonb);
end;
$$;
grant execute on function public.connector_counselor_requests(text) to anon, authenticated;

-- A draft or an answer from a counselor that no longer holds the request isn't kept.
create or replace function public.connector_draft_answer(token text, request uuid, draft text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests set answer = left(coalesce(draft, ''), 20000)
   where id = request and desk_id = l.desk_id and status = 'pending' and (counselor_link is null or counselor_link = l.id);
end;
$$;

create or replace function public.connector_finish_request(token text, request uuid, answer_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests
     set status = 'answered', answer = left(coalesce(answer_text, ''), 20000), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id and status = 'pending' and (counselor_link is null or counselor_link = l.id);
  return found;
end;
$$;
