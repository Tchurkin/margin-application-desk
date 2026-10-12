@AGENTS.md

# Average App

Sample data is always invented, with an obviously fake student ("Testy", `@example.test`).
Never commit real essays, names or keys.

## Layout

- `src/lib/domain/`: pure logic (counts, board, Common App cap), unit-tested
- `src/lib/sync/`: Yjs save engine (append-only `piece_updates`, edits parked in localStorage until acked)
- `supabase/migrations/`: schema; RLS on every table through `can_read_desk` / `can_write_desk`
- `e2e/`: Playwright against a local Supabase (needs Docker)

## Commands

`npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run test:e2e`
