-- The counselor on several computers: fixes from review (team request 22).
--
-- - A computer takes one request at a time, and only when it holds none: a busy one no longer
--   sits on new questions while another computer is free.
-- - A conversation stays on its computer: the next chat or interview turn waits for the counselor
--   that answered the last one (each computer's Claude Code remembers only its own), while that
--   counselor is on.
-- - A paused counselor keeps the request it's answering (it finishes it); it gives up only what
--   it hasn't started. A freed request's half-written draft is cleared.
-- - A counselor still checking in after an update was run for it is on another computer: the
--   update becomes one more counselor instead of replacing it. One that never said which computer
--   it's on is replaced only once it has gone quiet (the setup on its own computer stops it).
-- - A counselor being removed hands what it holds to another counselor that's on, instead of
--   answering it with the note that it's being removed.

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

  -- This counselor is still running while one made to replace it has started: they're on two
  -- computers, so that one is an extra counselor, not a replacement.
  update public.connector_links n set replaces = null
   where n.replaces = l.id and n.desk_id = l.desk_id and n.counselor_at is not null and n.revoked_at is null;

  -- An update replaces the counselor it was made for when that one is on this computer, or never
  -- said which it's on and has gone quiet. On another computer, it's one more.
  if l.replaces is not null then
    if exists (select 1 from public.connector_links o
                where o.id = l.replaces and o.desk_id = l.desk_id and o.revoked_at is null
                  and ((pm <> '' and o.counselor_machine = pm)
                       or (o.counselor_machine = ''
                           and coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') < now() - interval '45 seconds'))) then
      update public.connector_links set revoked_at = now() where id = l.replaces;
      update public.connector_links set replaces = null where id = l.id;
    elsif not exists (select 1 from public.connector_links o
                       where o.id = l.replaces and o.revoked_at is null and (o.counselor_machine = '' or o.counselor_machine = pm)) then
      -- Gone already, or on another computer.
      update public.connector_links set replaces = null where id = l.id;
    end if;
  end if;

  -- Any other counselor on this computer is this one's older self (the setup stopped it).
  if pm <> '' then
    update public.connector_links o set revoked_at = now()
     where o.desk_id = l.desk_id and o.id <> l.id and o.revoked_at is null and o.counselor_machine = pm;
  end if;

  -- What a quiet counselor holds goes back for another to take. Answering streams drafts, which
  -- count as being seen, so a long answer isn't taken away; a paused one keeps what it's answering.
  update public.desk_requests r set counselor_at = null, counselor_link = null, answer = ''
   where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link is not null and r.counselor_link <> l.id
     and exists (
       select 1 from public.connector_links o
        where o.id = r.counselor_link
          and (o.revoked_at is not null or o.counselor_remove
               or (o.counselor_paused and r.id::text is distinct from o.activity ->> 'request')
               or coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') < now() - interval '2 minutes'));

  -- One at a time, and only with nothing in hand: the oldest request free to take.
  if not l.counselor_paused and not l.counselor_remove
     and not exists (select 1 from public.desk_requests m where m.desk_id = l.desk_id and m.status = 'pending' and m.counselor_link = l.id) then
    with pick as (
      select r.id from public.desk_requests r
       where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_at is null
         -- The next turn of a conversation waits for the counselor that had the last one, while it's on.
         and not (r.piece_id is null and r.kind in ('chat', 'interview') and exists (
           select 1
             from (select p.counselor_link from public.desk_requests p
                    where p.desk_id = l.desk_id and p.piece_id is null and p.kind in ('chat', 'interview')
                      and p.counselor_link is not null and p.id <> r.id and p.created_at <= r.created_at
                    order by p.created_at desc limit 1) last
             join public.connector_links o on o.id = last.counselor_link
            where o.id <> l.id and o.revoked_at is null and not o.counselor_paused and not o.counselor_remove
              and coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') > now() - interval '2 minutes'))
       order by r.created_at
       limit 1
       for update skip locked
    ), taken as (
      update public.desk_requests set counselor_at = now(), counselor_link = l.id
       where id in (select id from pick)
      returning 1
    )
    select count(*) into fresh from taken;
  end if;

  -- Waiting: for this counselor, or for any to take. Pending: only its own (the watcher drops
  -- anything else from its queue, and stops one it was answering that went to another).
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

-- Another counselor on this desk that's on and can take work.
create or replace function public.counselor_other_on(l public.connector_links)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.connector_links o
     where o.desk_id = l.desk_id and o.id <> l.id and o.revoked_at is null and not o.counselor_paused and not o.counselor_remove
       and coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') > now() - interval '2 minutes');
$$;
revoke all on function public.counselor_other_on(public.connector_links) from public, anon, authenticated;

create or replace function public.connector_draft_answer(token text, request uuid, draft text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  if l.counselor_remove and public.counselor_other_on(l) then return; end if;
  update public.desk_requests set answer = left(coalesce(draft, ''), 20000)
   where id = request and desk_id = l.desk_id and status = 'pending' and (counselor_link is null or counselor_link = l.id);
end;
$$;

create or replace function public.connector_finish_request(token text, request uuid, answer_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  -- Being removed while another counselor is on: that one answers it instead.
  if l.counselor_remove and public.counselor_other_on(l) then
    update public.desk_requests set counselor_at = null, counselor_link = null, answer = ''
     where id = request and desk_id = l.desk_id and status = 'pending' and counselor_link = l.id;
    return false;
  end if;
  update public.desk_requests
     set status = 'answered', answer = left(coalesce(answer_text, ''), 20000), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id and status = 'pending' and (counselor_link is null or counselor_link = l.id);
  return found;
end;
$$;

-- The counselor has removed itself: its link is done, and what it held is free for another.
create or replace function public.connector_counselor_removed(token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests set counselor_at = null, counselor_link = null, answer = ''
   where desk_id = l.desk_id and status = 'pending' and counselor_link = l.id;
  update public.connector_links set revoked_at = now() where id = l.id;
end;
$$;
