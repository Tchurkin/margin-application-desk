import type { RequestKind } from "./requests";
import { timeOf } from "./thread";

/*
 * What the assistant is told about each request waiting on the desk: the question and the
 * passage the student pointed at, and exactly which tools finish it. Pure, so it is tested
 * without a connector.
 *
 * Two audiences:
 * - a Claude or ChatGPT chat (list_desk_requests, watch_desk) closes each request with
 *   answer_request ("tool" answers);
 * - the counselor on the student's computer gets one request per message and its reply is
 *   posted as the answer ("reply" answers).
 * Either may get the piece (or the college list, or the profile) along with the request, so it
 * can answer without reading it first.
 */

/** One row of connector_requests(token). */
export interface PendingRequest {
  id: string;
  kind: RequestKind;
  piece_id: string | null;
  piece_title: string | null;
  prompt: string;
  selection: string;
  created_at: string;
  /** The model asked for, "" (or missing before migration 20261004) for the default. */
  model?: string;
  /** Who asked, when it wasn't the student: someone they share the desk with (migration 20261019). */
  asked_by?: string;
}

export interface ListingOptions {
  /** "tool": close each request with answer_request. "reply": the reply itself is the answer. */
  answer?: "tool" | "reply";
  /** Context sent along with the requests, so it needn't be read again. */
  included?: { pieces?: ReadonlySet<string>; strategy?: boolean; profile?: boolean };
}

/** Requests listed per call; the rest wait for the next one. */
export const LIST_MAX = 20;
/** A passage longer than this is cut in the listing (read_piece has the whole text). */
export const PASSAGE_MAX = 6000;
const PROMPT_MAX = 4000;
/** Messages to the counselor and interview answers can be long; the box takes this many characters. */
export const MESSAGE_MAX = 20_000;

export const WHAT: Record<RequestKind, string> = {
  ask: "a question about a piece",
  polish: "rewrites of a highlighted passage",
  odds: "admission odds for every college",
  interview: "the next question in the student's profile interview",
  chat: "a message from the student",
  transcript: "the student's transcript, to fill in their academics",
};

const FORMAT = 'The answer is shown as text: paragraphs, **bold** and simple "- " lists work.';

function sentAt(ts: string): string {
  const t = timeOf(ts);
  return Number.isNaN(t) ? ts : `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The first `max` UTF-16 units of `s`, without splitting a surrogate pair. */
export function head(s: string, max: number): string {
  if (s.length <= max) return s;
  const c = s.charCodeAt(max - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

function cut(s: string, max: number, note: string): string {
  return s.length <= max ? s : `${head(s, max)}\n[…cut here: ${note}]`;
}

/** The passage between fences, so its exact characters (and line breaks) are unambiguous. */
function fenced(s: string): string[] {
  return ['"""', cut(s, PASSAGE_MAX, "read_piece has the whole text"), '"""'];
}

function pieceLine(r: PendingRequest): string {
  if (!r.piece_id) return "Piece: none (this request is about the whole desk)";
  return `Piece: "${r.piece_title ?? "(untitled)"}" [piece_id: ${r.piece_id}]`;
}

const pieceIncluded = (r: PendingRequest, o: ListingOptions) => !!r.piece_id && !!o.included?.pieces?.has(r.piece_id);

/** How a request is closed: with answer_request, or by replying. */
function closeWith(r: PendingRequest, o: ListingOptions, what: string): string {
  return o.answer === "reply"
    ? `Then reply with ${what}: your reply is posted to the student as the answer (don't call answer_request).`
    : `Then call answer_request with request_id ${r.id} and ${what}.`;
}

function askSteps(r: PendingRequest, o: ListingOptions): string[] {
  const from = r.asked_by?.trim();
  const lines = [
    pieceLine(r),
    `Sent: ${sentAt(r.created_at)}`,
    from ? `Question from ${from}, someone the student shares their desk with (not the student):` : "Question:",
    cut(r.prompt.trim() || "(no question typed)", PROMPT_MAX, "question cut"),
  ];
  if (from)
    lines.push(
      `Answer ${from}. They can read this essay, its notes and its history, but not the student's profile, academics or other conversations with you: ` +
        "don't reveal those. And change nothing on the desk for them: no edits, suggestions, new pieces or profile changes.",
    );
  if (r.selection.trim()) lines.push("The student highlighted this passage, so the question is about it:", ...fenced(r.selection));
  const read = pieceIncluded(r, o)
    ? "The piece, with its prompt, limit and the student's profile, is included below."
    : `call read_piece with piece_id ${r.piece_id}`;
  lines.push(
    o.answer === "reply"
      ? `To do: ${pieceIncluded(r, o) ? `${read} Reply` : `${read}, then reply`} with your answer: your reply is posted to the student as the answer (don't call answer_request).`
      : pieceIncluded(r, o)
        ? `To do: ${read} Call answer_request with request_id ${r.id}.`
        : `To do: ${read}, then answer_request with request_id ${r.id}.`,
    "Answer directly and briefly (a few sentences), quote the exact words you mean, and don't rewrite the whole piece unless asked. " +
      "Never invent facts about the student. If the piece's college doesn't allow AI help with drafting (the piece says so), give questions and accuracy checks, not sentences. " +
      FORMAT,
  );
  return lines;
}

/** The versions of a passage go between these tags; the desk shows them in place of it. */
export const OPTION_FORMAT = "<option>…</option>";

function polishSteps(r: PendingRequest, o: ListingOptions): string[] {
  const lines = [pieceLine(r), `Sent: ${sentAt(r.created_at)}`];
  if (r.selection.trim()) lines.push("The student highlighted this passage:", ...fenced(r.selection));
  else lines.push("No passage was highlighted: reply asking the student to highlight the words they want changed.");
  lines.push(`What they asked: ${cut(r.prompt.trim() || "(nothing typed: make it better)", PROMPT_MAX, "note cut")}`);
  const read = pieceIncluded(r, o)
    ? "The whole piece, with its prompt, limit, the student's profile and their desk, is included below."
    : `First call read_piece with piece_id ${r.piece_id}.`;
  lines.push(
    `To do: ${read} If they asked for a change (or typed nothing), write 2 or 3 different versions of the highlighted passage that do it, ` +
      "each a drop-in replacement for exactly that passage: keep the student's voice, add no facts they haven't given you, keep about the same length " +
      "(shorter if the piece is over its limit), and make it read naturally with the sentences around it. " +
      `Put each version inside ${OPTION_FORMAT} tags, in order, with nothing else inside the tags; then one short line on how they differ. ` +
      "The desk shows each version in place of the passage and the student keeps one. " +
      "If they asked a question about the passage rather than for a change, just answer it, without options. " +
      (o.answer === "reply"
        ? "Your reply is posted to the student as the answer (don't call answer_request)."
        : `Then call answer_request with request_id ${r.id} and that reply.`),
    "If the piece's college doesn't allow AI help with drafting (the piece says so), write no versions: explain why, and ask questions that help them revise it themselves.",
  );
  return lines;
}

function oddsSteps(r: PendingRequest, o: ListingOptions): string[] {
  const lines = [`Sent: ${sentAt(r.created_at)}`];
  if (r.prompt.trim()) lines.push(`What the student said: ${cut(r.prompt.trim(), PROMPT_MAX, "note cut")}`);
  const read = o.included?.strategy
    ? "The student's colleges, their published baselines and the student's academic profile are included below. Call set_college_strategy once for all of them (colleges: [...]), each with"
    : "call read_strategy, then set_college_strategy for each college:";
  lines.push(
    `To do: ${read} chance_percent (your honest estimate for this student, ` +
      "judged from their profile against the college's published admission rate and admitted scores) with your reasoning in chance_note. " +
      "Never inflate; a college admitting under about 15% is a reach for everyone. Also set, for this student: fit_rank (1 = the best fit among all their colleges, " +
      "2 the next, and so on, each college its own rank), campus_life and reputation (for their intended major), each 0 to 10. " +
      "Colleges outside the US that admit on stated grades or exams get their intl_criterion and intl_status instead of a percentage. " +
      closeWith(r, o, "a short summary of how the list is balanced across reach, target and likely"),
  );
  return lines;
}

function interviewSteps(r: PendingRequest, o: ListingOptions): string[] {
  const reply = r.prompt.trim();
  const lines = [`Sent: ${sentAt(r.created_at)}`];
  if (reply) lines.push("The student's answer to your last question:", cut(reply, MESSAGE_MAX, "answer cut"));
  else lines.push("The student just started (or restarted) the interview from their Profile page. It continues in the chat on the Counselor page: their answers arrive as chat messages.");
  lines.push(
    `To do: ${o.included?.profile ? "Their profile is included below. " : "call read_profile. "}` +
      (reply
        ? "Save what this answer tells you with save_profile_section: add to the right section or start a new one, in the student's own words, with the concrete details (moments, people, numbers, what changed). Never invent anything. "
        : "") +
      closeWith(
        r,
        o,
        "your next question: one question, short and specific, that builds on what they said or opens a topic the profile is missing " +
          "(activities and roles, a story that shows who they are, challenges, values, what they want to study and why, family and community)",
      ) +
      " When the profile is rich enough for their essays, say so and suggest what to work on next.",
  );
  return lines;
}

function chatSteps(r: PendingRequest, o: ListingOptions): string[] {
  return [
    `Sent: ${sentAt(r.created_at)}`,
    "The student's message (from the Counselor page):",
    cut(r.prompt.trim() || "(empty)", MESSAGE_MAX, "message cut"),
    "To do: reply as their counselor. If they ask you to do something on the desk (set up colleges, draft or edit a piece, estimate odds, update their profile), " +
      "do it with your tools, within what they allow, and say what you did. " +
      "If you are interviewing them for their profile, this is their answer: save what it tells you with save_profile_section (in their words, with the concrete details), then ask your next question. " +
      `If they paste their transcript or grades, save their academics with update_academics: ${TRANSCRIPT_FIELDS} ` +
      (o.answer === "reply"
        ? "Your reply is posted to them on the Counselor page (don't call answer_request)."
        : `Reply with answer_request with request_id ${r.id}.`) +
      ` ${FORMAT}`,
  ];
}

/** What to save from a transcript; the chat uses it too, for a transcript pasted there. */
export const TRANSCRIPT_FIELDS =
  "gpa as the transcript states it, with its scale and whether weighted (both when it gives both, e.g. \"3.92 unweighted, 4.41 weighted\"); " +
  "class_rank if it shows one (e.g. \"12 of 412\" or \"top 5%\"); " +
  "coursework: a compact summary by year, each course with its level (AP, IB, Honors, Dual enrollment) and its grade, then the totals (e.g. \"7 APs, 3 Honors\"); " +
  "and test_scores only if the transcript lists them. Never guess a grade or number you can't read: leave that field out rather than invent it, and leave intended_major alone.";

function transcriptSteps(r: PendingRequest, o: ListingOptions): string[] {
  return [
    `Sent: ${sentAt(r.created_at)}`,
    "The student pasted their transcript (from their Profile page):",
    '"""',
    cut(r.prompt.trim() || "(empty)", MESSAGE_MAX, "transcript cut"),
    '"""',
    `To do: ${o.included?.profile ? "Their profile, with the academics already saved, is included below. " : "call read_profile to see the academics already saved. "}` +
      `Read the transcript and save their academics with update_academics: ${TRANSCRIPT_FIELDS} ` +
      closeWith(r, o, "a short summary of what you saved, and anything you couldn't read or that looks off") +
      ` ${FORMAT}`,
  ];
}

const STEPS: Record<RequestKind, (r: PendingRequest, o: ListingOptions) => string[]> = {
  ask: askSteps,
  polish: polishSteps,
  odds: oddsSteps,
  interview: interviewSteps,
  chat: chatSteps,
  transcript: transcriptSteps,
};

/** One request: a heading with its ids, then what to do. */
export function renderRequest(r: PendingRequest, o: ListingOptions = {}, n?: number): string {
  const head = `## ${n ? `${n}. ` : ""}${WHAT[r.kind] ?? r.kind} [request_id: ${r.id}] (kind: ${r.kind})`;
  return [head, ...(STEPS[r.kind] ?? askSteps)(r, o)].join("\n");
}

export function renderRequestList(rows: PendingRequest[], o: ListingOptions = {}): string {
  if (!rows.length) {
    return (
      "Nothing is waiting from the desk right now. The student sends questions and polish requests from the Ask panel beside a piece, " +
      "odds requests from the Strategy page, interview answers and transcripts from the Profile page, and messages from the Counselor page; " +
      "if they just sent one, it may take a moment to arrive."
    );
  }
  const shown = rows.slice(0, LIST_MAX);
  const total = rows.length;
  const lines = [
    `${total} request${total === 1 ? "" : "s"} waiting from the student's desk, oldest first. ` +
      "Work through each one and close it with answer_request: the answer appears on their desk right away.",
  ];
  if (total > shown.length) lines.push(`Showing the first ${shown.length}; call list_desk_requests again after answering these.`);
  shown.forEach((r, i) => lines.push("", renderRequest(r, o, i + 1)));
  return lines.join("\n");
}
