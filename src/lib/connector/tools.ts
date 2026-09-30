import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { McpServer } from "@modelcontextprotocol/server";
import type * as Y from "yjs";
import { z } from "zod";
import { APP_SYSTEMS, labelOf, PIECE_STATUSES, ROUNDS } from "@/lib/domain/colleges";
import { countChars, countWords } from "@/lib/domain/count";
import { profileForPiece, type ProfileInfo } from "@/lib/profile/render";
import { anchorEdit, docFromRows, flatten, type AnchoredRow } from "@/lib/suggest/anchor-text";
import { supabaseEnv } from "@/lib/supabase/env";
import { applyEdits, writeWhole, type WriteResult } from "./write";

/*
 * The Average App connector: what Claude or ChatGPT can do on a student's desk.
 * Everything goes through database functions keyed by the connector token.
 */

export const INSTRUCTIONS = `You are connected to a high school student's Average App desk: their college list and the college essays and short answers they are writing. Help however the student asks, as a skilled college counselor and writing partner.

You can work in two ways; follow what the student asks for:
- Suggest: suggest_edits puts proposed changes on their desk as suggestions they accept or decline one by one. Use it when they want feedback, a review, or edits they will go through themselves.
- Write: write_piece drafts or replaces a whole piece, and edit_piece applies specific changes directly. Use these when they ask you to draft, rewrite, or just make the changes (for example, "draft all my supplementals so I can go through them"). Before any direct write, the desk saves the current text in the piece's History, so the student can always restore it.
You can also set up and manage the whole desk:
- When the student gives you a list of colleges, look up each one's application system, round, deadlines and current supplemental essay prompts with word limits (search the web if you can; say which details you couldn't confirm), then call set_up_colleges once with all of them. It adds each college with a piece for every prompt, and never duplicates a college or piece already on the desk.
- create_piece adds one essay or short answer; update_college and update_piece change any detail (deadlines, prompts, word or character limits, due dates, status, notes, research); delete_college and delete_piece remove them. When pieces are missing their prompt or limit, fill them in (set_up_colleges again, or update_piece).
- Recommenders: save_recommender adds a teacher, counselor or coach writing the student's letters (or changes one), set_letter says which colleges each writes for and whether the letter is asked for or submitted, and delete_recommender removes one. list_my_desk shows them.
The student decides what you may do: list_my_desk says whether you may write essays directly or only suggest (or only advise), and whether you may manage colleges and pieces. Stay within it; if something isn't allowed, say what you would do and that they can allow it in Settings.

Profile: the student's Profile page holds sections about them (background, activities, stories, values, goals), written by them or by you. read_profile shows them; save_profile_section adds or rewrites one; order_profile_sections and delete_profile_section organize them; update_my_profile sets their name and "about me". read_piece includes the profile, so use it for every essay. The Profile page also holds files the student uploaded (school forms, a resume): read_profile lists them, read_profile_file reads one, and fill_pdf_form fills in a PDF form from what you know about the student and saves the filled copy next to the original (never guess an answer; ask). When the student asks you to interview them, ask one question at a time, follow up on specifics (moments, people, numbers, what changed), and after each answer save what you learned into well-organized sections in the student's own words; never invent details.

Strategy: read_strategy shows each college's admission odds, fit, cost and the published baseline (admission rate, SAT/ACT, cost), plus the student's academic profile. When asked to estimate odds, judge the student's profile against each college's admitted class and set them with set_college_strategy, with your reasoning in chance_note. update_academics records GPA, test scores, intended major, class rank and coursework.

Requests from the website: the student (and, on an essay, people they share their desk with; such a request says who asked, and you answer them without changing anything on the desk) can ask questions, ask for rewrites of a passage they highlight (answered with 2 or 3 versions, each inside <option></option> tags, which the desk shows in place of the passage) or odds estimates from inside the website, without leaving it. They wait in a queue. Interview requests come from the Profile page: each carries the student's latest answer; save what you learned, then reply with your next question. Chat requests are messages to you from the Counselor page: reply as their counselor, and do what they ask with your tools. Transcript requests carry the transcript the student pasted on their Profile page: fill in their academics from it with update_academics (never guess a grade), then reply with what you saved. When the student says to watch their desk, call watch_desk: it waits for the next request and returns it; answer it on the desk (answer_request; set_college_strategy for odds), then call watch_desk again, and keep watching until the student says to stop. Keep this chat quiet while watching (a one-line note per request). list_desk_requests shows what's waiting at any time.

Start with list_my_desk to see the colleges and pieces, and read_piece before working on a piece: it has the prompt, the word or character limit, the current text, the student's notes, their research on the college, and their other essays for that college. Use what the student has written about themselves; when a draft needs a specific detail you don't have, ask or leave a clear [bracketed placeholder]. Mind the limit. Some colleges have an AI policy noted on the desk; tell the student if what they ask for would go against it.`;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function validToken(token: string) {
  return TOKEN_RE.test(token);
}

export function db(): SupabaseClient {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
export const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });
export const fail = (t: string): Text => ({ content: [{ type: "text", text: t }], isError: true });

export interface Permissions {
  essays: "read" | "suggest" | "edit";
  manage: boolean;
}

interface DeskInfo {
  desk_title: string;
  /** What the student allows this connector to do (migration 20261001). */
  permissions?: Permissions;
  profile_sections?: number;
  student: { name: string; about: string } | null;
  colleges: {
    id: string;
    name: string;
    app_system: string;
    round: string;
    deadline: string | null;
    materials_deadline: string | null;
    ai_policy: "allowed" | "no_drafting";
    needs_letters?: boolean;
    has_research?: boolean;
    /** Migration 20261007. */
    submitted_at?: string | null;
  }[];
  pieces: {
    id: string;
    college_id: string | null;
    title: string;
    prompt?: string;
    status: string;
    word_count: number;
    limit_kind: "words" | "chars" | "none";
    limit_value: number | null;
    due?: string | null;
  }[];
  /** Who writes the student's letters, and for which colleges (migration 20261005). */
  recommenders?: {
    id: string;
    name: string;
    role: string;
    letters: { college_id: string; college: string; status: "planned" | "requested" | "submitted" }[];
  }[];
}

/** The desk as list_my_desk shows it, with its recommenders when the database has them. */
export async function loadDeskInfo(sb: SupabaseClient, token: string): Promise<DeskInfo> {
  const [desk, recs] = await Promise.all([
    sb.rpc("connector_desk", { token }),
    Promise.resolve(sb.rpc("connector_recommenders", { token })).catch(() => null),
  ]);
  if (desk.error) throw new Error(desk.error.message);
  const d = desk.data as DeskInfo;
  if (recs && !recs.error) d.recommenders = recs.data as DeskInfo["recommenders"];
  return d;
}

const LETTER_WORDS = { planned: "not asked yet", requested: "asked", submitted: "submitted" } as const;

/** One line telling the assistant what it may do on this desk. */
export function permissionsLine(p: Permissions): string {
  const essays =
    p.essays === "edit"
      ? "read, suggest edits to, and write essays directly"
      : p.essays === "suggest"
        ? "read essays and suggest edits (not change their text directly)"
        : "read essays and give advice (not suggest or make edits)";
  const manage = p.manage
    ? "add, change and remove colleges and pieces (details, prompts, limits, due dates)"
    : "not add, change or remove colleges and pieces: tell the student what you would change instead";
  return `What the student allows you to do: ${essays}; ${manage}. Answering questions, the profile and odds estimates are always allowed.`;
}

interface PieceInfo {
  id: string;
  title: string;
  prompt: string;
  status: string;
  notes: string;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  doc_state: string;
  updates: string[];
  college: { id: string; name: string; ai_policy: string; deadline: string | null; research: string } | null;
  other_pieces: { id: string; title: string; prompt: string; text: string; status: string }[];
  open_suggestions: { author: string; source: string; kind: string; quote: string; body: string; note: string }[];
  student: { name: string; about: string } | null;
}

function limitLine(kind: string, value: number | null) {
  if (kind === "none" || !value) return "no limit";
  return `${value} ${kind === "chars" ? "characters" : "words"}`;
}

const POLICY_NOTE = "the student noted that this college does not allow AI help with drafting";

export function renderDesk(d: DeskInfo): string {
  const lines = [`# ${d.desk_title}`];
  if (d.student?.name) lines.push(`Student: ${d.student.name}`);
  if (d.student?.about) lines.push(`About the student (in their words): ${d.student.about}`);
  if (d.profile_sections) {
    lines.push(`Profile: ${d.profile_sections} section${d.profile_sections === 1 ? "" : "s"} about the student (read_profile).`);
  }
  if (d.permissions) lines.push(permissionsLine(d.permissions));
  const piecesFor = (id: string | null) => d.pieces.filter((p) => p.college_id === id);
  const pieceLine = (p: DeskInfo["pieces"][number]) =>
    `  - ${p.title} [piece_id: ${p.id}] ${labelOf(PIECE_STATUSES, p.status)}, ${p.word_count} words, limit ${limitLine(p.limit_kind, p.limit_value)}` +
    (p.due ? `, due ${p.due}` : "") +
    (p.prompt ? `\n    Prompt: ${p.prompt.length > 160 ? `${p.prompt.slice(0, 160)}…` : p.prompt}` : "\n    Prompt: (none entered)");
  const lettersOf = (collegeId: string) =>
    (d.recommenders ?? []).flatMap((r) =>
      r.letters.filter((l) => l.college_id === collegeId).map((l) => `${r.name} (${LETTER_WORDS[l.status] ?? l.status})`),
    );
  lines.push("", "## Colleges (by deadline)");
  if (!d.colleges.length) lines.push("None yet.");
  for (const c of d.colleges) {
    lines.push(
      `- ${c.name} [college_id: ${c.id}] ${labelOf(ROUNDS, c.round)}, ${labelOf(APP_SYSTEMS, c.app_system)}, deadline ${c.deadline ?? "not set"}` +
        (c.materials_deadline ? `, materials by ${c.materials_deadline}` : "") +
        (c.needs_letters === false ? ", no letters needed" : "") +
        (c.submitted_at ? `, application submitted ${c.submitted_at.slice(0, 10)}` : "") +
        (c.has_research ? ", has research notes" : "") +
        (c.ai_policy === "no_drafting" ? ` (AI policy: ${POLICY_NOTE})` : ""),
    );
    const letters = lettersOf(c.id);
    if (letters.length) lines.push(`  Letters: ${letters.join(", ")}`);
    for (const p of piecesFor(c.id)) lines.push(pieceLine(p));
  }
  const shared = piecesFor(null);
  if (shared.length) {
    lines.push("", "## Independent pieces (not tied to one college, like a personal statement)");
    for (const p of shared) lines.push(pieceLine(p));
  }
  if (d.recommenders) {
    lines.push("", "## Recommenders (who writes the student's letters)");
    if (!d.recommenders.length) lines.push("None yet.");
    for (const r of d.recommenders) {
      const n = r.letters.length;
      lines.push(`- ${r.name} [recommender_id: ${r.id}]${r.role ? `, ${r.role}` : ""}: ${n ? `${n} letter${n === 1 ? "" : "s"}` : "no colleges yet"}`);
    }
  }
  return lines.join("\n");
}

export function renderPiece(p: PieceInfo, body: string): string {
  const used = p.limit_kind === "chars" ? countChars(body) : countWords(body);
  const lines = [
    `# ${p.title} [piece_id: ${p.id}]`,
    p.college ? `College: ${p.college.name}${p.college.deadline ? `, deadline ${p.college.deadline}` : ""}` : "Independent piece (not tied to one college)",
  ];
  if (p.college?.ai_policy === "no_drafting") lines.push(`AI policy: ${POLICY_NOTE}.`);
  lines.push(
    `Status: ${labelOf(PIECE_STATUSES, p.status)}`,
    `Limit: ${limitLine(p.limit_kind, p.limit_value)}. Currently ${used} ${p.limit_kind === "chars" ? "characters" : "words"}.`,
    "",
    "## Prompt",
    p.prompt || "(no prompt entered)",
    "",
    "## The current text (paragraphs are separated by single line breaks)",
    body || "(empty: nothing written yet)",
  );
  if (p.notes) lines.push("", "## Notes from the student and the people they share with (not part of the essay)", p.notes);
  if (p.college?.research) lines.push("", `## The student's research on ${p.college.name}`, p.college.research);
  if (p.student?.about) lines.push("", "## About the student (in their words)", p.student.about);
  if (p.other_pieces.length) {
    lines.push("", "## Other pieces for the same college");
    for (const o of p.other_pieces) {
      lines.push(`### ${o.title} [piece_id: ${o.id}]`, o.prompt ? `Prompt: ${o.prompt}` : "", o.text || "(empty)", "");
    }
  }
  if (p.open_suggestions.length) {
    lines.push("", "## Suggestions and comments waiting for the student");
    for (const s of p.open_suggestions) {
      const what =
        s.kind === "comment"
          ? `comments on "${s.quote}": ${s.body}`
          : s.kind === "insert"
            ? `add "${s.body}"`
            : s.kind === "delete"
              ? `delete "${s.quote}"`
              : `replace "${s.quote}" with "${s.body}"`;
      lines.push(`- ${s.author}${s.source === "ai" ? " (AI)" : ""}: ${what}${s.note ? `. Reason: ${s.note}` : ""}`);
    }
  }
  return lines.join("\n");
}

export async function loadPiece(sb: SupabaseClient, token: string, pieceId: string) {
  const { data, error } = await sb.rpc("connector_piece", { token, piece: pieceId });
  if (error) throw new Error(error.message);
  const p = data as PieceInfo;
  const doc = docFromRows(p.doc_state, p.updates);
  return { p, doc, flat: flatten(doc) };
}

/** Save a direct write: the old text goes to History, the Yjs update to the edit log. */
async function saveWrite(sb: SupabaseClient, token: string, pieceId: string, r: WriteResult) {
  if (!r.update) return;
  const { error } = await sb.rpc("connector_write", {
    token,
    piece: pieceId,
    yjs_update: r.update,
    before_json: r.beforeJSON,
    before_text: r.before,
    after_text: r.after,
    after_words: countWords(r.after),
    after_chars: countChars(r.after),
  });
  if (error) throw new Error(error.message);
}

const pieceId = z.string().uuid().describe("The piece_id from list_my_desk.");

const EditSchema = z.object({
  find: z.string().min(1).describe("Exact text as it currently appears in the piece (any length). Must occur exactly once."),
  replace_with: z.string().optional().describe("Replacement text, any length; line breaks start new paragraphs. Empty string deletes."),
  insert_after: z.string().optional().describe("Text to insert right after the found text, instead of replacing it."),
  reason: z.string().max(1000).optional().describe("Why, in a sentence, for the student."),
});

function countsLine(after: string) {
  return `Now ${countWords(after)} words, ${countChars(after)} characters.`;
}

export function registerTools(server: McpServer, token: string) {
  server.registerTool(
    "list_my_desk",
    {
      title: "List my colleges and essays",
      description:
        "The student's colleges (with deadlines and any AI policy they noted) and every piece of writing, with ids, status, word counts and limits.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return text(renderDesk(await loadDeskInfo(db(), token)));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "read_piece",
    {
      title: "Read an essay",
      description:
        "One piece of writing: its prompt, limit, current text, the student's notes and research, the other pieces for that college, and suggestions already waiting.",
      inputSchema: z.object({ piece_id: pieceId }),
      annotations: { readOnlyHint: true },
    },
    async ({ piece_id }) => {
      const sb = db();
      try {
        const [{ p, doc, flat }, profile] = await Promise.all([
          loadPiece(sb, token, piece_id),
          // The profile is extra context: a database without it (before migration 20261001) still reads the piece.
          sb.rpc("connector_profile", { token }).then(({ data }) => (data as ProfileInfo | null) ?? null, () => null),
        ]);
        doc.destroy();
        const extra = profile ? profileForPiece(profile) : "";
        return text(renderPiece(p, flat.text) + (extra ? `\n\n${extra}` : ""));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "suggest_edits",
    {
      title: "Suggest edits",
      description:
        "Propose edits of any length for the student to review: each appears on their desk as a suggestion they accept or decline, and nothing changes until they accept. " +
        "For each edit, quote the exact current text in `find` (enough to be unique), then give `replace_with` (empty string deletes) or `insert_after`, and a short reason.",
      inputSchema: z.object({ piece_id: pieceId, edits: z.array(EditSchema).min(1).max(100) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ piece_id, edits }) => {
      const sb = db();
      try {
        const { p, doc, flat } = await loadPiece(sb, token, piece_id);
        doc.destroy();
        if (!flat.text.trim()) {
          return fail("This piece is empty, so there's nothing to suggest edits to. Use write_piece to draft it.");
        }
        const rows: AnchoredRow[] = [];
        const report: string[] = [];
        edits.forEach((e, i) => {
          const r = anchorEdit(flat, { ...e, reason: e.reason ?? "" });
          if (r.ok) {
            rows.push(r.row);
            report.push(`${i + 1}. added`);
          } else report.push(`${i + 1}. not added: ${r.reason}`);
        });
        if (rows.length) {
          const { error } = await sb.rpc("connector_add_suggestions", { token, piece: piece_id, rows });
          if (error) return fail(error.message);
        }
        const head = rows.length
          ? `${rows.length} suggestion${rows.length === 1 ? "" : "s"} added to "${p.title}". The student will accept or decline each one on their desk.`
          : "No suggestions were added.";
        return { content: [{ type: "text", text: `${head}\n${report.join("\n")}` }], isError: rows.length === 0 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "write_piece",
    {
      title: "Write a piece",
      description:
        "Draft a piece or replace its whole text. Separate paragraphs with line breaks. The current text is saved in the piece's History first, so the student can restore it.",
      inputSchema: z.object({
        piece_id: pieceId,
        text: z.string().describe("The complete new text of the piece."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ piece_id, text: body }) => {
      const sb = db();
      let doc: Y.Doc | null = null;
      try {
        const loaded = await loadPiece(sb, token, piece_id);
        doc = loaded.doc;
        const r = writeWhole(doc, body);
        if (!r.update) return text(`"${loaded.p.title}" already has exactly that text.`);
        await saveWrite(sb, token, piece_id, r);
        return text(
          `Wrote "${loaded.p.title}". ${countsLine(r.after)}` +
            (r.before.trim() ? " The previous text is saved in the piece's History." : ""),
        );
      } catch (e) {
        return fail((e as Error).message);
      } finally {
        doc?.destroy();
      }
    },
  );

  server.registerTool(
    "edit_piece",
    {
      title: "Edit a piece directly",
      description:
        "Apply edits of any length directly to a piece (no review step). For each edit, quote the exact current text in `find`, then give `replace_with` (empty string deletes) or `insert_after`. " +
        "Edits must not overlap. The text before the edits is saved in the piece's History.",
      inputSchema: z.object({ piece_id: pieceId, edits: z.array(EditSchema).min(1).max(100) }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ piece_id, edits }) => {
      const sb = db();
      let doc: Y.Doc | null = null;
      try {
        const loaded = await loadPiece(sb, token, piece_id);
        doc = loaded.doc;
        if (!loaded.flat.text.trim()) return fail("This piece is empty. Use write_piece to draft it.");
        const r = applyEdits(doc, edits.map((e) => ({ ...e, reason: e.reason ?? "" })));
        const report = r.outcomes.map((o) => `${o.index + 1}. ${o.ok ? "applied" : `not applied: ${o.reason}`}`);
        const applied = r.outcomes.filter((o) => o.ok).length;
        if (applied) await saveWrite(sb, token, piece_id, r);
        return {
          content: [
            {
              type: "text",
              text:
                (applied
                  ? `Applied ${applied} edit${applied === 1 ? "" : "s"} to "${loaded.p.title}". ${countsLine(r.after)} The previous text is saved in the piece's History.`
                  : "No edits were applied.") + `\n${report.join("\n")}`,
            },
          ],
          isError: applied === 0,
        };
      } catch (e) {
        return fail((e as Error).message);
      } finally {
        doc?.destroy();
      }
    },
  );

  server.registerTool(
    "create_piece",
    {
      title: "Add a piece",
      description:
        "Add a new essay or short answer for one of the student's colleges (or an independent piece, not tied to a college, when college_id is omitted), optionally with its prompt, limit and a first draft.",
      inputSchema: z.object({
        college_id: z.string().uuid().optional().describe("The college_id from list_my_desk; omit for an independent piece (not tied to a college)."),
        title: z.string().min(1).max(300),
        prompt: z.string().optional().describe("The question exactly as the college asks it."),
        limit_kind: z.enum(["words", "chars", "none"]).optional(),
        limit_value: z.number().int().positive().optional(),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().describe("When the student wants it finished."),
        text: z.string().optional().describe("A first draft; paragraphs separated by line breaks."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ college_id, title, prompt, limit_kind, limit_value, due, text: body }) => {
      const sb = db();
      try {
        const { data: id, error } = await sb.rpc("connector_create_piece", {
          token,
          college: college_id ?? null,
          piece_title: title,
          piece_prompt: prompt ?? "",
          piece_limit_kind: limit_kind ?? (limit_value ? "words" : "none"),
          piece_limit_value: limit_value ?? null,
        });
        if (error) return fail(error.message);
        if (due) {
          const { error: dueError } = await sb.rpc("connector_update_piece", { token, piece: id, fields: { due } });
          if (dueError) return fail(`Added "${title}" [piece_id: ${id}], but couldn't set its due date: ${dueError.message}`);
        }
        let drafted = "";
        if (body?.trim()) {
          const { doc } = await loadPiece(sb, token, id as string);
          try {
            const r = writeWhole(doc, body);
            await saveWrite(sb, token, id as string, r);
            drafted = ` with a first draft. ${countsLine(r.after)}`;
          } finally {
            doc.destroy();
          }
        }
        return text(`Added "${title}" [piece_id: ${id}]${drafted || "."}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
