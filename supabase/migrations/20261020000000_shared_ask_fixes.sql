-- The shared Ask chat: fixes from review.
--
-- - A question from someone the desk is shared with goes only to a counselor that answers it on
--   its own (version 5 on): a separate Claude run with no tools, no memory and none of the
--   student's profile, just the essay they can already read. Chats watching the desk (Claude or
--   ChatGPT, with the desk's tools) never see these questions.
-- - The hourly limits hold under many questions at once, and per desk as well as per person (a
--   guest can rejoin as someone new, or delete their account and rejoin).
-- - What the student asked before the chat was shared stays theirs.
-- - Who asked is only ever set by ask_on_shared_desk: nobody can post a question as someone else.
-- - Restoring a piece from the Trash still works (its saved requests predate these columns).

-- The student's answers from before now were written for them alone (a guest's own stay shared).
alter table public.desk_requests add column if not exists shared boolean not null default true;
update public.desk_requests set shared = false where asked_by = '';

drop policy if exists "shared read the essay chat" on public.desk_requests;
create policy "shared read the essay chat" on public.desk_requests
  for select using (piece_id is not null and kind in ('ask', 'polish') and shared and status <> 'dismissed'
                    and public.can_read_desk(desk_id));

-- By name, not account: a guest's questions still count after they delete their account.
drop index if exists public.desk_requests_guest_asks;
create index desk_requests_guest_asks on public.desk_requests (desk_id, created_at) where asked_by <> '';

-- Who asked, and when, are set by ask_on_shared_desk (and kept by a restore), never by a direct
-- write: the student can't post as someone they share with (or use up that person's hourly
-- questions), and can't reword or re-date a question someone else asked. Functions that write
-- requests run as their owner, so this only touches writes made straight through the API.
create or replace function public.desk_requests_guard_asker()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.asked_by := '';
      new.asked_by_user := null;
    else
      new.asked_by := old.asked_by;
      new.asked_by_user := old.asked_by_user;
      new.created_at := old.created_at;
      if old.asked_by <> '' then new.prompt := old.prompt; end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists desk_requests_guard_asker on public.desk_requests;
create trigger desk_requests_guard_asker before insert or update on public.desk_requests
  for each row execute function public.desk_requests_guard_asker();

-- A Trash snapshot from before these columns restores as it was: the student's own, not shared.
create or replace function public.desk_requests_restore_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.asked_by := coalesce(new.asked_by, '');
  new.shared := coalesce(new.shared, false);
  if new.asked_by_user is not null and not exists (select 1 from auth.users u where u.id = new.asked_by_user) then
    new.asked_by_user := null;
  end if;
  return new;
end;
$$;
revoke all on function public.desk_requests_restore_fill() from public, anon, authenticated;
drop trigger if exists desk_requests_restore_fill on public.desk_requests;
create trigger desk_requests_restore_fill before insert on public.desk_requests
  for each row execute function public.desk_requests_restore_fill();

-- A counselor that answers a guest's question on its own: version 5 on.
create or replace function public.counselor_answers_guests(v text)
returns boolean language sql immutable as $$
  select case when split_part(coalesce(v, ''), '-', 1) ~ '^[0-9]{1,6}$' then split_part(coalesce(v, ''), '-', 1)::int >= 5 else false end;
$$;

-- Whether a counselor that can answer people it's shared with is on right now.
create or replace function public.desk_counselor_on(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_desk(d) and exists (
    select 1 from public.connector_links o
     where o.desk_id = d and o.revoked_at is null and o.counselor_at is not null
       and not o.counselor_paused and not o.counselor_remove and public.counselor_answers_guests(o.counselor_version)
       and coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') > now() - interval '2 minutes');
$$;

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
  -- One at a time per desk, so questions sent together are counted together.
  perform pg_advisory_xact_lock(hashtext('ask_on_shared_desk'), hashtext(d::text));
  if (select count(*) from public.desk_requests where asked_by_user = me and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'That''s 20 questions this hour. Try again a little later.';
  end if;
  if (select count(*) from public.desk_requests where desk_id = d and asked_by <> '' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'This desk has had 60 questions from the people it''s shared with this hour. Try again a little later.';
  end if;
  select display_name into who from public.desk_members where desk_id = d and user_id = me;
  insert into public.desk_requests (desk_id, piece_id, kind, prompt, asked_by, asked_by_user, shared)
  values (d, piece, 'ask', left(trim(question), 4000), left(coalesce(nullif(trim(who), ''), 'Someone'), 80), me, true)
  returning * into made;
  return to_jsonb(made);
end;
$$;

-- Chats watching the desk never get a guest's question: only a counselor that answers it on its own.
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
    where r.desk_id = l.desk_id and r.status = 'pending' and r.asked_by = ''), '[]'::jsonb);
end;
$$;

-- A counselor is given a guest's question only if it answers it on its own (one held by an older
-- one from before this migration goes back, below).
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
    where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link = l.id
      and (r.asked_by = '' or public.counselor_answers_guests(l.counselor_version))), '[]'::jsonb);
end;
$$;

-- The poll (as in 20261018), with guests' questions taken only by a counselor that answers them on its own.
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
  guests boolean := public.counselor_answers_guests(left(coalesce(version, ''), 20));
begin
  update public.connector_links
     set watched_at = now(), counselor_at = now(), counselor_version = v,
         counselor_computer = case when pc <> '' then pc else counselor_computer end,
         counselor_machine = case when pm <> '' then pm else counselor_machine end
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v
          or (pc <> '' and counselor_computer <> pc) or (pm <> '' and counselor_machine <> pm));

  update public.connector_links n set replaces = null
   where n.replaces = l.id and n.desk_id = l.desk_id and n.counselor_at is not null and n.revoked_at is null;

  -- A guest's question held by a counselor that would answer it in its own conversation (one from
  -- before version 5, or one that took it before this migration) goes back for one that won't.
  update public.desk_requests r set counselor_at = null, counselor_link = null, answer = ''
   where r.desk_id = l.desk_id and r.status = 'pending' and r.asked_by <> '' and r.counselor_link is not null
     and exists (select 1 from public.connector_links o
                  where o.id = r.counselor_link and not public.counselor_answers_guests(o.counselor_version));

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
      update public.connector_links set replaces = null where id = l.id;
    end if;
  end if;

  if pm <> '' then
    update public.connector_links o set revoked_at = now()
     where o.desk_id = l.desk_id and o.id <> l.id and o.revoked_at is null and o.counselor_machine = pm;
  end if;

  update public.desk_requests r set counselor_at = null, counselor_link = null, answer = ''
   where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link is not null and r.counselor_link <> l.id
     and exists (
       select 1 from public.connector_links o
        where o.id = r.counselor_link
          and (o.revoked_at is not null or o.counselor_remove
               or (o.counselor_paused and r.id::text is distinct from o.activity ->> 'request')
               or coalesce(greatest(o.counselor_at, o.last_used_at, o.activity_at), '-infinity') < now() - interval '2 minutes'));

  if not l.counselor_paused and not l.counselor_remove
     and not exists (select 1 from public.desk_requests m where m.desk_id = l.desk_id and m.status = 'pending' and m.counselor_link = l.id) then
    with pick as (
      select r.id from public.desk_requests r
       where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_at is null
         and (guests or r.asked_by = '')
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

  select count(*) into waiting
    from public.desk_requests r
   where r.desk_id = l.desk_id and r.status = 'pending'
     and (r.counselor_link = l.id or (r.counselor_link is null and (guests or r.asked_by = '')));
  select coalesce(jsonb_agg(r.id), '[]'::jsonb) into pending_ids
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending' and r.counselor_link = l.id;
  return jsonb_build_object(
    'fresh', fresh, 'waiting', waiting, 'paused', l.counselor_paused, 'remove', l.counselor_remove, 'pending', pending_ids,
    'model', l.counselor_model, 'effort', l.counselor_effort,
    'speed', case when l.counselor_model in ('opus','fable') then 'thorough' when l.counselor_effort = 'low' then 'fast' else 'balanced' end);
end;
$$;
