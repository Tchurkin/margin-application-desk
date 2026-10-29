-- People a desk is shared with can ask for a piece's rating.
--
-- Braxton's call (10/28/26): anyone the student shares with, viewers included, can press Rate this
-- piece. The request is the student's own kind (no guest's words in it: its text is fixed here), so
-- the counselor rates it with its tools as if the student had asked; the rating shows for everyone.

-- Ask for a rating of one piece, as someone the desk is shared with. Returns when it was asked.
create or replace function public.rate_on_shared_desk(piece uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(piece);
  waiting timestamptz;
  made timestamptz;
begin
  if d is null or auth.uid() is null or not public.can_read_desk(d) then raise exception 'not allowed'; end if;
  if not public.desk_counselor_on(d) then
    raise exception 'The student''s counselor isn''t on right now, so nobody would rate it. Try again once their computer is on.';
  end if;
  perform pg_advisory_xact_lock(hashtext('rate_on_shared_desk'), hashtext(d::text));
  -- One at a time per piece: a second press waits on the first.
  select created_at into waiting from public.desk_requests
   where piece_id = piece and kind = 'rate' and status = 'pending' order by created_at desc limit 1;
  if waiting is not null then return waiting; end if;
  if (select count(*) from public.desk_requests where desk_id = d and kind = 'rate' and piece_id is not null
        and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'That''s 30 ratings asked for on this desk this hour. Try again a little later.';
  end if;
  insert into public.desk_requests (desk_id, piece_id, kind, prompt)
  values (d, piece, 'rate', 'Rate this piece.')
  returning created_at into made;
  return made;
end;
$$;
revoke all on function public.rate_on_shared_desk(uuid) from public, anon;
grant execute on function public.rate_on_shared_desk(uuid) to authenticated;

-- Whether a rating of this piece is on its way (the people it's shared with can't read the queue).
create or replace function public.piece_rating_pending(piece uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_read_desk(public.piece_desk(piece)) and exists (
    select 1 from public.desk_requests r where r.piece_id = piece and r.kind = 'rate' and r.status = 'pending');
$$;
revoke all on function public.piece_rating_pending(uuid) from public, anon;
grant execute on function public.piece_rating_pending(uuid) to authenticated;
