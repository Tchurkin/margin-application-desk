-- Average App: set up (or bring up to date) the database.
--
-- Paste all of this into the Supabase SQL Editor (Database > SQL Editor > New query) and run it.
-- It works out which migrations your database already has and applies only the missing ones, in
-- order, all or nothing. Running it again is safe: it does nothing when everything is there.
-- At the end it lists every migration your database has.
--
-- A migration that was skipped (a later one is already here) is applied too, unless a later one
-- already here changes some of the same things: applying it then would put back their older
-- versions, so nothing is changed and it says what is in the way.
--
-- Built from supabase/migrations by src/lib/db/setup-sql.ts; don't edit it by hand.

create schema if not exists average_app;
revoke all on schema average_app from public;
create table if not exists average_app.migrations (version text primary key, name text not null, applied_at timestamptz not null default now());

do $setup$
declare
  names text[] := array['20260923000000_init', '20260924000000_sharing', '20260925000000_connectors', '20260926000000_connector_editing', '20260927000000_connector_manage', '20260928000000_strategy_progress_bridge', '20260929000000_watch_desk', '20260930000000_editing_mode', '20261001000000_permissions_counselor_profile', '20261002000000_counselor_page', '20261003000000_counselor_update', '20261004000000_models', '20261005000000_recommenders', '20261006000000_transcript', '20261007000000_submitted', '20261008000000_trash', '20261009000000_sign_in', '20261010000000_share_password', '20261011000000_password_drop_waits_for_codes', '20261012000000_average_app_name', '20261013000000_share_by_name', '20261014000000_share_join_limits', '20261015000000_profile_files', '20261016000000_desk_presence', '20261017000000_counselor_computers', '20261018000000_counselor_computers_fixes', '20261019000000_shared_ask', '20261020000000_shared_ask_fixes', '20261021000000_shared_notes', '20261022000000_comments'];
  marked text[];
  cli text[] := '{}';
  have boolean[];
  -- For each migration, the later ones that change some of the same things, and what.
  clash jsonb := '{"1":{"2":"function can_read_desk, function can_write_desk, function handle_new_user and 1 more","8":"policy \"add updates\" on piece_updates","9":"policy \"add updates\" on piece_updates","17":"function handle_new_user"},"2":{"3":"function check_suggestion_update","8":"function check_suggestion_update","9":"function can_suggest_desk, function create_share_link","17":"function handle_new_user","18":"function join_desk, function link_info","24":"function can_use_piece_topic","29":"function can_suggest_desk"},"3":{"4":"function connector_add_suggestions","5":"function connector_add_suggestions, function connector_desk","8":"function check_suggestion_update","9":"function connector_add_suggestions, function connector_desk","15":"function connector_desk","20":"function connector_link"},"4":{"5":"function connector_add_suggestions","9":"function connector_add_suggestions, function connector_create_piece, function connector_write"},"5":{"9":"function connector_add_suggestions, function connector_delete_college, function connector_delete_piece and 4 more","15":"function connector_desk","16":"function connector_delete_college, function connector_delete_piece"},"6":{"12":"function connector_requests","14":"function connector_strategy, function connector_update_academics","27":"function connector_requests","28":"function connector_requests"},"8":{"9":"function can_edit_text, policy \"add updates\" on piece_updates","29":"function can_edit_text"},"9":{"10":"constraint desk_requests_kind_check, function connector_counselor_poll","11":"function connector_counselor_poll","12":"function connector_counselor_poll","14":"constraint desk_requests_kind_check, function connector_profile","15":"function connector_desk","16":"function connector_delete_college, function connector_delete_piece","20":"function connector_allow","25":"function connector_counselor_poll","26":"function connector_counselor_poll","28":"function connector_counselor_poll","29":"function can_edit_text, function can_suggest_desk"},"10":{"11":"column connector_links.counselor_remove, function connector_counselor_poll, function connector_counselor_removed","12":"function connector_counselor_poll","14":"constraint desk_requests_kind_check","25":"function connector_counselor_poll, function connector_draft_answer, function connector_finish_request","26":"function connector_counselor_poll, function connector_counselor_removed, function connector_draft_answer and 1 more","28":"function connector_counselor_poll"},"11":{"12":"function connector_counselor_poll","25":"function connector_counselor_poll","26":"function connector_counselor_poll, function connector_counselor_removed","28":"function connector_counselor_poll"},"12":{"25":"function connector_counselor_poll","26":"function connector_counselor_poll","27":"function connector_requests","28":"function connector_counselor_poll, function connector_requests"},"17":{"19":"trigger forget_unconfirmed_password"},"21":{"22":"function join_desk_by_name, function set_desk_sharing"},"25":{"26":"function connector_counselor_poll, function connector_draft_answer, function connector_finish_request","27":"function connector_counselor_requests","28":"function connector_counselor_poll, function connector_counselor_requests"},"26":{"28":"function connector_counselor_poll"},"27":{"28":"function ask_on_shared_desk, function connector_counselor_requests, function connector_requests and 2 more"}}';
  late boolean[] := '{}';
  blocked text;
  applied int := 0;
begin
  select coalesce(array_agg(version), '{}') into marked from average_app.migrations;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(array_agg(version::text), ''{}'') from supabase_migrations.schema_migrations' into cli;
  end if;
  have := array[
    ('20260923000000' = any(marked)) or ('20260923000000' = any(cli)) or (to_regclass('public.desks') is not null),
    ('20260924000000' = any(marked)) or ('20260924000000' = any(cli)) or (to_regclass('public.share_links') is not null),
    ('20260925000000' = any(marked)) or ('20260925000000' = any(cli)) or (to_regclass('public.connector_links') is not null),
    ('20260926000000' = any(marked)) or ('20260926000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'connector_write')),
    ('20260927000000' = any(marked)) or ('20260927000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'connector_app_system')),
    ('20260928000000' = any(marked)) or ('20260928000000' = any(cli)) or (to_regclass('public.desk_requests') is not null),
    ('20260929000000' = any(marked)) or ('20260929000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'connector_watch')),
    ('20260930000000' = any(marked)) or ('20260930000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_piece_text_stats')),
    ('20261001000000' = any(marked)) or ('20261001000000' = any(cli)) or (to_regclass('public.profile_sections') is not null),
    ('20261002000000' = any(marked)) or ('20261002000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connector_links' and column_name = 'counselor_version')),
    ('20261003000000' = any(marked)) or ('20261003000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connector_links' and column_name = 'replaces')),
    ('20261004000000' = any(marked)) or ('20261004000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'connector_links' and column_name = 'counselor_model')),
    ('20261005000000' = any(marked)) or ('20261005000000' = any(cli)) or (to_regclass('public.recommenders') is not null),
    ('20261006000000' = any(marked)) or ('20261006000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'class_rank')),
    ('20261007000000' = any(marked)) or ('20261007000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'colleges' and column_name = 'submitted_at')),
    ('20261008000000' = any(marked)) or ('20261008000000' = any(cli)) or (to_regclass('public.trash') is not null),
    ('20261009000000' = any(marked)) or ('20261009000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'forget_unconfirmed_password')),
    ('20261010000000' = any(marked)) or ('20261010000000' = any(cli)) or (to_regclass('public.share_passwords') is not null),
    ('20261011000000' = any(marked)) or ('20261011000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'forget_unconfirmed_password') and not exists (select 1 from pg_trigger where tgname = 'forget_unconfirmed_password' and tgrelid = to_regclass('auth.users'))),
    ('20261012000000' = any(marked)) or ('20261012000000' = any(cli)) or (coalesce(position('Average App' in pg_get_functiondef(to_regprocedure('public.connector_link(text)'))) > 0, false)),
    ('20261013000000' = any(marked)) or ('20261013000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'share_passwords' and column_name = 'share_name')),
    ('20261014000000' = any(marked)) or ('20261014000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'desk_share_guesses')),
    ('20261015000000' = any(marked)) or ('20261015000000' = any(cli)) or (to_regclass('public.profile_files') is not null),
    ('20261016000000' = any(marked)) or ('20261016000000' = any(cli)) or (coalesce(position('desk:' in pg_get_functiondef(to_regprocedure('public.can_use_piece_topic(text)'))) > 0, false)),
    ('20261017000000' = any(marked)) or ('20261017000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'desk_requests' and column_name = 'counselor_link')),
    ('20261018000000' = any(marked)) or ('20261018000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'counselor_other_on')),
    ('20261019000000' = any(marked)) or ('20261019000000' = any(cli)) or (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'desk_requests' and column_name = 'asked_by')),
    ('20261020000000' = any(marked)) or ('20261020000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'counselor_answers_guests')),
    ('20261021000000' = any(marked)) or ('20261021000000' = any(cli)) or (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_piece_notes')),
    ('20261022000000' = any(marked)) or ('20261022000000' = any(cli)) or (coalesce(position('comment' in pg_get_constraintdef((select c.oid from pg_constraint c where c.conname = 'suggestions_kind_check' and c.conrelid = to_regclass('public.suggestions')))) > 0, false))
  ];

  for i in 1 .. array_length(names, 1) loop
    late[i] := false;
    if not have[i] then
      for j in i + 1 .. array_length(names, 1) loop
        if have[j] then
          late[i] := true;
          if clash -> i::text ? j::text then
            blocked := coalesce(blocked || '; ', '') || format('%s is missing, and %s, already here, changes the same things (%s)',
              names[i], names[j], clash -> i::text ->> j::text);
          end if;
        end if;
      end loop;
    end if;
  end loop;
  if blocked is not null then
    raise exception 'Nothing was changed: %. Applying the missing one now would undo part of the later one, so get help first.', blocked;
  end if;

  -- Remember what is already here, so a later run needn't work it out again.
  for i in 1 .. array_length(names, 1) loop
    if have[i] then
      insert into average_app.migrations (version, name) values (left(names[i], 14), names[i]) on conflict (version) do nothing;
    end if;
  end loop;

  if not have[1] then
    execute $m20260923000000$
-- Application Desk: milestone 1 schema (one student, working alone).
--
-- Every table has row-level security. Access runs through two helpers,
-- can_read_desk() and can_write_desk(), so later milestones (parents, share links)
-- widen access in one place.

create extension if not exists pgcrypto;

-- ─── profiles and desks ──────────────────────────────────────────────────────

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  -- Free-text profile the student writes about themself (used later as AI context).
  about         text not null default '',
  last_piece_id uuid,
  created_at    timestamptz not null default now()
);

create table public.desks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null unique references auth.users (id) on delete cascade,
  title      text not null default 'My application desk',
  created_at timestamptz not null default now()
);

create or replace function public.can_read_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

create or replace function public.can_write_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

-- A new account gets a profile and a desk.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── colleges ────────────────────────────────────────────────────────────────

create table public.colleges (
  id                 uuid primary key default gen_random_uuid(),
  desk_id            uuid not null references public.desks (id) on delete cascade,
  name               text not null check (length(name) between 1 and 200),
  app_system         text not null default 'common_app' check (app_system in
                       ('common_app','coalition','uc','applytexas','ucas','questbridge','own_portal','other')),
  round              text not null default 'RD' check (round in
                       ('ED','ED2','EA','REA','RD','rolling','priority')),
  deadline           date,
  materials_deadline date,
  -- 'no_drafting': the AI counselor may ask questions and check facts but writes no sentences.
  ai_policy          text not null default 'allowed' check (ai_policy in ('allowed','no_drafting')),
  needs_letters      boolean not null default true,
  research           text not null default '',
  created_at         timestamptz not null default now()
);
create index colleges_desk_idx on public.colleges (desk_id);

-- ─── pieces of writing ───────────────────────────────────────────────────────

create table public.pieces (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null references public.desks (id) on delete cascade,
  -- null = not tied to one college (e.g. the Common App personal essay)
  college_id  uuid references public.colleges (id) on delete cascade,
  title       text not null default 'Untitled' check (length(title) <= 300),
  prompt      text not null default '',
  limit_kind  text not null default 'words' check (limit_kind in ('words','chars','none')),
  limit_value integer check (limit_value is null or limit_value > 0),
  status      text not null default 'not_started' check (status in
                ('not_started','drafting','needs_review','final','submitted')),
  -- Notes live outside the essay text and are never counted.
  notes       text not null default '',
  -- Compacted Yjs state (base64). Recent edits live in piece_updates until compacted.
  doc_state   text not null default '',
  -- Derived from the document for the board and search; the Yjs state is the truth.
  plain_text  text not null default '',
  word_count  integer not null default 0,
  char_count  integer not null default 0,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pieces_desk_idx on public.pieces (desk_id);
create index pieces_college_idx on public.pieces (college_id);

-- A piece's college must belong to the same desk.
create or replace function public.check_piece_college()
returns trigger language plpgsql as $$
begin
  if new.college_id is not null and not exists (
    select 1 from public.colleges c where c.id = new.college_id and c.desk_id = new.desk_id
  ) then
    raise exception 'college % is not on desk %', new.college_id, new.desk_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger pieces_check_college
  before insert or update on public.pieces
  for each row execute function public.check_piece_college();

create or replace function public.piece_desk(p uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select desk_id from public.pieces where id = p;
$$;

-- Append-only Yjs updates. Each screen inserts only its own edits; any order of arrival,
-- duplicates included, merges to the same document. Inserting against a deleted piece
-- fails on the foreign key, so a late writer can never recreate a deleted piece.
create table public.piece_updates (
  id         bigint generated always as identity primary key,
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  client_id  text not null,
  "update"   text not null,
  created_at timestamptz not null default now()
);
create index piece_updates_piece_idx on public.piece_updates (piece_id, id);

-- Saved versions, thinned by age on the client (see src/lib/domain/history.ts).
create table public.piece_versions (
  id         uuid primary key default gen_random_uuid(),
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  at         timestamptz not null default now(),
  author     text not null default '',
  content    jsonb not null,
  plain_text text not null default '',
  words      integer not null default 0,
  size       integer not null default 0
);
create index piece_versions_piece_idx on public.piece_versions (piece_id, at);

-- Fold settled updates into pieces.doc_state. The caller merged doc_state with every
-- update up to through_id; only updates older than the cutoff are deleted, so an update
-- that committed late (lower id, later commit) is never dropped unmerged.
create or replace function public.compact_piece(p uuid, state text, through_id bigint, cutoff timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write_desk(public.piece_desk(p)) then
    raise exception 'not allowed';
  end if;
  update public.pieces set doc_state = state where id = p;
  delete from public.piece_updates
    where piece_id = p and id <= through_id and created_at < cutoff;
end;
$$;

-- ─── delete my data ──────────────────────────────────────────────────────────

-- Deletes the caller's account; every table above cascades from auth.users.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ─── row-level security ──────────────────────────────────────────────────────

alter table public.profiles       enable row level security;
alter table public.desks          enable row level security;
alter table public.colleges       enable row level security;
alter table public.pieces         enable row level security;
alter table public.piece_updates  enable row level security;
alter table public.piece_versions enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "read desk" on public.desks
  for select using (public.can_read_desk(id));
create policy "rename desk" on public.desks
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "read colleges" on public.colleges
  for select using (public.can_read_desk(desk_id));
create policy "write colleges" on public.colleges
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

create policy "read pieces" on public.pieces
  for select using (public.can_read_desk(desk_id));
create policy "write pieces" on public.pieces
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

create policy "read updates" on public.piece_updates
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "add updates" on public.piece_updates
  for insert with check (public.can_write_desk(public.piece_desk(piece_id)));

create policy "read versions" on public.piece_versions
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "write versions" on public.piece_versions
  for all using (public.can_write_desk(public.piece_desk(piece_id)))
  with check (public.can_write_desk(public.piece_desk(piece_id)));

revoke all on function public.compact_piece(uuid, text, bigint, timestamptz) from public, anon;
grant execute on function public.compact_piece(uuid, text, bigint, timestamptz) to authenticated;
$m20260923000000$;
    insert into average_app.migrations (version, name) values ('20260923000000', '20260923000000_init');
    applied := applied + 1;
    raise notice 'Applied %', '20260923000000_init' || case when late[1] then ' (it had been skipped)' else '' end;
  end if;

  if not have[2] then
    execute $m20260924000000$
-- Application Desk: milestone 2 (parents).
--
-- A student shares their desk through links. Someone who opens a link signs in anonymously,
-- enters a name, and becomes a member with the link's role: 'view' reads, 'suggest' also
-- proposes edits. Revoking a link ends every membership made through it at once.
--
-- Suggestions live in their own table. Members can never write a piece's text (piece_updates
-- stays owner-only), so the student's words change only when the student accepts something.

-- ─── share links and members ─────────────────────────────────────────────────

create table public.share_links (
  id              uuid primary key default gen_random_uuid(),
  desk_id         uuid not null references public.desks (id) on delete cascade,
  -- sha256 of the token in the URL; the token itself is shown once and never stored.
  token_hash      text not null unique,
  role            text not null check (role in ('view','suggest')),
  label           text not null default '' check (length(label) <= 80),
  -- bcrypt, or null for no password.
  password_hash   text,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index share_links_desk_idx on public.share_links (desk_id);

create table public.desk_members (
  desk_id      uuid not null references public.desks (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  link_id      uuid not null references public.share_links (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  joined_at    timestamptz not null default now(),
  primary key (desk_id, user_id)
);

-- The caller's role on a desk through a live link: 'view', 'suggest', or null.
create or replace function public.member_role(d uuid)
returns text language sql stable security definer set search_path = public as $$
  select l.role
    from public.desk_members m
    join public.share_links l on l.id = m.link_id
   where m.desk_id = d and m.user_id = auth.uid() and l.revoked_at is null
   limit 1;
$$;

create or replace function public.is_desk_owner(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

create or replace function public.can_read_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) is not null;
$$;

-- Writing the essay text and the desk itself stays with the owner.
create or replace function public.can_write_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d);
$$;

create or replace function public.can_suggest_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'suggest';
$$;

-- Anonymous visitors (parents on a link) get no desk of their own.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

-- Owner: make a link. Returns the token, which is only ever seen here.
create or replace function public.create_share_link(d uuid, link_role text, link_label text, link_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if link_role not in ('view','suggest') then raise exception 'bad role'; end if;
  token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.share_links (desk_id, token_hash, role, label, password_hash)
  values (
    d,
    encode(digest(token, 'sha256'), 'hex'),
    link_role,
    left(coalesce(link_label, ''), 80),
    case when coalesce(link_password, '') = '' then null else crypt(link_password, gen_salt('bf')) end
  );
  return token;
end;
$$;

-- Anyone holding a token: what it opens, without joining.
create or replace function public.link_info(token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  l public.share_links;
  title text;
begin
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then return jsonb_build_object('valid', false); end if;
  select d.title into title from public.desks d where d.id = l.desk_id;
  return jsonb_build_object(
    'valid', true,
    'role', l.role,
    'needs_password', l.password_hash is not null,
    'desk_title', title
  );
end;
$$;

-- A signed-in (often anonymous) visitor joins through a link. Returns {ok, desk_id} or
-- {ok:false, error}. Errors are returned, not raised, so failed attempts are counted.
create or replace function public.join_desk(token text, link_password text, name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.share_links;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong passwords. Try again in a few minutes.');
  end if;
  if l.password_hash is not null
     and (link_password is null or crypt(link_password, l.password_hash) <> l.password_hash) then
    update public.share_links
       set failed_attempts = case when failed_attempts + 1 >= 10 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' else locked_until end
     where id = l.id;
    return jsonb_build_object('ok', false, 'error', 'Wrong password.');
  end if;
  if public.is_desk_owner(l.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', l.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  update public.share_links set failed_attempts = 0 where id = l.id;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (l.desk_id, auth.uid(), l.id, left(trim(name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', l.desk_id);
end;
$$;

-- The desks the caller can open as a member, for the home page.
create or replace function public.my_shared_desks()
returns table (desk_id uuid, title text, role text)
language sql stable security definer set search_path = public as $$
  select d.id, d.title, l.role
    from public.desk_members m
    join public.share_links l on l.id = m.link_id and l.revoked_at is null
    join public.desks d on d.id = m.desk_id
   where m.user_id = auth.uid()
   order by m.joined_at desc;
$$;

alter table public.share_links  enable row level security;
alter table public.desk_members enable row level security;

create policy "owner reads links" on public.share_links
  for select using (public.is_desk_owner(desk_id));
create policy "owner revokes links" on public.share_links
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
create policy "owner deletes links" on public.share_links
  for delete using (public.is_desk_owner(desk_id));

create policy "owner and self read members" on public.desk_members
  for select using (public.is_desk_owner(desk_id) or user_id = auth.uid());
create policy "owner removes members" on public.desk_members
  for delete using (public.is_desk_owner(desk_id));

-- Members can read the desk's title.
drop policy if exists "read desk" on public.desks;
create policy "read desk" on public.desks
  for select using (public.can_read_desk(id));

revoke all on function public.create_share_link(uuid, text, text, text) from public, anon;
grant execute on function public.create_share_link(uuid, text, text, text) to authenticated;
revoke all on function public.join_desk(text, text, text) from public, anon;
grant execute on function public.join_desk(text, text, text) to authenticated;
grant execute on function public.link_info(text) to anon, authenticated;
revoke all on function public.my_shared_desks() from public, anon;
grant execute on function public.my_shared_desks() to authenticated;

-- ─── suggestions ─────────────────────────────────────────────────────────────

create table public.suggestions (
  -- Chosen by the client so a suggestion can be drawn before the server has it.
  id          uuid primary key,
  piece_id    uuid not null references public.pieces (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default '' check (length(author_name) <= 80),
  -- 'ai' suggestions stay flagged (provenance) until the student rewrites them.
  source      text not null default 'person' check (source in ('person','ai')),
  kind        text not null check (kind in ('insert','delete','replace')),
  -- Yjs relative positions (base64). Insert: anchor_from only. Delete/replace: the range.
  anchor_from text not null,
  anchor_to   text,
  -- The text being deleted, as it read when suggested (to spot later edits).
  quote       text not null default '',
  -- The text being inserted.
  body        text not null default '',
  status      text not null default 'open' check (status in ('open','accepted','declined')),
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index suggestions_piece_idx on public.suggestions (piece_id, status);

-- Owners only resolve; authors only edit their own open suggestions.
create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) and old.author_id <> auth.uid() then
    if new.kind <> old.kind or new.anchor_from <> old.anchor_from
       or new.anchor_to is distinct from old.anchor_to
       or new.quote <> old.quote or new.body <> old.body then
      raise exception 'the student accepts or declines, and does not edit, a suggestion';
    end if;
    new.resolved_at := case when new.status = 'open' then null else now() end;
    new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
  elsif old.author_id = auth.uid() then
    if old.status <> 'open' or new.status <> 'open' then
      raise exception 'only the student resolves a suggestion';
    end if;
  else
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger suggestions_check_update
  before update on public.suggestions
  for each row execute function public.check_suggestion_update();

alter table public.suggestions enable row level security;

create policy "read suggestions" on public.suggestions
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "make suggestions" on public.suggestions
  for insert with check (
    author_id = auth.uid() and status = 'open'
    and public.can_suggest_desk(public.piece_desk(piece_id))
  );
create policy "edit or resolve suggestions" on public.suggestions
  for update using (
    (author_id = auth.uid() and public.can_suggest_desk(public.piece_desk(piece_id)))
    or public.is_desk_owner(public.piece_desk(piece_id))
  );
create policy "withdraw own suggestions" on public.suggestions
  for delete using (author_id = auth.uid() and status = 'open');

-- ─── realtime ────────────────────────────────────────────────────────────────

-- Row changes stream to subscribers, filtered by the policies above.
alter publication supabase_realtime add table public.piece_updates, public.suggestions;

-- Live cursors travel on a private channel per piece ("piece:<uuid>") that only people
-- who can read the piece may join.
create or replace function public.can_use_piece_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic !~ '^piece:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_read_desk(public.piece_desk(substring(topic from 7)::uuid));
end;
$$;

create policy "piece channel: listen" on realtime.messages
  for select to authenticated using (public.can_use_piece_topic(realtime.topic()));
create policy "piece channel: send" on realtime.messages
  for insert to authenticated with check (public.can_use_piece_topic(realtime.topic()));
$m20260924000000$;
    insert into average_app.migrations (version, name) values ('20260924000000', '20260924000000_sharing');
    applied := applied + 1;
    raise notice 'Applied %', '20260924000000_sharing' || case when late[2] then ' (it had been skipped)' else '' end;
  end if;

  if not have[3] then
    execute $m20260925000000$
-- Application Desk: milestone 3 (Claude and ChatGPT as counselors).
--
-- A student connects Claude or ChatGPT to their desk with a secret connector link (an MCP
-- server URL). The assistant can read the desk and propose edits, which arrive as suggestions
-- the student accepts or declines. It runs on the student's own Claude or ChatGPT plan.
--
-- The connector talks to the database only through the functions below, keyed by the link's
-- token. It never holds a service key, and it can never write a piece's text.

-- Why a suggestion was made (shown under it). AI suggestions always carry one.
alter table public.suggestions add column note text not null default '' check (length(note) <= 1000);

-- ─── connector links ─────────────────────────────────────────────────────────

create table public.connector_links (
  id           uuid primary key default gen_random_uuid(),
  desk_id      uuid not null references public.desks (id) on delete cascade,
  -- sha256 of the token in the URL; the token is shown once and never stored.
  token_hash   text not null unique,
  -- Who the suggestions are credited to, e.g. 'Claude' or 'ChatGPT'.
  label        text not null default 'Claude' check (length(label) between 1 and 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index connector_links_desk_idx on public.connector_links (desk_id);

alter table public.connector_links enable row level security;
create policy "owner reads connector links" on public.connector_links
  for select using (public.is_desk_owner(desk_id));
create policy "owner revokes connector links" on public.connector_links
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));

create or replace function public.create_connector_link(d uuid, link_label text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.connector_links (desk_id, token_hash, label)
  values (d, encode(digest(token, 'sha256'), 'hex'), coalesce(nullif(left(trim(link_label), 40), ''), 'Claude'));
  return token;
end;
$$;
revoke all on function public.create_connector_link(uuid, text) from public, anon;
grant execute on function public.create_connector_link(uuid, text) to authenticated;

-- The live link for a token, or nothing.
create or replace function public.connector_link(token text)
returns public.connector_links language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.connector_links;
begin
  select * into l from public.connector_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'This connector link is not valid. Make a new one in Application Desk → Settings.'; end if;
  update public.connector_links set last_used_at = now()
   where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return l;
end;
$$;
revoke all on function public.connector_link(text) from public, anon, authenticated;

-- ─── what the connector may read ─────────────────────────────────────────────

create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'app_system', c.app_system, 'round', c.round,
        'deadline', c.deadline, 'materials_deadline', c.materials_deadline,
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value) order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.connector_piece(token text, piece uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  return jsonb_build_object(
    'id', p.id, 'title', p.title, 'prompt', p.prompt, 'status', p.status, 'notes', p.notes,
    'limit_kind', p.limit_kind, 'limit_value', p.limit_value,
    'doc_state', p.doc_state,
    'updates', coalesce((select jsonb_agg(u."update" order by u.id) from public.piece_updates u where u.piece_id = p.id), '[]'::jsonb),
    'college', (select jsonb_build_object('id', c.id, 'name', c.name, 'ai_policy', c.ai_policy,
                                          'deadline', c.deadline, 'research', c.research)
                  from public.colleges c where c.id = p.college_id),
    'other_pieces', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'prompt', o.prompt,
                                          'text', o.plain_text, 'status', o.status) order by o.sort, o.created_at)
      from public.pieces o
      where o.desk_id = l.desk_id and o.id <> p.id
        and o.college_id is not distinct from p.college_id), '[]'::jsonb),
    'open_suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('author', s.author_name, 'source', s.source, 'kind', s.kind,
                                          'quote', s.quote, 'body', s.body, 'note', s.note) order by s.created_at)
      from public.suggestions s where s.piece_id = p.id and s.status = 'open'), '[]'::jsonb),
    'student', (select jsonb_build_object('name', pr.display_name, 'about', pr.about)
                  from public.desks d join public.profiles pr on pr.id = d.owner_id where d.id = l.desk_id)
  );
end;
$$;

-- ─── what the connector may write: suggestions, and nothing else ─────────────

-- rows: [{kind, anchor_from, anchor_to, quote, body, note}]. Anchors are computed by the
-- connector server from the piece's own document.
create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  owner uuid;
  policy text;
  r jsonb;
  n integer := 0;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  select c.ai_policy into policy from public.colleges c where c.id = p.college_id;
  if policy = 'no_drafting' then
    raise exception 'This college does not allow AI help with drafting, so edits can''t be suggested here. You can still ask questions and check facts.';
  end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 25 then
    raise exception 'Suggest between 1 and 25 edits at a time.';
  end if;
  select owner_id into owner from public.desks where id = l.desk_id;
  for r in select * from jsonb_array_elements(rows) loop
    if (r ->> 'kind') not in ('insert','delete','replace') then raise exception 'bad kind'; end if;
    if length(coalesce(r ->> 'body', '')) > 1200 then
      raise exception 'Each suggestion can add at most about 200 words. Suggest smaller edits.';
    end if;
    insert into public.suggestions
      (id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note)
    values (
      gen_random_uuid(), p.id, owner, l.label, 'ai', r ->> 'kind',
      r ->> 'anchor_from', nullif(r ->> 'anchor_to', ''),
      coalesce(r ->> 'quote', ''), coalesce(r ->> 'body', ''), left(coalesce(r ->> 'note', ''), 1000)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.connector_desk(text) to anon, authenticated;
grant execute on function public.connector_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_add_suggestions(text, uuid, jsonb) to anon, authenticated;

-- ─── the student resolves every suggestion, including ones credited to their own account ──

create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) and (old.author_id <> auth.uid() or old.source = 'ai') then
    if new.kind <> old.kind or new.anchor_from <> old.anchor_from
       or new.anchor_to is distinct from old.anchor_to
       or new.quote <> old.quote or new.body <> old.body or new.note <> old.note then
      raise exception 'the student accepts or declines, and does not edit, a suggestion';
    end if;
    new.resolved_at := case when new.status = 'open' then null else now() end;
    new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
  elsif old.author_id = auth.uid() then
    if old.status <> 'open' or new.status <> 'open' then
      raise exception 'only the student resolves a suggestion';
    end if;
  else
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
$m20260925000000$;
    insert into average_app.migrations (version, name) values ('20260925000000', '20260925000000_connectors');
    applied := applied + 1;
    raise notice 'Applied %', '20260925000000_connectors' || case when late[3] then ' (it had been skipped)' else '' end;
  end if;

  if not have[4] then
    execute $m20260926000000$
-- The connector can write, not only suggest.
--
-- Braxton's call (9/24/26): the AI follows the student's instructions. Asked for feedback it
-- suggests; asked to draft or rewrite, it writes the piece directly. No length caps, and a
-- college's "no AI drafting" flag is information passed to the AI, not a block.
--
-- A direct write first saves the piece's current text as a version, so History can always
-- bring the student's words back.

-- ─── suggestions: any length, any college ────────────────────────────────────

create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  owner uuid;
  r jsonb;
  n integer := 0;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 or jsonb_array_length(rows) > 100 then
    raise exception 'Suggest between 1 and 100 edits at a time.';
  end if;
  select owner_id into owner from public.desks where id = l.desk_id;
  for r in select * from jsonb_array_elements(rows) loop
    if (r ->> 'kind') not in ('insert','delete','replace') then raise exception 'bad kind'; end if;
    insert into public.suggestions
      (id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note)
    values (
      gen_random_uuid(), p.id, owner, l.label, 'ai', r ->> 'kind',
      r ->> 'anchor_from', nullif(r ->> 'anchor_to', ''),
      coalesce(r ->> 'quote', ''), coalesce(r ->> 'body', ''), left(coalesce(r ->> 'note', ''), 1000)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ─── direct writes ───────────────────────────────────────────────────────────

-- Append one Yjs update (computed by the connector server from the piece's own document),
-- after saving the text as it was. `before` is the editor JSON and text before the change;
-- `after_text` feeds the board's counts.
create or replace function public.connector_write(
  token text, piece uuid, yjs_update text,
  before_json jsonb, before_text text, after_text text, after_words integer, after_chars integer
)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id for update;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  if coalesce(yjs_update, '') = '' then return; end if;
  if length(trim(coalesce(before_text, ''))) > 0 then
    insert into public.piece_versions (piece_id, author, content, plain_text, words, size)
    values (
      p.id, 'Before ' || l.label || '''s edit', before_json, before_text,
      coalesce(array_length(regexp_split_to_array(trim(before_text), '\s+'), 1), 0),
      length(before_json::text)
    );
  end if;
  insert into public.piece_updates (piece_id, client_id, "update")
  values (p.id, 'connector:' || l.label, yjs_update);
  update public.pieces
     set plain_text = coalesce(after_text, plain_text),
         word_count = coalesce(after_words, word_count),
         char_count = coalesce(after_chars, char_count),
         status = case when status = 'not_started' and length(trim(coalesce(after_text, ''))) > 0 then 'drafting' else status end
   where id = p.id;
end;
$$;

-- Make a new piece (e.g. a supplemental) for one of the desk's colleges, or shared (null).
create or replace function public.connector_create_piece(
  token text, college uuid, piece_title text, piece_prompt text, piece_limit_kind text, piece_limit_value integer
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  new_id uuid;
begin
  if college is not null and not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'No college with that id on this desk.';
  end if;
  insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value)
  values (
    l.desk_id, college,
    coalesce(nullif(left(trim(piece_title), 300), ''), 'Untitled'),
    coalesce(piece_prompt, ''),
    case when piece_limit_kind in ('words','chars','none') then piece_limit_kind else 'words' end,
    case when piece_limit_value > 0 then piece_limit_value else null end
  )
  returning id into new_id;
  return new_id;
end;
$$;

grant execute on function public.connector_write(text, uuid, text, jsonb, text, text, integer, integer) to anon, authenticated;
grant execute on function public.connector_create_piece(text, uuid, text, text, text, integer) to anon, authenticated;
$m20260926000000$;
    insert into average_app.migrations (version, name) values ('20260926000000', '20260926000000_connector_editing');
    applied := applied + 1;
    raise notice 'Applied %', '20260926000000_connector_editing' || case when late[4] then ' (it had been skipped)' else '' end;
  end if;

  if not have[5] then
    execute $m20260927000000$
-- The connector can set up and manage the whole desk.
--
-- A student pastes the list of colleges they're applying to, and Claude or ChatGPT adds each
-- college with its system, round and deadlines, and a piece for every supplemental prompt.
-- It can also change or remove colleges and pieces, and update the student's profile.
-- Everything is keyed by the connector token, like the other connector functions.

-- ─── suggestions keep the text just before an insertion ───────────────────────

-- When paragraphs are joined, split or restructured, the editor re-creates the moved text, and
-- an insertion's anchor can come loose. The words just before it let the editor find the spot
-- again (replacements and deletions already keep their quoted words).
alter table public.suggestions add column if not exists context text not null default '' check (length(context) <= 400);

create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  owner uuid;
  r jsonb;
  n integer := 0;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 or jsonb_array_length(rows) > 100 then
    raise exception 'Suggest between 1 and 100 edits at a time.';
  end if;
  select owner_id into owner from public.desks where id = l.desk_id;
  for r in select * from jsonb_array_elements(rows) loop
    if (r ->> 'kind') not in ('insert','delete','replace') then raise exception 'bad kind'; end if;
    insert into public.suggestions
      (id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note, context, created_at)
    values (
      gen_random_uuid(), p.id, owner, l.label, 'ai', r ->> 'kind',
      r ->> 'anchor_from', nullif(r ->> 'anchor_to', ''),
      coalesce(r ->> 'quote', ''), coalesce(r ->> 'body', ''), left(coalesce(r ->> 'note', ''), 1000),
      right(coalesce(r ->> 'context', ''), 400),
      -- One call's suggestions share now(); a microsecond apart keeps them in the order sent.
      now() + make_interval(secs => n * 0.000001)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- A date from text, or a clear error naming the bad value.
create or replace function public.connector_date(v text)
returns date language plpgsql immutable as $$
begin
  if v is null or trim(v) = '' then return null; end if;
  return v::date;
exception when others then
  raise exception 'Dates must look like 2026-11-01 (got "%").', v;
end;
$$;

create or replace function public.connector_app_system(v text, fallback text)
returns text language sql immutable as $$
  select case when v in ('common_app','coalition','uc','applytexas','ucas','questbridge','own_portal','other') then v else fallback end;
$$;

create or replace function public.connector_round(v text, fallback text)
returns text language sql immutable as $$
  select case when v in ('ED','ED2','EA','REA','RD','rolling','priority') then v else fallback end;
$$;

-- ─── set up colleges (with their pieces), matching existing ones by name ─────

-- colleges: [{name, app_system, round, deadline, materials_deadline, needs_letters,
--             ai_policy, research, pieces: [{title, prompt, limit_kind, limit_value}]}]
-- Returns [{name, college_id, created, pieces: [{title, piece_id, created}]}].
create or replace function public.connector_set_up_colleges(token text, colleges jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  c jsonb;
  p jsonb;
  cid uuid;
  pid uuid;
  made boolean;
  pmade boolean;
  result jsonb := '[]'::jsonb;
  pout jsonb;
  cname text;
  ptitle text;
begin
  if jsonb_typeof(colleges) <> 'array' or jsonb_array_length(colleges) = 0 then
    raise exception 'Send at least one college.';
  end if;
  for c in select * from jsonb_array_elements(colleges) loop
    cname := left(trim(coalesce(c ->> 'name', '')), 200);
    if cname = '' then raise exception 'Every college needs a name.'; end if;
    select id into cid from public.colleges where desk_id = l.desk_id and lower(name) = lower(cname) limit 1;
    made := cid is null;
    if made then
      insert into public.colleges (desk_id, name, app_system, round, deadline, materials_deadline, ai_policy, needs_letters, research)
      values (
        l.desk_id, cname,
        public.connector_app_system(c ->> 'app_system', 'common_app'),
        public.connector_round(c ->> 'round', 'RD'),
        public.connector_date(c ->> 'deadline'),
        public.connector_date(c ->> 'materials_deadline'),
        case when c ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end,
        coalesce((c ->> 'needs_letters')::boolean, true),
        coalesce(c ->> 'research', '')
      )
      returning id into cid;
    end if;
    pout := '[]'::jsonb;
    if jsonb_typeof(c -> 'pieces') = 'array' then
      for p in select * from jsonb_array_elements(c -> 'pieces') loop
        ptitle := coalesce(nullif(left(trim(coalesce(p ->> 'title', '')), 300), ''), 'Untitled');
        select id into pid from public.pieces
         where desk_id = l.desk_id and college_id = cid and lower(title) = lower(ptitle) limit 1;
        pmade := pid is null;
        if pmade then
          insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value)
          values (
            l.desk_id, cid, ptitle, coalesce(p ->> 'prompt', ''),
            case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                 when (p ->> 'limit_value') is not null then 'words' else 'none' end,
            case when (p ->> 'limit_value')::integer > 0 then (p ->> 'limit_value')::integer else null end
          )
          returning id into pid;
        end if;
        pout := pout || jsonb_build_object('title', ptitle, 'piece_id', pid, 'created', pmade);
      end loop;
    end if;
    result := result || jsonb_build_object('name', cname, 'college_id', cid, 'created', made, 'pieces', pout);
  end loop;
  return result;
end;
$$;

-- ─── change or remove colleges and pieces ────────────────────────────────────

-- fields: any of {name, app_system, round, deadline, materials_deadline, needs_letters,
-- ai_policy, research}. Keys left out are unchanged; an empty string clears a date.
create or replace function public.connector_update_college(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  c public.colleges;
begin
  select * into c from public.colleges where id = college and desk_id = l.desk_id for update;
  if not found then raise exception 'No college with that id on this desk.'; end if;
  update public.colleges set
    name = case when fields ? 'name' and trim(fields ->> 'name') <> '' then left(trim(fields ->> 'name'), 200) else name end,
    app_system = case when fields ? 'app_system' then public.connector_app_system(fields ->> 'app_system', app_system) else app_system end,
    round = case when fields ? 'round' then public.connector_round(fields ->> 'round', round) else round end,
    deadline = case when fields ? 'deadline' then public.connector_date(fields ->> 'deadline') else deadline end,
    materials_deadline = case when fields ? 'materials_deadline' then public.connector_date(fields ->> 'materials_deadline') else materials_deadline end,
    needs_letters = case when fields ? 'needs_letters' then (fields ->> 'needs_letters')::boolean else needs_letters end,
    ai_policy = case when fields ? 'ai_policy' then (case when fields ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end) else ai_policy end,
    research = case when fields ? 'research' then coalesce(fields ->> 'research', '') else research end
  where id = c.id;
end;
$$;

create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.colleges where id = college and desk_id = l.desk_id;
  if not found then raise exception 'No college with that id on this desk.'; end if;
end;
$$;

-- fields: any of {title, prompt, limit_kind, limit_value, status, notes, college_id}
-- (college_id null moves it to the shared pieces).
create or replace function public.connector_update_piece(token text, piece uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  new_college uuid;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id for update;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  new_college := p.college_id;
  if fields ? 'college_id' then
    new_college := nullif(fields ->> 'college_id', '')::uuid;
    if new_college is not null and not exists (select 1 from public.colleges where id = new_college and desk_id = l.desk_id) then
      raise exception 'No college with that id on this desk.';
    end if;
  end if;
  update public.pieces set
    title = case when fields ? 'title' and trim(fields ->> 'title') <> '' then left(trim(fields ->> 'title'), 300) else title end,
    prompt = case when fields ? 'prompt' then coalesce(fields ->> 'prompt', '') else prompt end,
    limit_kind = case when fields ->> 'limit_kind' in ('words','chars','none') then fields ->> 'limit_kind' else limit_kind end,
    limit_value = case when fields ? 'limit_value' then (case when (fields ->> 'limit_value')::integer > 0 then (fields ->> 'limit_value')::integer else null end) else limit_value end,
    status = case when fields ->> 'status' in ('not_started','drafting','needs_review','final','submitted') then fields ->> 'status' else status end,
    notes = case when fields ? 'notes' then coalesce(fields ->> 'notes', '') else notes end,
    college_id = new_college
  where id = p.id;
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
end;
$$;

-- fields: any of {name, about}.
create or replace function public.connector_update_profile(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    display_name = case when fields ? 'name' then left(coalesce(fields ->> 'name', ''), 80) else display_name end,
    about = case when fields ? 'about' then coalesce(fields ->> 'about', '') else about end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

-- The desk overview also carries each college's research and letters flag, and piece prompts.
create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'app_system', c.app_system, 'round', c.round,
        'deadline', c.deadline, 'materials_deadline', c.materials_deadline,
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters,
        'has_research', length(c.research) > 0) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status, 'prompt', p.prompt,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value) order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.connector_date(text) from public, anon, authenticated;
revoke all on function public.connector_app_system(text, text) from public, anon, authenticated;
revoke all on function public.connector_round(text, text) from public, anon, authenticated;
grant execute on function public.connector_set_up_colleges(text, jsonb) to anon, authenticated;
grant execute on function public.connector_update_college(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_college(text, uuid) to anon, authenticated;
grant execute on function public.connector_update_piece(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_update_profile(text, jsonb) to anon, authenticated;
$m20260927000000$;
    insert into average_app.migrations (version, name) values ('20260927000000', '20260927000000_connector_manage');
    applied := applied + 1;
    raise notice 'Applied %', '20260927000000_connector_manage' || case when late[5] then ' (it had been skipped)' else '' end;
  end if;

  if not have[6] then
    execute $m20260928000000$
-- Strategy, Progress and the AI bridge.
--
-- Strategy: each college carries admission odds (from the connected AI, or entered by the
-- student; without either, the page falls back to the college's published admission rate from
-- the bundled College Scorecard data), fit, campus life, reputation and cost. Colleges outside
-- the US are described by what decides admission instead of a percentage.
--
-- AI bridge: the website cannot start or read a Claude/ChatGPT conversation. Instead it queues
-- requests on the desk (a question about a piece, "polish this passage", "estimate my odds"),
-- the student tells their connected assistant to handle them, and the assistant answers through
-- the connector. Answers appear on the desk live.

-- ─── strategy fields on colleges ─────────────────────────────────────────────

alter table public.colleges
  add column if not exists scorecard_id integer,
  add column if not exists chance_percent numeric(5,2) check (chance_percent is null or (chance_percent >= 0 and chance_percent <= 100)),
  add column if not exists chance_source text check (chance_source in ('ai','student')),
  add column if not exists chance_note text not null default '',
  add column if not exists fit_rank integer check (fit_rank is null or fit_rank > 0),
  add column if not exists campus_life smallint check (campus_life is null or campus_life between 0 and 10),
  add column if not exists reputation smallint check (reputation is null or reputation between 0 and 10),
  add column if not exists cost_sticker integer check (cost_sticker is null or cost_sticker >= 0),
  add column if not exists cost_net integer check (cost_net is null or cost_net >= 0),
  add column if not exists country text not null default 'US',
  add column if not exists intl_course text not null default '',
  add column if not exists intl_criterion text not null default '',
  add column if not exists intl_cost text not null default '',
  add column if not exists intl_status text not null default '';

-- ─── the student's academic profile (context for odds and writing) ──────────

alter table public.profiles
  add column if not exists gpa text not null default '',
  add column if not exists test_scores text not null default '',
  add column if not exists intended_major text not null default '';

-- ─── pieces: a due date of their own, and alternate versions ─────────────────

alter table public.pieces
  add column if not exists due date,
  add column if not exists variant_of uuid references public.pieces (id) on delete set null;

-- ─── the AI bridge ───────────────────────────────────────────────────────────

create table if not exists public.desk_requests (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null references public.desks (id) on delete cascade,
  piece_id    uuid references public.pieces (id) on delete cascade,
  -- ask: a question; polish: rewordings of `selection` (answered as suggestions); odds: estimate
  -- admission odds for the colleges (answered with set_college_strategy).
  kind        text not null check (kind in ('ask','polish','odds')),
  prompt      text not null default '',
  selection   text not null default '',
  status      text not null default 'pending' check (status in ('pending','answered','dismissed')),
  answer      text not null default '',
  answered_by text not null default '',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists desk_requests_desk_idx on public.desk_requests (desk_id, status, created_at);

alter table public.desk_requests enable row level security;
create policy "owner reads requests" on public.desk_requests
  for select using (public.is_desk_owner(desk_id));
create policy "owner makes requests" on public.desk_requests
  for insert with check (public.is_desk_owner(desk_id) and status = 'pending' and answer = '');
create policy "owner dismisses requests" on public.desk_requests
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
create policy "owner deletes requests" on public.desk_requests
  for delete using (public.is_desk_owner(desk_id));

alter publication supabase_realtime add table public.desk_requests;

-- Progress and Board follow pieces live (a status changed on one screen moves everywhere).
alter publication supabase_realtime add table public.pieces;

-- Requests waiting for the assistant, oldest first.
create or replace function public.connector_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending'), '[]'::jsonb);
end;
$$;

create or replace function public.connector_answer_request(token text, request uuid, answer_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests
     set status = 'answered', answer = coalesce(answer_text, ''), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id;
  if not found then raise exception 'No request with that id on this desk.'; end if;
end;
$$;

-- Strategy fields for one college, set by the assistant. Keys left out are unchanged.
-- fields: any of {chance_percent, chance_note, fit_rank, campus_life, reputation, cost_sticker,
-- cost_net, country, intl_course, intl_criterion, intl_cost, intl_status, scorecard_id}.
create or replace function public.connector_set_strategy(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  n numeric;
begin
  if not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'No college with that id on this desk.';
  end if;
  update public.colleges set
    chance_percent = case when fields ? 'chance_percent' then (fields ->> 'chance_percent')::numeric else chance_percent end,
    chance_source = case when fields ? 'chance_percent' then (case when fields ->> 'chance_percent' is null then null else 'ai' end) else chance_source end,
    chance_note = case when fields ? 'chance_note' then coalesce(fields ->> 'chance_note', '') else chance_note end,
    fit_rank = case when fields ? 'fit_rank' then (fields ->> 'fit_rank')::integer else fit_rank end,
    campus_life = case when fields ? 'campus_life' then (fields ->> 'campus_life')::smallint else campus_life end,
    reputation = case when fields ? 'reputation' then (fields ->> 'reputation')::smallint else reputation end,
    cost_sticker = case when fields ? 'cost_sticker' then (fields ->> 'cost_sticker')::integer else cost_sticker end,
    cost_net = case when fields ? 'cost_net' then (fields ->> 'cost_net')::integer else cost_net end,
    country = case when fields ? 'country' and trim(fields ->> 'country') <> '' then left(trim(fields ->> 'country'), 60) else country end,
    intl_course = case when fields ? 'intl_course' then coalesce(fields ->> 'intl_course', '') else intl_course end,
    intl_criterion = case when fields ? 'intl_criterion' then coalesce(fields ->> 'intl_criterion', '') else intl_criterion end,
    intl_cost = case when fields ? 'intl_cost' then coalesce(fields ->> 'intl_cost', '') else intl_cost end,
    intl_status = case when fields ? 'intl_status' then coalesce(fields ->> 'intl_status', '') else intl_status end,
    scorecard_id = case when fields ? 'scorecard_id' then (fields ->> 'scorecard_id')::integer else scorecard_id end
  where id = college;
end;
$$;

-- The student's academic profile, set by the assistant. fields: any of {gpa, test_scores, intended_major}.
create or replace function public.connector_update_academics(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    gpa = case when fields ? 'gpa' then coalesce(fields ->> 'gpa', '') else gpa end,
    test_scores = case when fields ? 'test_scores' then coalesce(fields ->> 'test_scores', '') else test_scores end,
    intended_major = case when fields ? 'intended_major' then coalesce(fields ->> 'intended_major', '') else intended_major end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

-- Everything the assistant needs to estimate odds: each college's strategy fields and the
-- student's academic profile.
create or replace function public.connector_strategy(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'round', c.round, 'deadline', c.deadline, 'scorecard_id', c.scorecard_id,
        'chance_percent', c.chance_percent, 'chance_source', c.chance_source, 'chance_note', c.chance_note,
        'fit_rank', c.fit_rank, 'campus_life', c.campus_life, 'reputation', c.reputation,
        'cost_sticker', c.cost_sticker, 'cost_net', c.cost_net, 'country', c.country,
        'intl_course', c.intl_course, 'intl_criterion', c.intl_criterion, 'intl_cost', c.intl_cost,
        'intl_status', c.intl_status, 'research', c.research) order by c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.connector_strategy(text) to anon, authenticated;
grant execute on function public.connector_requests(text) to anon, authenticated;
grant execute on function public.connector_answer_request(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_set_strategy(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_update_academics(text, jsonb) to anon, authenticated;
$m20260928000000$;
    insert into average_app.migrations (version, name) values ('20260928000000', '20260928000000_strategy_progress_bridge');
    applied := applied + 1;
    raise notice 'Applied %', '20260928000000_strategy_progress_bridge' || case when late[6] then ' (it had been skipped)' else '' end;
  end if;

  if not have[7] then
    execute $m20260929000000$
-- Claude (or ChatGPT) watching the desk from a chat the student already has open.
--
-- The website can't push a message into a Claude chat. Instead the student says "watch my
-- Application Desk" once; the assistant calls watch_desk, which waits on the server for new
-- requests and returns them as they arrive, then calls it again. watched_at records when it
-- last checked, so the website can show "Claude is watching" or how to start it.

alter table public.connector_links add column if not exists watched_at timestamptz;

-- Mark the link as watching now, and return the requests waiting (oldest first).
create or replace function public.connector_watch(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set watched_at = now() where id = l.id;
  return public.connector_requests(token);
end;
$$;

grant execute on function public.connector_watch(text) to anon, authenticated;
$m20260929000000$;
    insert into average_app.migrations (version, name) values ('20260929000000', '20260929000000_watch_desk');
    applied := applied + 1;
    raise notice 'Applied %', '20260929000000_watch_desk' || case when late[7] then ' (it had been skipped)' else '' end;
  end if;

  if not have[8] then
    execute $m20260930000000$
-- Editing and Suggesting for everyone on a piece.
--
-- Braxton's call (9/24/26): anyone who can suggest on a desk (the student, and people with a
-- "can suggest" link) can switch between Suggesting and Editing. In Editing they change the text
-- directly. Read-only links still only read. The student still decides on suggestions.

-- Who may change a piece's text directly.
create or replace function public.can_edit_text(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'suggest';
$$;

drop policy if exists "add updates" on public.piece_updates;
create policy "add updates" on public.piece_updates
  for insert with check (public.can_edit_text(public.piece_desk(piece_id)));

-- The board's word counts, kept current by whoever is editing (the rest of a piece's fields stay
-- the student's).
create or replace function public.set_piece_text_stats(piece uuid, plain text, words integer, chars integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_text(public.piece_desk(piece)) then raise exception 'not allowed'; end if;
  update public.pieces
     set plain_text = coalesce(plain, ''), word_count = greatest(0, coalesce(words, 0)), char_count = greatest(0, coalesce(chars, 0))
   where id = piece;
end;
$$;
revoke all on function public.set_piece_text_stats(uuid, text, integer, integer) from public, anon;
grant execute on function public.set_piece_text_stats(uuid, text, integer, integer) to authenticated;

-- The student resolves every suggestion, including ones they made themselves in Suggesting mode,
-- and can still reword their own while it is open.
create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
  content_changed boolean := new.kind <> old.kind or new.anchor_from <> old.anchor_from
    or new.anchor_to is distinct from old.anchor_to or new.quote <> old.quote or new.body <> old.body
    or new.note <> old.note;
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) then
    if old.author_id = auth.uid() and old.source <> 'ai' and old.status = 'open' and new.status = 'open' then
      null; -- the student rewording their own open suggestion
    else
      if content_changed then
        raise exception 'the student accepts or declines, and does not edit, a suggestion';
      end if;
      new.resolved_at := case when new.status = 'open' then null else now() end;
      new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
    end if;
  elsif old.author_id = auth.uid() then
    if old.status <> 'open' or new.status <> 'open' then
      raise exception 'only the student resolves a suggestion';
    end if;
  else
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
$m20260930000000$;
    insert into average_app.migrations (version, name) values ('20260930000000', '20260930000000_editing_mode');
    applied := applied + 1;
    raise notice 'Applied %', '20260930000000_editing_mode' || case when late[8] then ' (it had been skipped)' else '' end;
  end if;

  if not have[9] then
    execute $m20261001000000$
-- Permissions, the counselor, the Profile page, and due dates through the connector.
--
-- Braxton's calls (9/24/26):
-- - Share links pick one of three levels: read only, suggest, or edit (edit can also suggest).
-- - Each connector (Claude, ChatGPT, the counselor) has its own level for essays (read, suggest,
--   edit) and a separate switch for managing the desk: adding, changing and removing colleges
--   and pieces, prompts, limits and due dates.
-- - A counselor can run on the student's own computer: a small watcher picks up requests from
--   the website and wakes Claude Code to answer them, with nothing for the student to do.
-- - A Profile page: sections about the student, written by them or by Claude (for example after
--   Claude interviews them), used as context for every essay.

-- ─── share links: read only, suggest, or edit ────────────────────────────────

alter table public.share_links drop constraint if exists share_links_role_check;
alter table public.share_links add constraint share_links_role_check check (role in ('view','suggest','edit'));

create or replace function public.can_suggest_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) in ('suggest','edit');
$$;

-- Who may change a piece's text directly: the student, and people on an "edit" link.
create or replace function public.can_edit_text(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'edit';
$$;

drop policy if exists "add updates" on public.piece_updates;
create policy "add updates" on public.piece_updates
  for insert with check (public.can_edit_text(public.piece_desk(piece_id)));

create or replace function public.create_share_link(d uuid, link_role text, link_label text, link_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if link_role not in ('view','suggest','edit') then raise exception 'bad role'; end if;
  token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.share_links (desk_id, token_hash, role, label, password_hash)
  values (
    d,
    encode(digest(token, 'sha256'), 'hex'),
    link_role,
    left(coalesce(link_label, ''), 80),
    case when coalesce(link_password, '') = '' then null else crypt(link_password, gen_salt('bf')) end
  );
  return token;
end;
$$;

-- ─── connector permissions ───────────────────────────────────────────────────

-- Existing links keep doing everything they did.
alter table public.connector_links
  add column if not exists essay_access text not null default 'edit' check (essay_access in ('read','suggest','edit')),
  add column if not exists can_manage boolean not null default true;

-- Raise a clear error when the student hasn't allowed this connector to do `what`
-- ('suggest', 'edit' or 'manage').
create or replace function public.connector_allow(token text, what text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  if what = 'manage' and not l.can_manage then
    raise exception 'The student hasn''t allowed % to add, change or remove colleges and pieces (details, prompts, limits, due dates). Tell them what you would change; they can allow it in Application Desk → Settings.', l.label;
  elsif what = 'edit' and l.essay_access <> 'edit' then
    raise exception 'The student hasn''t allowed % to change essay text directly.%', l.label,
      case when l.essay_access = 'suggest' then ' Use suggest_edits instead: the changes wait for them to accept.' else ' Give advice in your answer instead.' end;
  elsif what = 'suggest' and l.essay_access = 'read' then
    raise exception 'The student has allowed % to read their essays but not to suggest edits. Give advice in your answer instead.', l.label;
  end if;
end;
$$;
revoke all on function public.connector_allow(text, text) from public, anon, authenticated;

-- The checked functions keep their names; the originals move aside, callable only from here.
do $$
declare
  f record;
begin
  for f in select * from (values
    ('connector_write', 'text, uuid, text, jsonb, text, text, integer, integer'),
    ('connector_add_suggestions', 'text, uuid, jsonb'),
    ('connector_create_piece', 'text, uuid, text, text, text, integer'),
    ('connector_update_college', 'text, uuid, jsonb'),
    ('connector_delete_college', 'text, uuid'),
    ('connector_delete_piece', 'text, uuid')
  ) as t(name, args) loop
    if to_regprocedure(format('public.%s_unchecked(%s)', f.name, f.args)) is null then
      execute format('alter function public.%s(%s) rename to %s_unchecked', f.name, f.args, f.name);
    end if;
    execute format('revoke all on function public.%s_unchecked(%s) from public, anon, authenticated', f.name, f.args);
  end loop;
end;
$$;

create or replace function public.connector_write(
  token text, piece uuid, yjs_update text,
  before_json jsonb, before_text text, after_text text, after_words integer, after_chars integer
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'edit');
  perform public.connector_write_unchecked(token, piece, yjs_update, before_json, before_text, after_text, after_words, after_chars);
end;
$$;

create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'suggest');
  return public.connector_add_suggestions_unchecked(token, piece, rows);
end;
$$;

create or replace function public.connector_create_piece(
  token text, college uuid, piece_title text, piece_prompt text, piece_limit_kind text, piece_limit_value integer
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  return public.connector_create_piece_unchecked(token, college, piece_title, piece_prompt, piece_limit_kind, piece_limit_value);
end;
$$;

create or replace function public.connector_update_college(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_update_college_unchecked(token, college, fields);
end;
$$;

create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_delete_college_unchecked(token, college);
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_delete_piece_unchecked(token, piece);
end;
$$;

-- ─── set up colleges: fill in what's missing on colleges and pieces already there ──

-- colleges: [{name, app_system, round, deadline, materials_deadline, needs_letters, ai_policy,
--             research, pieces: [{title, prompt, limit_kind, limit_value, due}]}]
-- A college or piece already on the desk (same name / title) is kept and updated with the details
-- sent: prompts, limits, due dates, deadlines. Research notes are only filled in when empty.
-- Returns [{name, college_id, created, pieces: [{title, piece_id, created}]}].
create or replace function public.connector_set_up_colleges(token text, colleges jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  c jsonb;
  p jsonb;
  cid uuid;
  pid uuid;
  made boolean;
  pmade boolean;
  result jsonb := '[]'::jsonb;
  pout jsonb;
  cname text;
  ptitle text;
  lim integer;
begin
  perform public.connector_allow(token, 'manage');
  if jsonb_typeof(colleges) <> 'array' or jsonb_array_length(colleges) = 0 then
    raise exception 'Send at least one college.';
  end if;
  for c in select * from jsonb_array_elements(colleges) loop
    cname := left(trim(coalesce(c ->> 'name', '')), 200);
    if cname = '' then raise exception 'Every college needs a name.'; end if;
    select id into cid from public.colleges where desk_id = l.desk_id and lower(name) = lower(cname) limit 1;
    made := cid is null;
    if made then
      insert into public.colleges (desk_id, name, app_system, round, deadline, materials_deadline, ai_policy, needs_letters, research)
      values (
        l.desk_id, cname,
        public.connector_app_system(c ->> 'app_system', 'common_app'),
        public.connector_round(c ->> 'round', 'RD'),
        public.connector_date(c ->> 'deadline'),
        public.connector_date(c ->> 'materials_deadline'),
        case when c ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end,
        coalesce((c ->> 'needs_letters')::boolean, true),
        coalesce(c ->> 'research', '')
      )
      returning id into cid;
    else
      update public.colleges set
        app_system = case when c ? 'app_system' then public.connector_app_system(c ->> 'app_system', app_system) else app_system end,
        round = case when c ? 'round' then public.connector_round(c ->> 'round', round) else round end,
        deadline = case when coalesce(c ->> 'deadline', '') <> '' then public.connector_date(c ->> 'deadline') else deadline end,
        materials_deadline = case when coalesce(c ->> 'materials_deadline', '') <> '' then public.connector_date(c ->> 'materials_deadline') else materials_deadline end,
        ai_policy = case when c ? 'ai_policy' then (case when c ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end) else ai_policy end,
        needs_letters = case when c ? 'needs_letters' then (c ->> 'needs_letters')::boolean else needs_letters end,
        research = case when research = '' and coalesce(c ->> 'research', '') <> '' then c ->> 'research' else research end
      where id = cid;
    end if;
    pout := '[]'::jsonb;
    if jsonb_typeof(c -> 'pieces') = 'array' then
      for p in select * from jsonb_array_elements(c -> 'pieces') loop
        ptitle := coalesce(nullif(left(trim(coalesce(p ->> 'title', '')), 300), ''), 'Untitled');
        lim := case when (p ->> 'limit_value')::integer > 0 then (p ->> 'limit_value')::integer else null end;
        select id into pid from public.pieces
         where desk_id = l.desk_id and college_id = cid and lower(title) = lower(ptitle) limit 1;
        pmade := pid is null;
        if pmade then
          insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value, due)
          values (
            l.desk_id, cid, ptitle, coalesce(p ->> 'prompt', ''),
            case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                 when lim is not null then 'words' else 'none' end,
            lim,
            public.connector_date(p ->> 'due')
          )
          returning id into pid;
        else
          update public.pieces set
            prompt = case when coalesce(p ->> 'prompt', '') <> '' then p ->> 'prompt' else prompt end,
            limit_kind = case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                              when lim is not null and limit_kind = 'none' then 'words' else limit_kind end,
            limit_value = coalesce(lim, limit_value),
            due = case when coalesce(p ->> 'due', '') <> '' then public.connector_date(p ->> 'due') else due end
          where id = pid;
        end if;
        pout := pout || jsonb_build_object('title', ptitle, 'piece_id', pid, 'created', pmade);
      end loop;
    end if;
    result := result || jsonb_build_object('name', cname, 'college_id', cid, 'created', made, 'pieces', pout);
  end loop;
  return result;
end;
$$;

-- fields: any of {title, prompt, limit_kind, limit_value, status, notes, college_id, due}
-- (college_id null moves it to the shared pieces; due "" clears the due date).
create or replace function public.connector_update_piece(token text, piece uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  new_college uuid;
begin
  perform public.connector_allow(token, 'manage');
  select * into p from public.pieces where id = piece and desk_id = l.desk_id for update;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  new_college := p.college_id;
  if fields ? 'college_id' then
    new_college := nullif(fields ->> 'college_id', '')::uuid;
    if new_college is not null and not exists (select 1 from public.colleges where id = new_college and desk_id = l.desk_id) then
      raise exception 'No college with that id on this desk.';
    end if;
  end if;
  update public.pieces set
    title = case when fields ? 'title' and trim(fields ->> 'title') <> '' then left(trim(fields ->> 'title'), 300) else title end,
    prompt = case when fields ? 'prompt' then coalesce(fields ->> 'prompt', '') else prompt end,
    limit_kind = case when fields ->> 'limit_kind' in ('words','chars','none') then fields ->> 'limit_kind'
                      when (fields ->> 'limit_value')::integer > 0 and limit_kind = 'none' then 'words' else limit_kind end,
    limit_value = case when fields ? 'limit_value' then (case when (fields ->> 'limit_value')::integer > 0 then (fields ->> 'limit_value')::integer else null end) else limit_value end,
    status = case when fields ->> 'status' in ('not_started','drafting','needs_review','final','submitted') then fields ->> 'status' else status end,
    notes = case when fields ? 'notes' then coalesce(fields ->> 'notes', '') else notes end,
    due = case when fields ? 'due' then public.connector_date(fields ->> 'due') else due end,
    college_id = new_college
  where id = p.id;
end;
$$;

-- The desk overview, with each piece's due date and what this connector is allowed to do.
create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'permissions', jsonb_build_object('essays', l.essay_access, 'manage', l.can_manage),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'profile_sections', (select count(*) from public.profile_sections s where s.desk_id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'app_system', c.app_system, 'round', c.round,
        'deadline', c.deadline, 'materials_deadline', c.materials_deadline,
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters,
        'has_research', length(c.research) > 0) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status, 'prompt', p.prompt,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value, 'due', p.due)
        order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

-- ─── the profile ─────────────────────────────────────────────────────────────

create table if not exists public.profile_sections (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  title      text not null default '' check (length(title) <= 200),
  body       text not null default '' check (length(body) <= 20000),
  sort       double precision not null default 0,
  -- '' when the student wrote it last, else the assistant's label.
  updated_by text not null default '' check (length(updated_by) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profile_sections_desk_idx on public.profile_sections (desk_id, sort);

alter table public.profile_sections enable row level security;
drop policy if exists "owner reads profile" on public.profile_sections;
create policy "owner reads profile" on public.profile_sections
  for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner adds to profile" on public.profile_sections;
create policy "owner adds to profile" on public.profile_sections
  for insert with check (public.is_desk_owner(desk_id));
drop policy if exists "owner changes profile" on public.profile_sections;
create policy "owner changes profile" on public.profile_sections
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
drop policy if exists "owner removes from profile" on public.profile_sections;
create policy "owner removes from profile" on public.profile_sections
  for delete using (public.is_desk_owner(desk_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_sections') then
    alter publication supabase_realtime add table public.profile_sections;
  end if;
end;
$$;

-- Everything on the Profile page, for the assistant.
create or replace function public.connector_profile(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'body', s.body, 'updated_at', s.updated_at)
                       order by s.sort, s.created_at)
      from public.profile_sections s where s.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

-- Add a section (section null; it goes last) or change one. fields: any of {title, body}.
create or replace function public.connector_save_profile_section(token text, section uuid, fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  sid uuid := section;
begin
  if length(coalesce(fields ->> 'body', '')) > 20000 then
    raise exception 'A section holds at most 20,000 characters. Split it into more sections.';
  end if;
  if sid is null then
    insert into public.profile_sections (desk_id, title, body, sort, updated_by)
    values (
      l.desk_id, left(trim(coalesce(fields ->> 'title', '')), 200), coalesce(fields ->> 'body', ''),
      coalesce((select max(sort) from public.profile_sections where desk_id = l.desk_id), 0) + 1,
      l.label
    )
    returning id into sid;
  else
    update public.profile_sections set
      title = case when fields ? 'title' then left(trim(coalesce(fields ->> 'title', '')), 200) else title end,
      body = case when fields ? 'body' then coalesce(fields ->> 'body', '') else body end,
      updated_by = l.label,
      updated_at = now()
    where id = sid and desk_id = l.desk_id;
    if not found then raise exception 'No profile section with that id. Call read_profile to see the sections.'; end if;
  end if;
  return sid;
end;
$$;

create or replace function public.connector_delete_profile_section(token text, section uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.profile_sections where id = section and desk_id = l.desk_id;
  if not found then raise exception 'No profile section with that id. Call read_profile to see the sections.'; end if;
end;
$$;

-- Put the sections in this order; any left out keep their order after them.
create or replace function public.connector_order_profile(token text, ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  with ranked as (
    select s.id, row_number() over (order by coalesce(array_position(ids, s.id), 1000000), s.sort, s.created_at) as n
      from public.profile_sections s where s.desk_id = l.desk_id
  )
  update public.profile_sections s set sort = r.n from ranked r where s.id = r.id;
end;
$$;

-- ─── the counselor, and interviews ───────────────────────────────────────────

-- An interview: the student's reply (or "start") on the Profile page, answered with the next question.
alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check check (kind in ('ask','polish','odds','interview'));

-- When the counselor picked a request up, so each wakes Claude once.
alter table public.desk_requests add column if not exists counselor_at timestamptz;
-- When a counselor on the student's computer last checked in.
alter table public.connector_links add column if not exists counselor_at timestamptz;

-- The counselor's watcher calls this every few seconds. It marks the link as watching, takes the
-- requests that arrived since, and says how many are new and how many are still waiting.
create or replace function public.connector_counselor_poll(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  fresh integer;
  waiting integer;
begin
  update public.connector_links set watched_at = now(), counselor_at = now()
   where id = l.id and (counselor_at is null or counselor_at < now() - interval '20 seconds');
  with taken as (
    update public.desk_requests set counselor_at = now()
     where desk_id = l.desk_id and status = 'pending' and counselor_at is null
    returning 1
  )
  select count(*) into fresh from taken;
  select count(*) into waiting from public.desk_requests where desk_id = l.desk_id and status = 'pending';
  return jsonb_build_object('fresh', fresh, 'waiting', waiting);
end;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────

grant execute on function public.connector_write(text, uuid, text, jsonb, text, text, integer, integer) to anon, authenticated;
grant execute on function public.connector_add_suggestions(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_create_piece(text, uuid, text, text, text, integer) to anon, authenticated;
grant execute on function public.connector_update_college(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_college(text, uuid) to anon, authenticated;
grant execute on function public.connector_delete_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_set_up_colleges(text, jsonb) to anon, authenticated;
grant execute on function public.connector_update_piece(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_desk(text) to anon, authenticated;
grant execute on function public.connector_profile(text) to anon, authenticated;
grant execute on function public.connector_save_profile_section(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_profile_section(text, uuid) to anon, authenticated;
grant execute on function public.connector_order_profile(text, uuid[]) to anon, authenticated;
grant execute on function public.connector_counselor_poll(text) to anon, authenticated;
$m20261001000000$;
    insert into average_app.migrations (version, name) values ('20261001000000', '20261001000000_permissions_counselor_profile');
    applied := applied + 1;
    raise notice 'Applied %', '20261001000000_permissions_counselor_profile' || case when late[9] then ' (it had been skipped)' else '' end;
  end if;

  if not have[10] then
    execute $m20261002000000$
-- The Counselor page, and a faster counselor.
--
-- Braxton's calls (9/24/26): the counselor on the student's computer should answer faster, and a
-- Counselor page lets the student talk to it directly, see what it's doing, and control it.
--
-- - 'chat' requests: messages to the counselor from the Counselor page.
-- - Each counselor link has a speed (which Claude model and effort it runs), can be paused from
--   the website, and reports which version of the counselor is installed.
-- - The counselor streams its answer into the request while it writes (a draft in `answer`,
--   status still 'pending'), then finishes it.
-- - `activity` records the last thing an assistant did through the connector, so the website can
--   say "Reading 'Why us'" while it works.

alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check
  check (kind in ('ask','polish','odds','interview','chat'));

alter table public.connector_links
  add column if not exists counselor_speed text not null default 'balanced'
    check (counselor_speed in ('fast','balanced','thorough')),
  add column if not exists counselor_paused boolean not null default false,
  add column if not exists counselor_version text not null default '' check (length(counselor_version) <= 20),
  add column if not exists activity jsonb,
  add column if not exists activity_at timestamptz,
  -- Asked on the website to remove itself from the student's computer; it does, then revokes
  -- its own link (connector_counselor_removed).
  add column if not exists counselor_remove boolean not null default false;

-- The counselor's watcher calls this every couple of seconds. It marks the link as watching (and
-- which version is installed), takes the requests that arrived since unless the counselor is
-- paused, and says how many are new, how many are waiting, and how fast to run.
drop function if exists public.connector_counselor_poll(text);
create or replace function public.connector_counselor_poll(token text, version text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  fresh integer := 0;
  waiting integer;
begin
  update public.connector_links set watched_at = now(), counselor_at = now(), counselor_version = v
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v);
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now()
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  select count(*) into waiting from public.desk_requests where desk_id = l.desk_id and status = 'pending';
  return jsonb_build_object('fresh', fresh, 'waiting', waiting, 'speed', l.counselor_speed, 'paused', l.counselor_paused,
                            'remove', l.counselor_remove);
end;
$$;

-- The counselor has removed itself from the student's computer: its link is done.
create or replace function public.connector_counselor_removed(token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set revoked_at = now() where id = l.id;
end;
$$;

-- The answer so far, while the counselor writes it. Only a waiting request takes a draft.
create or replace function public.connector_draft_answer(token text, request uuid, draft text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests set answer = left(coalesce(draft, ''), 20000)
   where id = request and desk_id = l.desk_id and status = 'pending';
end;
$$;

-- Finish a request with the counselor's reply. Returns false when it isn't waiting any more (the
-- student dismissed it, or it was already answered), so a dismissal is never undone.
create or replace function public.connector_finish_request(token text, request uuid, answer_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests
     set status = 'answered', answer = left(coalesce(answer_text, ''), 20000), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id and status = 'pending';
  return found;
end;
$$;

-- What the assistant is doing: a connector tool it just used (with the piece, if any), or
-- 'thinking' / 'idle' from the counselor. The counselor names the request it has started on;
-- the tools it uses on that request keep it, and 'idle' clears it.
create or replace function public.connector_activity(token text, tool text, piece uuid default null, request uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  working_on text := case
    when request is not null then request::text
    when coalesce(tool, '') = 'idle' then null
    else l.activity ->> 'request'
  end;
begin
  update public.connector_links
     set activity = jsonb_build_object(
           'tool', left(coalesce(tool, ''), 60),
           'piece', (select p.title from public.pieces p where p.id = piece and p.desk_id = l.desk_id),
           'request', working_on),
         activity_at = now()
   where id = l.id;
end;
$$;

grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
grant execute on function public.connector_counselor_removed(text) to anon, authenticated;
grant execute on function public.connector_draft_answer(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_finish_request(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_activity(text, text, uuid, uuid) to anon, authenticated;
$m20261002000000$;
    insert into average_app.migrations (version, name) values ('20261002000000', '20261002000000_counselor_page');
    applied := applied + 1;
    raise notice 'Applied %', '20261002000000_counselor_page' || case when late[10] then ' (it had been skipped)' else '' end;
  end if;

  if not have[11] then
    execute $m20261003000000$
-- Updating the counselor without a gap, and never acting on a withdrawn request.
--
-- "Update the counselor" makes a new link for the new setup file. The old counselor keeps
-- answering until the new one first checks in; only then is the old link revoked (which also
-- turns the old one off wherever it runs). Before, the old link was revoked at once, so the desk
-- had no counselor until the new file was run, and none at all if it was downloaded on a phone.

alter table public.connector_links add column if not exists replaces uuid references public.connector_links (id) on delete set null;

-- From 20261002, in case an earlier copy of it was run: the poll below reads it.
alter table public.connector_links add column if not exists counselor_remove boolean not null default false;
create or replace function public.connector_counselor_removed(token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set revoked_at = now() where id = l.id;
end;
$$;
grant execute on function public.connector_counselor_removed(text) to anon, authenticated;

create or replace function public.connector_counselor_poll(token text, version text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  fresh integer := 0;
  waiting integer;
  pending_ids jsonb;
begin
  update public.connector_links set watched_at = now(), counselor_at = now(), counselor_version = v
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v);
  -- The counselor this one replaces stops now that this one is running.
  if l.replaces is not null then
    update public.connector_links set revoked_at = now()
     where id = l.replaces and desk_id = l.desk_id and revoked_at is null;
    update public.connector_links set replaces = null where id = l.id;
  end if;
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now()
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  select count(*), coalesce(jsonb_agg(r.id), '[]'::jsonb) into waiting, pending_ids
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending';
  -- 'pending' lets the counselor drop anything the student withdrew while it waited in its queue.
  return jsonb_build_object('fresh', fresh, 'waiting', waiting, 'speed', l.counselor_speed, 'paused', l.counselor_paused,
                            'remove', l.counselor_remove, 'pending', pending_ids);
end;
$$;

grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
$m20261003000000$;
    insert into average_app.migrations (version, name) values ('20261003000000', '20261003000000_counselor_update');
    applied := applied + 1;
    raise notice 'Applied %', '20261003000000_counselor_update' || case when late[11] then ' (it had been skipped)' else '' end;
  end if;

  if not have[12] then
    execute $m20261004000000$
-- Choosing the Claude model.
--
-- Braxton's call (9/24/26): wherever AI is used, the model can be changed (Haiku, Sonnet, Opus,
-- Fable). The counselor has a default model and how hard it thinks; each request can ask for a
-- model of its own (Ask, Polish, odds, the chat, the interview). A Claude or ChatGPT chat uses
-- the model picked in that app; this only steers the counselor on the student's computer.

alter table public.connector_links
  add column if not exists counselor_model text not null default 'sonnet'
    check (counselor_model in ('haiku','sonnet','opus','fable')),
  add column if not exists counselor_effort text not null default 'medium'
    check (counselor_effort in ('low','medium','high'));

-- Speeds picked so far become the same model and effort (only on links still at the defaults,
-- so running this again changes nothing).
update public.connector_links set
  counselor_model = case counselor_speed when 'thorough' then 'opus' else 'sonnet' end,
  counselor_effort = case counselor_speed when 'fast' then 'low' when 'thorough' then 'high' else 'medium' end
 where counselor_speed <> 'balanced' and counselor_model = 'sonnet' and counselor_effort = 'medium';

-- '' means the counselor's default.
alter table public.desk_requests add column if not exists model text not null default ''
  check (model in ('','haiku','sonnet','opus','fable'));

-- Requests waiting for the assistant, oldest first, with the model each asks for.
create or replace function public.connector_requests(token text)
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
    where r.desk_id = l.desk_id and r.status = 'pending'), '[]'::jsonb);
end;
$$;

-- The poll also says which model and effort to run. 'speed' stays for counselors installed
-- before this (version 2), as the nearest of their three speeds.
create or replace function public.connector_counselor_poll(token text, version text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  fresh integer := 0;
  waiting integer;
  pending_ids jsonb;
begin
  update public.connector_links set watched_at = now(), counselor_at = now(), counselor_version = v
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v);
  -- The counselor this one replaces stops now that this one is running.
  if l.replaces is not null then
    update public.connector_links set revoked_at = now()
     where id = l.replaces and desk_id = l.desk_id and revoked_at is null;
    update public.connector_links set replaces = null where id = l.id;
  end if;
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now()
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  select count(*), coalesce(jsonb_agg(r.id), '[]'::jsonb) into waiting, pending_ids
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending';
  return jsonb_build_object(
    'fresh', fresh, 'waiting', waiting, 'paused', l.counselor_paused, 'remove', l.counselor_remove, 'pending', pending_ids,
    'model', l.counselor_model, 'effort', l.counselor_effort,
    'speed', case when l.counselor_model in ('opus','fable') then 'thorough' when l.counselor_effort = 'low' then 'fast' else 'balanced' end);
end;
$$;

grant execute on function public.connector_requests(text) to anon, authenticated;
grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
$m20261004000000$;
    insert into average_app.migrations (version, name) values ('20261004000000', '20261004000000_models');
    applied := applied + 1;
    raise notice 'Applied %', '20261004000000_models' || case when late[12] then ' (it had been skipped)' else '' end;
  end if;

  if not have[13] then
    execute $m20261005000000$
-- Recommenders and their letters.
--
-- Braxton's call (9/24/26): the board is one master board, and beside each college it shows who
-- writes its letters, each recommender in a color of their own. The student adds recommenders
-- and says which colleges each one writes for; so can the counselor (a connector allowed to
-- manage colleges and pieces).

create table if not exists public.recommenders (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null references public.desks(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null default '' check (char_length(role) <= 200),
  -- One of eight colors (the website's palette); picked on insert when not given.
  color smallint not null check (color between 0 and 7),
  created_at timestamptz not null default now()
);
create index if not exists recommenders_desk on public.recommenders (desk_id);

-- A letter one recommender writes for one college, and how far along it is.
create table if not exists public.letters (
  college_id uuid not null references public.colleges(id) on delete cascade,
  recommender_id uuid not null references public.recommenders(id) on delete cascade,
  desk_id uuid not null references public.desks(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned','requested','submitted')),
  updated_at timestamptz not null default now(),
  primary key (college_id, recommender_id)
);
create index if not exists letters_desk on public.letters (desk_id);
create index if not exists letters_recommender on public.letters (recommender_id);

-- A new recommender gets the color the desk uses least (the first of those on a tie).
create or replace function public.recommender_color()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.color is null then
    select c into new.color
      from generate_series(0, 7) c
      left join public.recommenders r on r.desk_id = new.desk_id and r.color = c
     group by c
     order by count(r.id), c
     limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists recommender_color on public.recommenders;
create trigger recommender_color before insert on public.recommenders
  for each row execute function public.recommender_color();

-- A letter's college and recommender are on its own desk.
create or replace function public.letters_same_desk()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.colleges where id = new.college_id and desk_id = new.desk_id)
     or not exists (select 1 from public.recommenders where id = new.recommender_id and desk_id = new.desk_id) then
    raise exception 'That college and recommender aren''t both on this desk.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists letters_same_desk on public.letters;
create trigger letters_same_desk before insert or update on public.letters
  for each row execute function public.letters_same_desk();

alter table public.recommenders enable row level security;
alter table public.letters enable row level security;

drop policy if exists "read recommenders" on public.recommenders;
create policy "read recommenders" on public.recommenders
  for select using (public.can_read_desk(desk_id));
drop policy if exists "write recommenders" on public.recommenders;
create policy "write recommenders" on public.recommenders
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

drop policy if exists "read letters" on public.letters;
create policy "read letters" on public.letters
  for select using (public.can_read_desk(desk_id));
drop policy if exists "write letters" on public.letters;
create policy "write letters" on public.letters
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

-- The board follows them live (the counselor adding a recommender shows at once).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recommenders') then
    alter publication supabase_realtime add table public.recommenders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'letters') then
    alter publication supabase_realtime add table public.letters;
  end if;
end;
$$;

-- ─── through the connector ────────────────────────────────────────────────────

-- The desk's recommenders, each with the letters they write.
create or replace function public.connector_recommenders(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'role', r.role,
      'letters', coalesce((
        select jsonb_agg(jsonb_build_object('college_id', x.college_id, 'college', c.name, 'status', x.status) order by c.name)
          from public.letters x join public.colleges c on c.id = x.college_id
         where x.recommender_id = r.id), '[]'::jsonb)
    ) order by r.created_at)
    from public.recommenders r where r.desk_id = l.desk_id), '[]'::jsonb);
end;
$$;

-- Add a recommender (recommender null) or change one: fields {name, role}. Returns its id.
create or replace function public.connector_save_recommender(token text, recommender uuid, fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  rid uuid;
  n text := btrim(coalesce(fields->>'name', ''));
begin
  perform public.connector_allow(token, 'manage');
  if recommender is null then
    if n = '' then raise exception 'A recommender needs a name.'; end if;
    insert into public.recommenders (desk_id, name, role)
    values (l.desk_id, left(n, 120), left(coalesce(fields->>'role', ''), 200))
    returning id into rid;
  else
    update public.recommenders set
      name = case when n = '' then name else left(n, 120) end,
      role = left(coalesce(fields->>'role', role), 200)
     where id = recommender and desk_id = l.desk_id
    returning id into rid;
    if rid is null then raise exception 'That recommender isn''t on this desk.'; end if;
  end if;
  return rid;
end;
$$;

create or replace function public.connector_delete_recommender(token text, recommender uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  delete from public.recommenders where id = recommender and desk_id = l.desk_id;
  if not found then raise exception 'That recommender isn''t on this desk.'; end if;
end;
$$;

-- Say that a recommender writes for a college, and how far along the letter is; 'none' takes it off.
create or replace function public.connector_set_letter(token text, recommender uuid, college uuid, letter_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  if not exists (select 1 from public.recommenders where id = recommender and desk_id = l.desk_id) then
    raise exception 'That recommender isn''t on this desk.';
  end if;
  if not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'That college isn''t on this desk.';
  end if;
  if letter_status = 'none' then
    delete from public.letters where recommender_id = recommender and college_id = college;
  elsif letter_status in ('planned', 'requested', 'submitted') then
    insert into public.letters (college_id, recommender_id, desk_id, status)
    values (college, recommender, l.desk_id, letter_status)
    on conflict (college_id, recommender_id) do update set status = excluded.status;
  else
    raise exception 'A letter''s status is planned, requested, submitted or none.';
  end if;
end;
$$;

grant execute on function public.connector_recommenders(text) to anon, authenticated;
grant execute on function public.connector_save_recommender(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_recommender(text, uuid) to anon, authenticated;
grant execute on function public.connector_set_letter(text, uuid, uuid, text) to anon, authenticated;
$m20261005000000$;
    insert into average_app.migrations (version, name) values ('20261005000000', '20261005000000_recommenders');
    applied := applied + 1;
    raise notice 'Applied %', '20261005000000_recommenders' || case when late[13] then ' (it had been skipped)' else '' end;
  end if;

  if not have[14] then
    execute $m20261006000000$
-- The transcript: pasted on the Profile page, read by the counselor into the academics.
--
-- Braxton's call (9/24/26): academics live on the Profile page, not in Settings, and the
-- student can paste their transcript for the counselor to read, which fills in their GPA,
-- class rank and coursework. The academics gain those two fields; requests gain a kind.

alter table public.profiles
  add column if not exists class_rank text not null default '',
  add column if not exists coursework text not null default '';

alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check
  check (kind in ('ask','polish','odds','interview','chat','transcript'));

-- The student's academic profile, set by the assistant. fields: any of {gpa, test_scores,
-- intended_major, class_rank, coursework}; the rest stay as they are.
create or replace function public.connector_update_academics(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    gpa = case when fields ? 'gpa' then left(coalesce(fields ->> 'gpa', ''), 80) else gpa end,
    test_scores = case when fields ? 'test_scores' then left(coalesce(fields ->> 'test_scores', ''), 200) else test_scores end,
    intended_major = case when fields ? 'intended_major' then left(coalesce(fields ->> 'intended_major', ''), 200) else intended_major end,
    class_rank = case when fields ? 'class_rank' then left(coalesce(fields ->> 'class_rank', ''), 80) else class_rank end,
    coursework = case when fields ? 'coursework' then left(coalesce(fields ->> 'coursework', ''), 4000) else coursework end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

-- Everything the assistant needs to estimate odds: each college's strategy fields and the
-- student's academic profile.
create or replace function public.connector_strategy(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major,
                                          'class_rank', p.class_rank, 'coursework', p.coursework)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'round', c.round, 'deadline', c.deadline, 'scorecard_id', c.scorecard_id,
        'chance_percent', c.chance_percent, 'chance_source', c.chance_source, 'chance_note', c.chance_note,
        'fit_rank', c.fit_rank, 'campus_life', c.campus_life, 'reputation', c.reputation,
        'cost_sticker', c.cost_sticker, 'cost_net', c.cost_net, 'country', c.country,
        'intl_course', c.intl_course, 'intl_criterion', c.intl_criterion, 'intl_cost', c.intl_cost,
        'intl_status', c.intl_status, 'research', c.research) order by c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

-- Everything on the Profile page, for the assistant.
create or replace function public.connector_profile(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major,
                                          'class_rank', p.class_rank, 'coursework', p.coursework)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'body', s.body, 'updated_at', s.updated_at)
                       order by s.sort, s.created_at)
      from public.profile_sections s where s.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.connector_update_academics(text, jsonb) to anon, authenticated;
grant execute on function public.connector_strategy(text) to anon, authenticated;
grant execute on function public.connector_profile(text) to anon, authenticated;
$m20261006000000$;
    insert into average_app.migrations (version, name) values ('20261006000000', '20261006000000_transcript');
    applied := applied + 1;
    raise notice 'Applied %', '20261006000000_transcript' || case when late[14] then ' (it had been skipped)' else '' end;
  end if;

  if not have[15] then
    execute $m20261007000000$
-- Submitting a whole application.
--
-- Braxton's call (9/24/26): a college's application is submitted at once, with one button on the
-- board, not piece by piece. When it's submitted its pieces are marked submitted too; the board
-- folds the college away and, after a few days, files it under Submitted.

alter table public.colleges add column if not exists submitted_at timestamptz;

-- Colleges already submitted piece by piece stay submitted, dated by their last piece's change
-- (so ones sent long ago are filed away at once).
update public.colleges c
   set submitted_at = (select max(p.updated_at) from public.pieces p where p.college_id = c.id)
 where c.submitted_at is null
   and exists (select 1 from public.pieces p where p.college_id = c.id)
   and not exists (select 1 from public.pieces p where p.college_id = c.id and p.status <> 'submitted');

-- The board follows colleges live (a submit on another screen, or by the counselor).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'colleges') then
    alter publication supabase_realtime add table public.colleges;
  end if;
end;
$$;

-- Submit a college's whole application through the connector (or take it back), as the board's
-- button does: submitted, every piece is marked submitted; taken back, they return to final.
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

-- The desk overview, with each piece's due date, whether each application is submitted, and what
-- this connector is allowed to do.
create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'permissions', jsonb_build_object('essays', l.essay_access, 'manage', l.can_manage),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'profile_sections', (select count(*) from public.profile_sections s where s.desk_id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'app_system', c.app_system, 'round', c.round,
        'deadline', c.deadline, 'materials_deadline', c.materials_deadline,
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters,
        'has_research', length(c.research) > 0, 'submitted_at', c.submitted_at) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status, 'prompt', p.prompt,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value, 'due', p.due)
        order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.connector_submit_college(text, uuid, boolean) to anon, authenticated;
grant execute on function public.connector_desk(text) to anon, authenticated;
$m20261007000000$;
    insert into average_app.migrations (version, name) values ('20261007000000', '20261007000000_submitted');
    applied := applied + 1;
    raise notice 'Applied %', '20261007000000_submitted' || case when late[15] then ' (it had been skipped)' else '' end;
  end if;

  if not have[16] then
    execute $m20261008000000$
-- The Trash.
--
-- Braxton's call (9/24/26): nothing a student deletes is gone at once. A deleted piece, or a
-- deleted college with all its pieces, goes to the Trash for 30 days with everything that went
-- with it (the text and its unsaved edits, the version history, suggestions, letters), whoever
-- deleted it: the student, or Claude through the connector. Restoring puts it all back as it
-- was, with the same ids. Deleting the whole account skips the Trash: that is meant to be final.

create table if not exists public.trash (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  kind       text not null check (kind in ('piece', 'college')),
  title      text not null default '',
  -- For a piece, its college; for a college, how many pieces went with it.
  detail     text not null default '',
  data       jsonb not null,
  deleted_by text not null default '',
  deleted_at timestamptz not null default now()
);
create index if not exists trash_desk on public.trash (desk_id, deleted_at desc);
create index if not exists trash_age on public.trash (deleted_at);

alter table public.trash enable row level security;
drop policy if exists "owner reads trash" on public.trash;
create policy "owner reads trash" on public.trash
  for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner empties trash" on public.trash;
create policy "owner empties trash" on public.trash
  for delete using (public.is_desk_owner(desk_id));
-- No insert or update: rows come only from the triggers below.

-- Everything that goes with one piece, as it is right now.
create or replace function public.piece_snapshot(p public.pieces)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'piece', to_jsonb(p),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', u.client_id, 'update', u."update", 'created_at', u.created_at) order by u.id)
        from public.piece_updates u where u.piece_id = p.id), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(v)) from public.piece_versions v where v.piece_id = p.id), '[]'::jsonb),
    'suggestions', coalesce((select jsonb_agg(to_jsonb(s)) from public.suggestions s where s.piece_id = p.id), '[]'::jsonb),
    -- Its Ask and Polish thread with the counselor.
    'requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.desk_requests q where q.piece_id = p.id), '[]'::jsonb)
  );
$$;
revoke all on function public.piece_snapshot(public.pieces) from public, anon, authenticated;

-- Who deleted it: the assistant a connector deleted it for (its delete functions say which), or
-- the signed-in student.
create or replace function public.trash_who()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.deleted_by', true), ''),
                  case when auth.uid() is null then 'Claude' else 'you' end);
$$;

-- The connector's deletes name the assistant (the link's label: Claude or ChatGPT), for this
-- request only.
create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform set_config('app.deleted_by', (public.connector_link(token)).label, true);
  perform public.connector_delete_college_unchecked(token, college);
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform set_config('app.deleted_by', (public.connector_link(token)).label, true);
  perform public.connector_delete_piece_unchecked(token, piece);
end;
$$;

create or replace function public.trash_piece()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Going with the whole account, or with its college (whose own entry holds it): no entry.
  if not exists (select 1 from public.desks where id = old.desk_id) then return old; end if;
  if old.college_id is not null and not exists (select 1 from public.colleges where id = old.college_id) then return old; end if;
  insert into public.trash (desk_id, kind, title, detail, data, deleted_by)
  values (old.desk_id, 'piece', old.title,
          coalesce((select name from public.colleges where id = old.college_id), ''),
          public.piece_snapshot(old), public.trash_who());
  delete from public.trash where deleted_at < now() - interval '30 days';
  return old;
end;
$$;
drop trigger if exists pieces_to_trash on public.pieces;
create trigger pieces_to_trash before delete on public.pieces
  for each row execute function public.trash_piece();

create or replace function public.trash_college()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n integer;
  letters jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.desks where id = old.desk_id) then return old; end if;
  select count(*) into n from public.pieces where college_id = old.id;
  -- Letters exist from migration 20261005 on.
  if to_regclass('public.letters') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.letters x where x.college_id = $1'
      into letters using old.id;
  end if;
  insert into public.trash (desk_id, kind, title, detail, data, deleted_by)
  values (old.desk_id, 'college', old.name,
          case when n = 0 then 'no pieces' when n = 1 then '1 piece' else n::text || ' pieces' end,
          jsonb_build_object(
            'college', to_jsonb(old),
            'pieces', coalesce((select jsonb_agg(public.piece_snapshot(p) order by p.sort, p.created_at)
                                  from public.pieces p where p.college_id = old.id), '[]'::jsonb),
            'letters', letters),
          public.trash_who());
  delete from public.trash where deleted_at < now() - interval '30 days';
  return old;
end;
$$;
drop trigger if exists colleges_to_trash on public.colleges;
create trigger colleges_to_trash before delete on public.colleges
  for each row execute function public.trash_college();

-- Put one piece back from its snapshot. Its college may be gone: then it comes back on its own.
create or replace function public.restore_piece(snap jsonb, d uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r jsonb := snap -> 'piece';
  pid uuid := (r ->> 'id')::uuid;
begin
  if exists (select 1 from public.pieces where id = pid) then
    raise exception 'That piece is already on the desk.';
  end if;
  if r ->> 'college_id' is not null
     and not exists (select 1 from public.colleges where id = (r ->> 'college_id')::uuid and desk_id = d) then
    if exists (select 1 from public.trash t
                where t.desk_id = d and t.kind = 'college' and t.data -> 'college' ->> 'id' = r ->> 'college_id') then
      raise exception 'Its college is in the Trash too. Restore the college first, then this piece.';
    end if;
    r := jsonb_set(r, '{college_id}', 'null'::jsonb);
  end if;
  if r ->> 'variant_of' is not null and not exists (select 1 from public.pieces where id = (r ->> 'variant_of')::uuid) then
    r := jsonb_set(r, '{variant_of}', 'null'::jsonb);
  end if;
  r := jsonb_set(r, '{desk_id}', to_jsonb(d));
  insert into public.pieces select * from jsonb_populate_record(null::public.pieces, r);
  insert into public.piece_updates (piece_id, client_id, "update", created_at)
    select pid, x.client_id, x."update", x.created_at
      from jsonb_to_recordset(coalesce(snap -> 'updates', '[]'::jsonb)) as x(client_id text, "update" text, created_at timestamptz);
  insert into public.piece_versions
    select * from jsonb_populate_recordset(null::public.piece_versions, coalesce(snap -> 'versions', '[]'::jsonb));
  insert into public.suggestions
    select s.* from jsonb_populate_recordset(null::public.suggestions, coalesce(snap -> 'suggestions', '[]'::jsonb)) s
     where exists (select 1 from auth.users u where u.id = s.author_id);
  insert into public.desk_requests
    select q.* from jsonb_populate_recordset(null::public.desk_requests, coalesce(snap -> 'requests', '[]'::jsonb)) q
  on conflict (id) do nothing;
  return pid;
end;
$$;
revoke all on function public.restore_piece(jsonb, uuid) from public, anon, authenticated;

-- Restore something from the student's Trash. Returns {kind, id} of what came back.
create or replace function public.restore_trash(item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.trash;
  c jsonb;
  cid uuid;
  pid uuid;
  p jsonb;
begin
  select * into t from public.trash where id = item for update;
  if not found or t.deleted_at < now() - interval '30 days' or not public.is_desk_owner(t.desk_id) then
    raise exception 'That isn''t in your Trash any more.';
  end if;
  if t.kind = 'college' then
    c := jsonb_set(t.data -> 'college', '{desk_id}', to_jsonb(t.desk_id));
    cid := (c ->> 'id')::uuid;
    if exists (select 1 from public.colleges where id = cid) then
      raise exception 'That college is already on the desk.';
    end if;
    insert into public.colleges select * from jsonb_populate_record(null::public.colleges, c);
    for p in select * from jsonb_array_elements(coalesce(t.data -> 'pieces', '[]'::jsonb)) loop
      perform public.restore_piece(p, t.desk_id);
    end loop;
    if to_regclass('public.letters') is not null then
      execute 'insert into public.letters
                 select x.* from jsonb_populate_recordset(null::public.letters, $1) x
                  where exists (select 1 from public.recommenders r where r.id = x.recommender_id and r.desk_id = $2)
               on conflict do nothing'
        using coalesce(t.data -> 'letters', '[]'::jsonb), t.desk_id;
    end if;
  else
    pid := public.restore_piece(t.data, t.desk_id);
  end if;
  delete from public.trash where id = t.id;
  return jsonb_build_object('kind', t.kind, 'id', coalesce(cid, pid));
end;
$$;
revoke all on function public.restore_trash(uuid) from public, anon;
grant execute on function public.restore_trash(uuid) to authenticated;

-- Empty what's past 30 days every night, whether or not anyone deletes anything (where the
-- database has pg_cron; otherwise it's emptied as the Trash is used).
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('empty-trash', '17 3 * * *', $job$delete from public.trash where deleted_at < now() - interval '30 days'$job$);
exception when others then
  raise notice 'pg_cron is not available here; the Trash is emptied as it is used.';
end;
$$;
$m20261008000000$;
    insert into average_app.migrations (version, name) values ('20261008000000', '20261008000000_trash');
    applied := applied + 1;
    raise notice 'Applied %', '20261008000000_trash' || case when late[16] then ' (it had been skipped)' else '' end;
  end if;

  if not have[17] then
    execute $m20261009000000$
-- Signing in with an emailed code or with Google.
--
-- Braxton's call (9/24/26, team request 18): students sign in with a 6-digit code emailed to them,
-- or with Google, instead of a password. A student who starts with Google gets their first name
-- from their Google account.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  -- Anonymous visitors (parents on a link) get no desk of their own.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, display_name)
    values (new.id, left(coalesce(
      nullif(btrim(m ->> 'display_name'), ''),
      nullif(btrim(m ->> 'given_name'), ''),
      nullif(split_part(btrim(coalesce(m ->> 'full_name', m ->> 'name', '')), ' ', 1), ''),
      ''), 80));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

-- With codes, anyone could sign up with a student's email and a password before the student ever
-- arrives, then keep using that password once the student confirms the account with a code or
-- Google. A password set while the email was unconfirmed is dropped the moment it's confirmed.
-- (Confirm email must be on for this to hold: docs/sign-in.md.)
create or replace function public.forget_unconfirmed_password()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;
drop trigger if exists forget_unconfirmed_password on auth.users;
create trigger forget_unconfirmed_password
  before update of email_confirmed_at on auth.users
  for each row execute function public.forget_unconfirmed_password();
$m20261009000000$;
    insert into average_app.migrations (version, name) values ('20261009000000', '20261009000000_sign_in');
    applied := applied + 1;
    raise notice 'Applied %', '20261009000000_sign_in' || case when late[17] then ' (it had been skipped)' else '' end;
  end if;

  if not have[18] then
    execute $m20261010000000$
-- One password for all of a student's share links.
--
-- Braxton's call (9/24/26): instead of a password per link, the student sets one password (or
-- none) that every share link asks for the first time someone opens it on a device. Each person
-- still gets their own link, so what they can do, and cutting them off, stays per person. Someone
-- already in through their link isn't asked again. A link made earlier with its own password keeps
-- it until the student sets (or turns off) the desk's password, which then covers every link.

-- The hash lives apart from desks, which the people a desk is shared with can read.
create table if not exists public.share_passwords (
  desk_id    uuid primary key references public.desks (id) on delete cascade,
  hash       text not null,
  updated_at timestamptz not null default now()
);
alter table public.share_passwords enable row level security;
drop policy if exists "owner sees whether there is one" on public.share_passwords;
create policy "owner sees whether there is one" on public.share_passwords
  for select using (public.is_desk_owner(desk_id));

-- Set the password (at least 6 characters), or clear it with ''.
create or replace function public.set_share_password(d uuid, pw text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  -- From now on the desk's password is the only one: older links drop their own.
  update public.share_links
     set password_hash = null, failed_attempts = 0, locked_until = null
   where desk_id = d and password_hash is not null;
  if coalesce(pw, '') = '' then
    delete from public.share_passwords where desk_id = d;
    return;
  end if;
  if length(pw) < 6 then raise exception 'Use at least 6 characters for the password.'; end if;
  insert into public.share_passwords (desk_id, hash) values (d, crypt(pw, gen_salt('bf')))
  on conflict (desk_id) do update set hash = excluded.hash, updated_at = now();
end;
$$;
revoke all on function public.set_share_password(uuid, text) from public, anon;
grant execute on function public.set_share_password(uuid, text) to authenticated;

-- The password a link asks for: its own (links made before this), else the desk's; none for
-- someone already in through this very link.
create or replace function public.link_password_hash(l public.share_links)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.desk_members m where m.desk_id = l.desk_id and m.user_id = auth.uid() and m.link_id = l.id)
      then null
    else coalesce(l.password_hash, (select s.hash from public.share_passwords s where s.desk_id = l.desk_id))
  end;
$$;
revoke all on function public.link_password_hash(public.share_links) from public, anon, authenticated;

-- Anyone holding a token: what it opens, without joining.
create or replace function public.link_info(token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  l public.share_links;
  title text;
begin
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then return jsonb_build_object('valid', false); end if;
  select d.title into title from public.desks d where d.id = l.desk_id;
  return jsonb_build_object(
    'valid', true,
    'role', l.role,
    'needs_password', public.link_password_hash(l) is not null,
    'desk_title', title
  );
end;
$$;

-- A signed-in (often anonymous) visitor joins through a link. Returns {ok, desk_id} or
-- {ok:false, error}. Errors are returned, not raised, so failed attempts are counted.
create or replace function public.join_desk(token text, link_password text, name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.share_links;
  h text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong passwords. Try again in a few minutes.');
  end if;
  h := public.link_password_hash(l);
  if h is not null and (link_password is null or crypt(link_password, h) <> h) then
    update public.share_links
       set failed_attempts = case when failed_attempts + 1 >= 10 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' else locked_until end
     where id = l.id;
    return jsonb_build_object('ok', false, 'error', 'Wrong password.');
  end if;
  if public.is_desk_owner(l.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', l.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  update public.share_links set failed_attempts = 0 where id = l.id;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (l.desk_id, auth.uid(), l.id, left(trim(name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', l.desk_id);
end;
$$;
revoke all on function public.join_desk(text, text, text) from public, anon;
grant execute on function public.join_desk(text, text, text) to authenticated;
$m20261010000000$;
    insert into average_app.migrations (version, name) values ('20261010000000', '20261010000000_share_password');
    applied := applied + 1;
    raise notice 'Applied %', '20261010000000_share_password' || case when late[18] then ' (it had been skipped)' else '' end;
  end if;

  if not have[19] then
    execute $m20261011000000$
-- The trigger from 20261009 waits until the site signs in with codes.
--
-- It drops a password when the account's email is confirmed. With passwords still in use, that
-- breaks every new account: Supabase confirms a password sign-up (Confirm email off) or the
-- student's confirmation click (on) right after the password is set, so the student can sign in
-- once and never again. It belongs only to sign-in by code, where no student has a password, so
-- it is switched on with the rest of that (supabase/sign-in-code.sql, docs/sign-in.md). The
-- function stays; nothing calls it until then.
--
-- If 20261009 already ran here, accounts made with a password since then have lost it. While the
-- site still signs in with passwords, this lists them:
--
--   select id, email, created_at from auth.users
--   where not coalesce(is_anonymous, false) and email_confirmed_at is not null
--     and coalesce(encrypted_password, '') = '';
--
-- They get back in with a code once that is on. To let one in sooner with a temporary password:
--
--   update auth.users set encrypted_password = extensions.crypt('<temporary password>', extensions.gen_salt('bf'))
--   where id = '<id>';

drop trigger if exists forget_unconfirmed_password on auth.users;
$m20261011000000$;
    insert into average_app.migrations (version, name) values ('20261011000000', '20261011000000_password_drop_waits_for_codes');
    applied := applied + 1;
    raise notice 'Applied %', '20261011000000_password_drop_waits_for_codes' || case when late[19] then ' (it had been skipped)' else '' end;
  end if;

  if not have[20] then
    execute $m20261012000000$
-- The site is Average App now (Braxton's call, 9/25/26). Two messages the database hands to the
-- student's assistant, which it passes on to them, named the old one. Same functions otherwise.
-- ("not valid" stays: the counselor and its route look for it.)

create or replace function public.connector_link(token text)
returns public.connector_links language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.connector_links;
begin
  select * into l from public.connector_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'This connector link is not valid. Make a new one in Average App → Settings.'; end if;
  update public.connector_links set last_used_at = now()
   where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return l;
end;
$$;
revoke all on function public.connector_link(text) from public, anon, authenticated;

create or replace function public.connector_allow(token text, what text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  if what = 'manage' and not l.can_manage then
    raise exception 'The student hasn''t allowed % to add, change or remove colleges and pieces (details, prompts, limits, due dates). Tell them what you would change; they can allow it in Average App → Settings.', l.label;
  elsif what = 'edit' and l.essay_access <> 'edit' then
    raise exception 'The student hasn''t allowed % to change essay text directly.%', l.label,
      case when l.essay_access = 'suggest' then ' Use suggest_edits instead: the changes wait for them to accept.' else ' Give advice in your answer instead.' end;
  elsif what = 'suggest' and l.essay_access = 'read' then
    raise exception 'The student has allowed % to read their essays but not to suggest edits. Give advice in your answer instead.', l.label;
  end if;
end;
$$;
revoke all on function public.connector_allow(text, text) from public, anon, authenticated;
$m20261012000000$;
    insert into average_app.migrations (version, name) values ('20261012000000', '20261012000000_average_app_name');
    applied := applied + 1;
    raise notice 'Applied %', '20261012000000_average_app_name' || case when late[20] then ' (it had been skipped)' else '' end;
  end if;

  if not have[21] then
    execute $m20261013000000$
-- Sharing by desk name and password.
--
-- Braxton's call (9/26/26): instead of a link for each person, the student gives the desk a name
-- and sets one password, and anyone who has both opens the desk from the home page. What they may
-- do is one setting for everyone who comes in that way, kept on a share link of its own
-- (via_password): changing it, or turning sharing off, reaches all of them at once, and the student
-- can still remove one person. Links made before keep working, and the same password covers them.

-- The name lives with the password, which only the student can read: the desk row itself is
-- readable by everyone it's shared with, links included. 3 to 40 lowercase letters, digits and
-- dashes, unique; null when sharing by name is off.
alter table public.share_passwords add column if not exists share_name text
  check (share_name is null or share_name ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists share_passwords_share_name on public.share_passwords (share_name);

-- The one link everyone who comes in with the name and password belongs to.
alter table public.share_links add column if not exists via_password boolean not null default false;
create unique index if not exists share_links_one_password on public.share_links (desk_id) where via_password;

-- Wrong tries, to slow down guessing: counted for each visitor across every name (so one person
-- can't lock a desk for everyone), and for each desk (so many visitors can't guess together).
create table if not exists public.share_join_failures (
  user_id uuid not null,
  desk_id uuid references public.desks (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists share_join_failures_user on public.share_join_failures (user_id, at);
create index if not exists share_join_failures_desk on public.share_join_failures (desk_id, at);
alter table public.share_join_failures enable row level security;

-- Turn sharing by name on, or change it: the name, the password (blank keeps the one set) and what
-- people who come in with them may do. Returns {ok} or {ok:false, error}.
create or replace function public.set_desk_sharing(d uuid, desk_name text, pw text, r text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  pw_link uuid;
  pw_revoked timestamptz;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if r not in ('view', 'suggest', 'edit') then raise exception 'Unknown role.'; end if;
  if n !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    return jsonb_build_object('ok', false, 'error', 'Use 3 to 40 letters, numbers or dashes for the desk name, starting with a letter or number.');
  end if;
  if exists (select 1 from public.share_passwords where share_name = n and desk_id <> d) then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end if;
  if coalesce(pw, '') <> '' and length(pw) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Use at least 8 characters for the password.');
  end if;
  if coalesce(pw, '') = '' and not exists (select 1 from public.share_passwords where desk_id = d) then
    return jsonb_build_object('ok', false, 'error', 'Set a password.');
  end if;
  if coalesce(pw, '') <> '' then perform public.set_share_password(d, pw); end if;
  begin
    update public.share_passwords set share_name = n where desk_id = d;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end;
  -- Saving is also how the student lifts a lock someone put on the desk by guessing.
  delete from public.share_join_failures where desk_id = d;
  select id, revoked_at into pw_link, pw_revoked from public.share_links where desk_id = d and via_password for update;
  if pw_link is null then
    insert into public.share_links (desk_id, token_hash, role, label, via_password)
    values (d, encode(gen_random_bytes(32), 'hex'), r, 'Desk name and password', true);
  else
    -- Turned off before: nobody who was in then comes back without the name and password.
    if pw_revoked is not null then delete from public.desk_members where link_id = pw_link; end if;
    update public.share_links set role = r, revoked_at = null where id = pw_link;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_desk_sharing(uuid, text, text, text) from public, anon;
grant execute on function public.set_desk_sharing(uuid, text, text, text) to authenticated;

-- Turn it off: the name stops working, and everyone who came in with it is removed. The password
-- stays, for the student's links.
create or replace function public.stop_desk_sharing(d uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  delete from public.desk_members m using public.share_links l
   where l.id = m.link_id and l.desk_id = d and l.via_password;
  update public.share_links set revoked_at = now() where desk_id = d and via_password and revoked_at is null;
  update public.share_passwords set share_name = null where desk_id = d;
end;
$$;
revoke all on function public.stop_desk_sharing(uuid) from public, anon;
grant execute on function public.stop_desk_sharing(uuid) to authenticated;

-- A signed-in (often anonymous) visitor opens a desk by its name and password. Returns
-- {ok, desk_id} or {ok:false, error}. A wrong name and a wrong password get the same answer, and
-- take as long. Ten wrong tries in 15 minutes stop a visitor; a hundred in an hour stop a desk.
create or replace function public.join_desk_by_name(desk_name text, pw text, member_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  me uuid := auth.uid();
  s public.share_passwords;
  pw_link uuid;
  nope constant jsonb := jsonb_build_object('ok', false, 'error', 'That desk name and password don''t match.');
  slow constant jsonb := jsonb_build_object('ok', false, 'error', 'Too many tries. Wait a few minutes and try again.');
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  delete from public.share_join_failures where at < now() - interval '1 day';
  if (select count(*) from public.share_join_failures where user_id = me and at > now() - interval '15 minutes') >= 10 then
    return slow;
  end if;
  select * into s from public.share_passwords where share_name = n;
  if s.desk_id is not null then
    select id into pw_link from public.share_links where desk_id = s.desk_id and via_password and revoked_at is null;
    if (select count(*) from public.share_join_failures where desk_id = s.desk_id and at > now() - interval '1 hour') >= 100 then
      return slow;
    end if;
  end if;
  if s.desk_id is null or pw_link is null then
    perform crypt(coalesce(pw, ''), gen_salt('bf'));
    insert into public.share_join_failures (user_id) values (me);
    return nope;
  end if;
  if pw is null or crypt(pw, s.hash) <> s.hash then
    insert into public.share_join_failures (user_id, desk_id) values (me, s.desk_id);
    return nope;
  end if;
  if public.is_desk_owner(s.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', s.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(member_name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (s.desk_id, me, pw_link, left(trim(member_name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', s.desk_id);
end;
$$;
revoke all on function public.join_desk_by_name(text, text, text) from public, anon;
grant execute on function public.join_desk_by_name(text, text, text) to authenticated;
$m20261013000000$;
    insert into average_app.migrations (version, name) values ('20261013000000', '20261013000000_share_by_name');
    applied := applied + 1;
    raise notice 'Applied %', '20261013000000_share_by_name' || case when late[21] then ' (it had been skipped)' else '' end;
  end if;

  if not have[22] then
    execute $m20261014000000$
-- Sharing by name: fixes from review.
--
-- 1. A desk that many wrong tries have stopped still lets in a visitor who hasn't got anything
--    wrong: otherwise one person with a stack of throwaway sessions could keep the right password
--    out for as long as they liked. A guesser gets one try per fresh session while it lasts.
-- 2. The student is told when someone has been guessing (desk_share_guesses), so they can change
--    the name, the lasting fix.
-- 3. A name that turns out to be taken no longer saves the new password anyway.

create or replace function public.set_desk_sharing(d uuid, desk_name text, pw text, r text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  pw_link uuid;
  pw_revoked timestamptz;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if r not in ('view', 'suggest', 'edit') then raise exception 'Unknown role.'; end if;
  if n !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    return jsonb_build_object('ok', false, 'error', 'Use 3 to 40 letters, numbers or dashes for the desk name, starting with a letter or number.');
  end if;
  if exists (select 1 from public.share_passwords where share_name = n and desk_id <> d) then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end if;
  if coalesce(pw, '') <> '' and length(pw) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Use at least 8 characters for the password.');
  end if;
  if coalesce(pw, '') = '' and not exists (select 1 from public.share_passwords where desk_id = d) then
    return jsonb_build_object('ok', false, 'error', 'Set a password.');
  end if;
  -- Together, so a name taken in the meantime leaves the password as it was too.
  begin
    if coalesce(pw, '') <> '' then perform public.set_share_password(d, pw); end if;
    update public.share_passwords set share_name = n where desk_id = d;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end;
  -- Saving is also how the student lifts a stop someone put on the desk by guessing.
  delete from public.share_join_failures where desk_id = d;
  select id, revoked_at into pw_link, pw_revoked from public.share_links where desk_id = d and via_password for update;
  if pw_link is null then
    insert into public.share_links (desk_id, token_hash, role, label, via_password)
    values (d, encode(gen_random_bytes(32), 'hex'), r, 'Desk name and password', true);
  else
    -- Turned off before: nobody who was in then comes back without the name and password.
    if pw_revoked is not null then delete from public.desk_members where link_id = pw_link; end if;
    update public.share_links set role = r, revoked_at = null where id = pw_link;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- A signed-in (often anonymous) visitor opens a desk by its name and password. Returns
-- {ok, desk_id} or {ok:false, error}. A wrong name and a wrong password get the same answer, and
-- take as long. Ten wrong tries in 15 minutes stop a visitor. A hundred in an hour on one desk stop
-- anyone who has got one wrong in that hour from trying it again, but not someone new.
create or replace function public.join_desk_by_name(desk_name text, pw text, member_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  me uuid := auth.uid();
  s public.share_passwords;
  pw_link uuid;
  nope constant jsonb := jsonb_build_object('ok', false, 'error', 'That desk name and password don''t match.');
  slow constant jsonb := jsonb_build_object('ok', false, 'error', 'Too many tries. Wait a while and try again.');
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  delete from public.share_join_failures where at < now() - interval '1 day';
  if (select count(*) from public.share_join_failures where user_id = me and at > now() - interval '15 minutes') >= 10 then
    return slow;
  end if;
  select * into s from public.share_passwords where share_name = n;
  if s.desk_id is not null then
    select id into pw_link from public.share_links where desk_id = s.desk_id and via_password and revoked_at is null;
    if (select count(*) from public.share_join_failures where desk_id = s.desk_id and at > now() - interval '1 hour') >= 100
       and exists (select 1 from public.share_join_failures where user_id = me and at > now() - interval '1 hour') then
      return slow;
    end if;
  end if;
  if s.desk_id is null or pw_link is null then
    perform crypt(coalesce(pw, ''), gen_salt('bf'));
    insert into public.share_join_failures (user_id) values (me);
    return nope;
  end if;
  if pw is null or crypt(pw, s.hash) <> s.hash then
    insert into public.share_join_failures (user_id, desk_id) values (me, s.desk_id);
    return nope;
  end if;
  if public.is_desk_owner(s.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', s.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(member_name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (s.desk_id, me, pw_link, left(trim(member_name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', s.desk_id);
end;
$$;

-- How many wrong passwords have been tried on the student's desk by its name in the last day
-- (since they last saved their sharing settings).
create or replace function public.desk_share_guesses(d uuid)
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  return (select count(*) from public.share_join_failures where desk_id = d and at > now() - interval '1 day');
end;
$$;
revoke all on function public.desk_share_guesses(uuid) from public, anon;
grant execute on function public.desk_share_guesses(uuid) to authenticated;
$m20261014000000$;
    insert into average_app.migrations (version, name) values ('20261014000000', '20261014000000_share_join_limits');
    applied := applied + 1;
    raise notice 'Applied %', '20261014000000_share_join_limits' || case when late[22] then ' (it had been skipped)' else '' end;
  end if;

  if not have[23] then
    execute $m20261015000000$
-- Files in the student's profile folder.
--
-- Braxton's call (9/26/26): the Profile page is a folder. Next to the notes (profile_sections),
-- the student can upload any file, such as a school's PDF form, for the counselor to read and fill
-- in. Files are kept in the database rather than file storage: the counselor reaches a desk only
-- through its connector token (it holds no storage key), and deleting the account deletes them
-- with everything else. Up to 5 MB each, 25 MB a desk.

create table if not exists public.profile_files (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  name       text not null check (length(name) between 1 and 200),
  mime       text not null default 'application/octet-stream' check (length(mime) <= 120),
  size       int not null check (size > 0 and size <= 5242880),
  -- '' when the student added it, else the assistant's label (a form it filled in).
  added_by   text not null default '' check (length(added_by) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists profile_files_desk on public.profile_files (desk_id, created_at);

-- The bytes, apart, so listing files (and live updates about them) never carries them.
create table if not exists public.profile_file_data (
  file_id uuid primary key references public.profile_files (id) on delete cascade,
  data    bytea not null
);

alter table public.profile_files enable row level security;
alter table public.profile_file_data enable row level security;
drop policy if exists "owner sees files" on public.profile_files;
create policy "owner sees files" on public.profile_files for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner deletes files" on public.profile_files;
create policy "owner deletes files" on public.profile_files for delete using (public.is_desk_owner(desk_id));
-- No policies on profile_file_data: its bytes come and go only through the functions below.

-- The Profile page follows the list live (a form the counselor filled in shows at once).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profile_files') then
    alter publication supabase_realtime add table public.profile_files;
  end if;
end;
$$;

-- Store a file on a desk, checking its size and the desk's room. Shared by the student's upload
-- and the connector.
create or replace function public.store_profile_file(d uuid, file_name text, file_mime text, b64 text, who text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  bytes bytea;
  new_id uuid;
begin
  bytes := decode(coalesce(b64, ''), 'base64');
  if length(bytes) = 0 then raise exception 'That file is empty.'; end if;
  if length(bytes) > 5242880 then raise exception 'That file is over 5 MB.'; end if;
  -- One upload at a time per desk, so two at once can't both fit under the limit.
  perform 1 from public.desks where id = d for update;
  if coalesce((select sum(size) from public.profile_files where desk_id = d), 0) + length(bytes) > 26214400 then
    raise exception 'Your files are full (25 MB). Delete some first.';
  end if;
  insert into public.profile_files (desk_id, name, mime, size, added_by)
  values (d, left(coalesce(nullif(trim(file_name), ''), 'Untitled'), 200), left(coalesce(nullif(trim(file_mime), ''), 'application/octet-stream'), 120), length(bytes), left(coalesce(who, ''), 80))
  returning profile_files.id into new_id;
  insert into public.profile_file_data (file_id, data) values (new_id, bytes);
  return new_id;
end;
$$;
revoke all on function public.store_profile_file(uuid, text, text, text, text) from public, anon, authenticated;

-- The student uploads a file.
create or replace function public.add_profile_file(d uuid, file_name text, file_mime text, b64 text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  return public.store_profile_file(d, file_name, file_mime, b64, '');
end;
$$;
revoke all on function public.add_profile_file(uuid, text, text, text) from public, anon;
grant execute on function public.add_profile_file(uuid, text, text, text) to authenticated;

-- The student opens (or downloads) one: {name, mime, b64}.
create or replace function public.profile_file_content(f uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pf public.profile_files;
begin
  select * into pf from public.profile_files where id = f;
  if not found or not public.is_desk_owner(pf.desk_id) then raise exception 'not allowed'; end if;
  return jsonb_build_object('name', pf.name, 'mime', pf.mime,
    'b64', (select replace(encode(data, 'base64'), chr(10), '') from public.profile_file_data where file_id = f));
end;
$$;
revoke all on function public.profile_file_content(uuid) from public, anon;
grant execute on function public.profile_file_content(uuid) to authenticated;

-- The connector: list, read and add files (the profile is always open to the student's assistant).
-- Not stable: connector_link notes when the link was used, which a read-only call can't do.
create or replace function public.connector_profile_files(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mime', mime, 'size', size, 'added_by', added_by, 'created_at', created_at) order by created_at)
    from public.profile_files where desk_id = l.desk_id), '[]'::jsonb);
end;
$$;

create or replace function public.connector_profile_file(token text, f uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  pf public.profile_files;
begin
  select * into pf from public.profile_files where id = f and desk_id = l.desk_id;
  if not found then raise exception 'No file with that file_id on this desk: call read_profile for the list.'; end if;
  return jsonb_build_object('name', pf.name, 'mime', pf.mime, 'size', pf.size,
    'b64', (select replace(encode(data, 'base64'), chr(10), '') from public.profile_file_data where file_id = f));
end;
$$;

create or replace function public.connector_add_profile_file(token text, file_name text, file_mime text, b64 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return public.store_profile_file(l.desk_id, file_name, file_mime, b64, l.label);
end;
$$;

revoke all on function public.connector_profile_files(text) from public;
revoke all on function public.connector_profile_file(text, uuid) from public;
revoke all on function public.connector_add_profile_file(text, text, text, text) from public;
grant execute on function public.connector_profile_files(text) to anon, authenticated;
grant execute on function public.connector_profile_file(text, uuid) to anon, authenticated;
grant execute on function public.connector_add_profile_file(text, text, text, text) to anon, authenticated;
$m20261015000000$;
    insert into average_app.migrations (version, name) values ('20261015000000', '20261015000000_profile_files');
    applied := applied + 1;
    raise notice 'Applied %', '20261015000000_profile_files' || case when late[23] then ' (it had been skipped)' else '' end;
  end if;

  if not have[24] then
    execute $m20261016000000$
-- Where everyone is on a desk.
--
-- Braxton's call (9/26/26): the Write page's list of colleges and pieces shows where the people
-- working on the desk are. Each open piece says so on a private channel for its desk
-- ("desk:<id>"), which only people who can read the desk may join, like the channel each piece
-- already has for cursors. The same check covers both.

create or replace function public.can_use_piece_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic ~ '^piece:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_read_desk(public.piece_desk(substring(topic from 7)::uuid));
  end if;
  if topic ~ '^desk:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_read_desk(substring(topic from 6)::uuid);
  end if;
  return false;
end;
$$;
$m20261016000000$;
    insert into average_app.migrations (version, name) values ('20261016000000', '20261016000000_desk_presence');
    applied := applied + 1;
    raise notice 'Applied %', '20261016000000_desk_presence' || case when late[24] then ' (it had been skipped)' else '' end;
  end if;

  if not have[25] then
    execute $m20261017000000$
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
$m20261017000000$;
    insert into average_app.migrations (version, name) values ('20261017000000', '20261017000000_counselor_computers');
    applied := applied + 1;
    raise notice 'Applied %', '20261017000000_counselor_computers' || case when late[25] then ' (it had been skipped)' else '' end;
  end if;

  if not have[26] then
    execute $m20261018000000$
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
$m20261018000000$;
    insert into average_app.migrations (version, name) values ('20261018000000', '20261018000000_counselor_computers_fixes');
    applied := applied + 1;
    raise notice 'Applied %', '20261018000000_counselor_computers_fixes' || case when late[26] then ' (it had been skipped)' else '' end;
  end if;

  if not have[27] then
    execute $m20261019000000$
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
$m20261019000000$;
    insert into average_app.migrations (version, name) values ('20261019000000', '20261019000000_shared_ask');
    applied := applied + 1;
    raise notice 'Applied %', '20261019000000_shared_ask' || case when late[27] then ' (it had been skipped)' else '' end;
  end if;

  if not have[28] then
    execute $m20261020000000$
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
$m20261020000000$;
    insert into average_app.migrations (version, name) values ('20261020000000', '20261020000000_shared_ask_fixes');
    applied := applied + 1;
    raise notice 'Applied %', '20261020000000_shared_ask_fixes' || case when late[28] then ' (it had been skipped)' else '' end;
  end if;

  if not have[29] then
    execute $m20261021000000$
-- Notes on a piece, written by the people the desk is shared with too.
--
-- Braxton's call (9/29/26): people the desk is shared with who can suggest or edit can change a
-- piece's notes (ideas, reminders, feedback, kept apart from the essay). Everything else about a
-- piece stays the student's, so they save notes through this function, not by writing the piece.

-- Found on the way: for someone who isn't on the desk at all these said null, not false, so a
-- check written "if not ... then raise" let them through (set_piece_text_stats did: anyone signed
-- in who had a piece's id could change its word count and preview text). Always true or false now.
create or replace function public.can_suggest_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or coalesce(public.member_role(d) in ('suggest','edit'), false);
$$;

create or replace function public.can_edit_text(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or coalesce(public.member_role(d) = 'edit', false);
$$;

create or replace function public.set_piece_notes(piece uuid, body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if piece is null or not public.can_suggest_desk(public.piece_desk(piece)) then raise exception 'not allowed'; end if;
  if length(coalesce(body, '')) > 20000 then raise exception 'Notes hold at most 20,000 characters.'; end if;
  update public.pieces set notes = coalesce(body, '') where id = piece;
end;
$$;
revoke all on function public.set_piece_notes(uuid, text) from public, anon;
grant execute on function public.set_piece_notes(uuid, text) to authenticated;
$m20261021000000$;
    insert into average_app.migrations (version, name) values ('20261021000000', '20261021000000_shared_notes');
    applied := applied + 1;
    raise notice 'Applied %', '20261021000000_shared_notes' || case when late[29] then ' (it had been skipped)' else '' end;
  end if;

  if not have[30] then
    execute $m20261022000000$
-- Comments on highlighted words.
--
-- Braxton's call (9/29/26): anyone who can suggest on a desk (the student, and people with suggest
-- or edit access) can highlight words in an essay and leave a comment on them. A comment is a
-- suggestion of its own kind: anchored to the words the same way, shown in the margin and live for
-- everyone, and resolved by the student; it changes nothing in the text. Its author can delete it
-- while it's open, as with any suggestion.

alter table public.suggestions drop constraint if exists suggestions_kind_check;
alter table public.suggestions add constraint suggestions_kind_check check (kind in ('insert', 'delete', 'replace', 'comment'));
$m20261022000000$;
    insert into average_app.migrations (version, name) values ('20261022000000', '20261022000000_comments');
    applied := applied + 1;
    raise notice 'Applied %', '20261022000000_comments' || case when late[30] then ' (it had been skipped)' else '' end;
  end if;

  if applied = 0 then
    raise notice 'Your database is up to date: nothing to do.';
  else
    raise notice 'Done: applied % migration(s).', applied;
  end if;
end
$setup$;

select version, name, applied_at from average_app.migrations order by version;
