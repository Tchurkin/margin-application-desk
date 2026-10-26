-- Ratings: the counselor's estimate of where each piece stands.
--
-- Braxton's call (10/26/26, team request 24): a "Rate my essays" button on the board asks the
-- counselor to rate every piece: a percentile (0 to 100) against other applicants to that college
-- on that prompt, with a one-line reason. The board can color its cards by rating instead of by
-- stage. Every college's pieces are rated: a rating is feedback, not AI writing (his call too).
--
-- A rating keeps a fingerprint of the text it rated, so a piece edited since shows it as stale.

alter table public.pieces add column if not exists rating smallint check (rating between 0 and 100);
alter table public.pieces add column if not exists rating_reason text not null default '' check (length(rating_reason) <= 1000);
alter table public.pieces add column if not exists rated_at timestamptz;
alter table public.pieces add column if not exists rated_by text not null default '' check (length(rated_by) <= 80);
alter table public.pieces add column if not exists rated_text_md5 text;
alter table public.pieces add column if not exists rating_stale boolean
  generated always as (rating is not null and rated_text_md5 is distinct from md5(plain_text)) stored;

alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check
  check (kind in ('ask','polish','odds','interview','chat','transcript','rate'));

-- ratings: [{piece_id, percentile, reason}]. Always allowed, like odds: it changes no writing.
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
       set rating = pct, rating_reason = left(coalesce(r ->> 'reason', ''), 1000), rated_at = now(),
           rated_by = l.label, rated_text_md5 = md5(plain_text)
     where id::text = r ->> 'piece_id' and desk_id = l.desk_id;
    if not found then raise exception 'No piece with id % on this desk.', coalesce(r ->> 'piece_id', '(none)'); end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.connector_set_piece_ratings(text, jsonb) from public;
grant execute on function public.connector_set_piece_ratings(text, jsonb) to anon, authenticated;

-- Every rated piece on the desk, for list_my_desk and read_piece.
create or replace function public.connector_piece_ratings(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'rating', p.rating, 'reason', p.rating_reason,
                                        'rated_at', p.rated_at, 'rated_by', p.rated_by, 'stale', p.rating_stale))
      from public.pieces p where p.desk_id = l.desk_id and p.rating is not null), '[]'::jsonb);
end;
$$;
revoke all on function public.connector_piece_ratings(text) from public;
grant execute on function public.connector_piece_ratings(text) to anon, authenticated;
