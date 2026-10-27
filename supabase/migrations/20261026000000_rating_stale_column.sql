-- A rating's "edited since" flag as a plain column, kept by a trigger.
--
-- Migration 20261025 made pieces.rating_stale a generated column. The Trash puts a piece back by
-- inserting its whole saved row, and Postgres refuses any value for a generated column, so no
-- deleted piece could be restored. The flag is now an ordinary column the trigger below sets
-- whenever the text or the rating changes, and on every insert (a restored piece included).

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'pieces' and column_name = 'rating_stale' and is_generated = 'ALWAYS') then
    alter table public.pieces alter column rating_stale drop expression;
  end if;
end;
$$;
update public.pieces set rating_stale = false where rating_stale is null;
alter table public.pieces alter column rating_stale set default false;
alter table public.pieces alter column rating_stale set not null;

create or replace function public.pieces_rating_stale()
returns trigger language plpgsql set search_path = public as $$
begin
  new.rating_stale := new.rating is not null and new.rated_text_md5 is distinct from md5(new.plain_text);
  return new;
end;
$$;
drop trigger if exists pieces_rating_stale on public.pieces;
create trigger pieces_rating_stale before insert or update of plain_text, rating, rated_text_md5 on public.pieces
  for each row execute function public.pieces_rating_stale();
