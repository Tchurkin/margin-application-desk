-- Ratings say when a piece sounds AI-written.
--
-- Braxton's call (10/27/26): the counselor checks every piece it rates for writing that sounds
-- AI-generated, and when it can tell, it says so on its own: which lines, and why. The note is kept
-- beside the rating (empty when nothing sounds AI-made) and shown as a warning on the piece, the
-- board and the Files list.

alter table public.pieces add column if not exists rating_ai text not null default '' check (length(rating_ai) <= 2000);

-- ratings: [{piece_id, percentile, reason, sounds_ai}].
create or replace function public.connector_set_piece_ratings(token text, ratings jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  r jsonb;
  pct integer;
  n integer := 0;
begin
  if jsonb_typeof(ratings) <> 'array' or jsonb_array_length(ratings) = 0 or jsonb_array_length(ratings) > 300 then
    raise exception 'Rate between 1 and 300 pieces at a time.';
  end if;
  for r in select * from jsonb_array_elements(ratings) loop
    if jsonb_typeof(r -> 'percentile') <> 'number' or (r ->> 'percentile')::numeric not between 0 and 100 then
      raise exception 'A percentile is a number from 0 to 100 (got %).', coalesce(r ->> 'percentile', 'nothing');
    end if;
    pct := round((r ->> 'percentile')::numeric);
    update public.pieces
       set rating = pct, rating_reason = left(coalesce(r ->> 'reason', ''), 2000),
           rating_ai = left(trim(coalesce(r ->> 'sounds_ai', '')), 2000), rated_at = now(),
           rated_by = l.label, rated_text_md5 = md5(plain_text)
     where id::text = r ->> 'piece_id' and desk_id = l.desk_id;
    if not found then raise exception 'No piece with id % on this desk.', coalesce(r ->> 'piece_id', '(none)'); end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.connector_piece_ratings(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'rating', p.rating, 'reason', p.rating_reason, 'sounds_ai', p.rating_ai,
                                        'rated_at', p.rated_at, 'rated_by', p.rated_by, 'stale', p.rating_stale))
      from public.pieces p where p.desk_id = l.desk_id and p.rating is not null), '[]'::jsonb);
end;
$$;
