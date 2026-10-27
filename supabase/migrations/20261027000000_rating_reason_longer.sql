-- A rating's reason holds the whole analysis: what works, what holds the piece back and the one
-- change that would raise it most, whether it came from Rate my essays or Rate this piece
-- (Braxton's call, 10/26/26). Two to four sentences; up to 2000 characters.

alter table public.pieces drop constraint if exists pieces_rating_reason_check;
alter table public.pieces add constraint pieces_rating_reason_check check (length(rating_reason) <= 2000);

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
       set rating = pct, rating_reason = left(coalesce(r ->> 'reason', ''), 2000), rated_at = now(),
           rated_by = l.label, rated_text_md5 = md5(plain_text)
     where id::text = r ->> 'piece_id' and desk_id = l.desk_id;
    if not found then raise exception 'No piece with id % on this desk.', coalesce(r ->> 'piece_id', '(none)'); end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
