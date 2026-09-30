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
