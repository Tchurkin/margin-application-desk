-- Naming a version.
--
-- Braxton's call (10/12/26): the student can save a version by hand from History, and give it a
-- name ("Sent to Mom", "Final before cutting") so it's easy to find among the ones saved as they
-- write. Null when it has none: a Trash snapshot from before this column restores as it was.

alter table public.piece_versions add column if not exists label text check (label is null or length(label) <= 120);
