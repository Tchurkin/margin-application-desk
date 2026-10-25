-- The connector can comment on words, and withdraw what it suggested.
--
-- Braxton's call (10/25/26): Claude (or ChatGPT) on the student's desk can leave comments on the
-- words of an essay, as people can, and take back its own open suggestions and comments. A comment
-- needs the same permission as a suggestion (it goes in the margin for the student to resolve).
-- Withdrawing touches only what this assistant left (an AI suggestion under its name) that the
-- student hasn't resolved yet, and needs no permission: it only takes away.

-- What read_piece shows: each waiting suggestion's id, and whether this assistant left it.
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
      select jsonb_agg(jsonb_build_object('id', s.id, 'author', s.author_name, 'source', s.source, 'kind', s.kind,
                                          'quote', s.quote, 'body', s.body, 'note', s.note,
                                          'mine', s.source = 'ai' and s.author_name = l.label) order by s.created_at)
      from public.suggestions s where s.piece_id = p.id and s.status = 'open'), '[]'::jsonb),
    'student', (select jsonb_build_object('name', pr.display_name, 'about', pr.about)
                  from public.desks d join public.profiles pr on pr.id = d.owner_id where d.id = l.desk_id)
  );
end;
$$;

-- Suggestions and now comments: a comment's text is its body, on the quoted words.
create or replace function public.connector_add_suggestions_unchecked(token text, piece uuid, rows jsonb)
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
    if (r ->> 'kind') not in ('insert','delete','replace','comment') then raise exception 'bad kind'; end if;
    if (r ->> 'kind') = 'comment' and (length(trim(coalesce(r ->> 'body', ''))) = 0 or length(r ->> 'body') > 4000) then
      raise exception 'A comment needs text, at most 4000 characters.';
    end if;
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
revoke all on function public.connector_add_suggestions_unchecked(text, uuid, jsonb) from public, anon, authenticated;

-- Take back this assistant's open suggestions and comments on a piece: the ones named, or all of
-- them when ids is null. Returns how many were withdrawn.
create or replace function public.connector_withdraw_suggestions(token text, piece uuid, ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  n integer;
begin
  if not exists (select 1 from public.pieces where id = piece and desk_id = l.desk_id) then
    raise exception 'No piece with that id on this desk.';
  end if;
  delete from public.suggestions s
   where s.piece_id = piece and s.status = 'open' and s.source = 'ai' and s.author_name = l.label
     and (ids is null or s.id = any (ids));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.connector_withdraw_suggestions(text, uuid, uuid[]) from public;
grant execute on function public.connector_withdraw_suggestions(text, uuid, uuid[]) to anon, authenticated;
