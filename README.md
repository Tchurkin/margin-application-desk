# Average App

A free, open-source place for a high school senior to write every college essay and short
answer: one desk, every college, every prompt, a live word count against the limit, and a
version history back to the first draft.

Parents can be invited to read along, suggest edits or edit, and Claude or ChatGPT can work on
the desk as a counselor, on the student's own plan. **The student decides what each person and
each assistant may do**, and every direct change is kept in the piece's history.

> Status: early. Milestones 1 (one student), 2 (parents) and 3 (Claude and ChatGPT as
> counselors) are in place. See [Roadmap](#roadmap).

## What it does today

- **Colleges** with application system (Common App, UC, UCAS, own portal…), round, deadline
  and materials deadline. It warns you past the Common App's 20-college limit and suggests
  which schools to move (the ones that don't need letters).
- **Pieces of writing** per college, or independent (a personal statement): prompt, word or
  character limit, stage (not started → drafting → needs review → final), and live count
  against the limit.
- **One board** for everything: a row per college, most urgent first, with its round, portal,
  deadline and letters under its name and its pieces as cards in four stage columns (drag a
  card, or use the arrow keys). A college's application is submitted all at once, with one
  button: it folds to the bottom, and after a few days it's filed under Submitted.
- **Recommenders**, each in a color of their own, and which colleges each one writes for (not
  asked yet, asked, submitted), added by you or by Claude.
- **Notes** per piece, kept outside the essay and never counted.
- **Version history**: a version about every minute while you write, every one kept for as
  long as the piece. Compare any of them with now, and restore it.
- **The board is home**, and Write reopens the piece you were last on.
- **Sign in with an emailed code** or with Google, no password (once it's set up: see
  [docs/sign-in.md](docs/sign-in.md)).
- **Delete my data** (Settings → Account) removes your account and everything in it.
- **Write, Board and Strategy** pages: a writing workspace with a college rail and tabs, the
  board, and a Strategy page that sorts colleges into reach / target / likely bands by chance
  of admission (an AI estimate, your own, or the college's published rate from the College
  Scorecard).
- **Share links** (Settings → Sharing): read only, can suggest, or can edit, one link per person,
  with one optional password for all of them; change a link's level or revoke it at any time. The person opening it just types
  their name; no account needed.
- **Editing and Suggesting**: you, and anyone on a can-edit link, switch between changing the
  text directly and suggesting. Someone on a can-suggest link types, deletes and pastes
  normally, and it all shows as suggestions you accept or decline. Ctrl+Z undoes their last
  burst; you can undo an accept or decline. The database enforces who may change the text.
- **Live**: edits, suggestions and everyone's cursor (with their name) appear as they happen.
- **Claude and ChatGPT as counselors** (Settings → Claude & ChatGPT): a secret
  connector link turns Average App into a connector (an MCP server) for Claude (any
  plan, including free) or ChatGPT (Plus and up, developer mode). Depending on what you allow
  for that link, the assistant reads, suggests edits, or writes directly (your text is saved
  in History first), and can set up and manage your colleges and pieces, with every prompt,
  word limit and due date. It runs on your own plan, so there's no API key and no per-token
  bill.
- **Ask from the desk**: questions, "polish this passage" and odds estimates are asked on the
  website and answered there, by a Claude or ChatGPT chat told to "Watch my Average App",
  or by the **counselor**: a one-file setup for Windows or Mac that runs Claude Code in the background on your own
  computer. It keeps one Claude session warm, gets each request with the essay or college list
  it's about, and streams its answer onto the page as it writes.
- **Import from Google Docs** (Board → Import essays): pick docs from Google Drive (a doc per
  essay, or one doc with a tab per essay), or upload Word files or a whole Drive folder
  downloaded as a .zip. Each essay is matched to its college and piece before anything is
  imported. Direct Drive import needs a free Google Cloud project: see
  [docs/google-import.md](docs/google-import.md).
- **Counselor page**: talk to the counselor, choosing its model and how hard it thinks right in
  the message box. Pause it, update it or remove it from your computer in Settings → Counselor.
- **Profile**: your academics (GPA, test scores, intended major, class rank, coursework), and
  sections about you (activities, stories, values, goals) that you write or that Claude writes
  while interviewing you, one question at a time. Paste your transcript and the counselor
  fills in your academics. Claude reads your profile before helping with any essay.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20.9 or newer, and either Docker (to run the database
locally) or a free [Supabase](https://supabase.com) project.

```bash
git clone https://github.com/Tchurkin/margin-application-desk.git
cd margin-application-desk
npm install
cp .env.example .env.local
```

**Database, option A: local (needs Docker).**

```bash
npx supabase start          # prints an API URL and a publishable key
```

Put those two values in `.env.local`.

**Database, option B: a free hosted Supabase project.**

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the project URL and publishable key (Project Settings → API) into `.env.local`.
3. Apply the schema: paste all of [`supabase/setup.sql`](supabase/setup.sql) into the SQL Editor
   and run it. It applies whatever migrations the database doesn't have yet, so run it again
   after every update; when nothing is missing it changes nothing. (Or use the CLI:
   `npx supabase link --project-ref <your-ref>` then `npx supabase db push`.)
4. For a quick start, turn off Authentication → Sign In / Providers → Email → **Confirm
   email**, or set up SMTP. Supabase's built-in email is rate-limited to a few messages an hour.
5. For share links, turn on Authentication → Sign In / Providers → **Allow anonymous
   sign-ins** (parents join with just a name).

Then:

```bash
npm run dev                 # http://localhost:3000
```

## Tests

```bash
npm test                    # unit tests: counts, the board, the sync engine, suggestions
npm run test:e2e            # browser tests; needs the local Supabase from option A
```

CI runs lint, types, unit tests, a secret scan, and the browser tests against a local
Supabase on every push.

## How saving works

Each piece is a [Yjs](https://yjs.dev) document edited with [TipTap](https://tiptap.dev).
Every browser tab appends only its own edits to an append-only log (`piece_updates`), and Yjs
merges any set of edits, in any order and with duplicates, into the same document. There is
no read-modify-write, so there is no "last save wins".

Edits are parked in the browser's local storage the moment they happen and cleared only once
the server has them, so a reload, a crash, or leaving a piece right after typing replays
them on the next load instead of losing them. A deleted piece refuses late writes (the
foreign key is gone), so it can't come back as a ghost. See `src/lib/sync/`.

## Privacy

These are minors' essays.

- Every table has row-level security; a student can only ever read their own desk.
- No analytics, and nothing logs essay text.
- Nothing goes to an AI unless the student makes a connector link or copies a piece. A
  connector link can be revoked at any time, and only a hash of it is stored.
- **Delete my data** really deletes.

## Roadmap

1. ✅ One student, working alone.
2. ✅ Parents: share links (view or suggest, optional password, revocable), suggestions / track
   changes the student accepts or declines, live cursors.
3. ✅ Claude and ChatGPT as counselors, through a connector on the student's own plan, with
   per-link permissions; questions from the website; a counselor on the student's computer; a
   profile and interview; no invented facts (in the connector's instructions).
4. Polish: tabs side by side, a second version of a piece with compare, a five-minute setup.

## License

[MIT](LICENSE)
