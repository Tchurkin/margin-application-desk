-- Comments on highlighted words.
--
-- Braxton's call (9/29/26): anyone who can suggest on a desk (the student, and people with suggest
-- or edit access) can highlight words in an essay and leave a comment on them. A comment is a
-- suggestion of its own kind: anchored to the words the same way, shown in the margin and live for
-- everyone, and resolved by the student; it changes nothing in the text. Its author can delete it
-- while it's open, as with any suggestion.

alter table public.suggestions drop constraint if exists suggestions_kind_check;
alter table public.suggestions add constraint suggestions_kind_check check (kind in ('insert', 'delete', 'replace', 'comment'));
