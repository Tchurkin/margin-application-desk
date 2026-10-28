import { collegeSubmitted, daysUntil, labelOf, PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";

/*
 * The board's lanes are derived, never edited as cards: one lane per college, and one for each
 * piece of its own (a personal statement), built from the desk's pieces in the same urgency
 * order as the Write rail. The shapes here are the subset of CollegeRow / PieceRow the board
 * needs, so loadDesk's rows fit them as they are.
 */

export interface ProgressCollege {
  id: string;
  name: string;
  deadline: string | null;
  /** How the student applies, the round, and whether it asks for letters (shown under its name). */
  app_system?: string;
  round?: string;
  needs_letters?: boolean;
  ai_policy?: string;
  /** When its whole application was submitted (migration 20261007); undefined before that. */
  submitted_at?: string | null;
}

export interface ProgressPiece {
  id: string;
  college_id: string | null;
  title: string;
  status: PieceStatus;
  word_count: number;
  char_count?: number | null;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  sort?: number;
  created_at?: string;
  /** Its own due date (migration 20260928); otherwise the college's deadline applies. */
  due?: string | null;
  /** The counselor's rating (migration 20261025): see src/lib/progress/rating.ts. */
  rating?: number | null;
  rating_reason?: string;
  rated_by?: string;
  rated_at?: string | null;
  rating_stale?: boolean;
  rating_ai?: string;
}

export interface Lane {
  /** The college id, or "piece:<id>" for a piece that belongs to no college. */
  key: string;
  college: ProgressCollege | null;
  name: string;
  pieces: ProgressPiece[];
  /** The soonest due date among its pieces (the college deadline when it has none yet). */
  due: string | null;
  /** The college's application is submitted. */
  submitted: boolean;
  /** When, if the database knows (migration 20261007). */
  submittedAt: string | null;
}

/** An independent piece's lane: the piece on its own. */
export const pieceLaneKey = (pieceId: string) => `piece:${pieceId}`;

/** Days a submitted college stays at the bottom of the board before it's filed under Submitted. */
export const SUBMITTED_SHOWN_DAYS = 3;

/**
 * A college's application is submitted: marked so on the board (migration 20261007), or, on a
 * database from before that, every one of its pieces is.
 */
export function isSubmitted(college: ProgressCollege, pieces: ProgressPiece[]): boolean {
  return collegeSubmitted(college, pieces);
}

/** A submitted lane that has sat at the bottom long enough to be filed away (or has no date). */
export function isFiled(lane: Lane, today: string): boolean {
  if (!lane.submitted) return false;
  if (!lane.submittedAt) return true;
  // Days from the submission to today.
  return daysUntil(today, lane.submittedAt.slice(0, 10)) >= SUBMITTED_SHOWN_DAYS;
}

/** Pieces at Final (or sent with their application), for "2/3 final". */
export const finalCount = (pieces: ProgressPiece[]) => pieces.filter((p) => p.status === "final" || p.status === "submitted").length;

/** The date a piece is due: its own, else its college's deadline. Same rule as dueOf in queries.ts. */
export function pieceDue(piece: ProgressPiece, college: ProgressCollege | null | undefined): string | null {
  return piece.due ?? college?.deadline ?? null;
}

/** A college's pieces in the order the student set, then oldest first. */
export function comparePieces(a: ProgressPiece, b: ProgressPiece): number {
  const s = (a.sort ?? 0) - (b.sort ?? 0);
  if (s !== 0) return s;
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/** 0 = deadline still ahead, 1 = passed, 2 = no date. */
function dueBucket(due: string | null, today: string): number {
  if (!due) return 2;
  return due < today ? 1 : 0;
}

/**
 * Most urgent first: submitted colleges sink to the bottom, the latest submitted first; the rest
 * go upcoming deadline first, then passed, then undated. Ties break on the soonest due date,
 * then the name.
 */
export function compareLanes(a: Lane, b: Lane, today: string): number {
  if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
  if (a.submitted && a.submittedAt !== b.submittedAt) return (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");
  const ba = dueBucket(a.due, today);
  const bb = dueBucket(b.due, today);
  if (ba !== bb) return ba - bb;
  if (a.due !== b.due && a.due && b.due) return a.due < b.due ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function soonest(dates: (string | null)[]): string | null {
  let best: string | null = null;
  for (const d of dates) if (d && (!best || d < best)) best = d;
  return best;
}

/**
 * One lane per college (colleges without pieces included, so an unstarted college with a close
 * deadline still shows), and one for each piece that belongs to no college. A piece whose college
 * isn't loaded yet is left out until the next refresh.
 */
export function buildLanes(colleges: ProgressCollege[], pieces: ProgressPiece[], today: string): Lane[] {
  const byCollege = new Map<string, ProgressPiece[]>();
  const own: ProgressPiece[] = [];
  const known = new Set(colleges.map((c) => c.id));
  for (const p of pieces) {
    if (!p.college_id) own.push(p);
    else if (known.has(p.college_id)) {
      const list = byCollege.get(p.college_id) ?? [];
      list.push(p);
      byCollege.set(p.college_id, list);
    }
  }
  const lanes: Lane[] = colleges.map((c) => {
    const sorted = [...(byCollege.get(c.id) ?? [])].sort(comparePieces);
    const submitted = isSubmitted(c, sorted);
    return {
      key: c.id,
      college: c,
      name: c.name,
      pieces: sorted,
      due: sorted.length ? soonest(sorted.map((p) => pieceDue(p, c))) : c.deadline,
      submitted,
      submittedAt: submitted ? (c.submitted_at ?? null) : null,
    };
  });
  for (const p of own) {
    lanes.push({ key: pieceLaneKey(p.id), college: null, name: p.title, pieces: [p], due: p.due ?? null, submitted: false, submittedAt: null });
  }
  return lanes.sort((a, b) => compareLanes(a, b, today));
}

export interface StageGroup {
  stage: PieceStatus;
  pieces: ProgressPiece[];
}

/** A lane's pieces gathered by status, in status order, empty ones left out. */
export function stageGroups(pieces: ProgressPiece[]): StageGroup[] {
  return PIECE_STATUSES.map((s) => ({ stage: s.id as PieceStatus, pieces: pieces.filter((p) => p.status === s.id) })).filter(
    (g) => g.pieces.length > 0,
  );
}

/** "1 Drafting, 2 Final" for screen readers, in stage order. */
export function stageSummary(pieces: ProgressPiece[]): string {
  if (!pieces.length) return "No pieces yet";
  return stageGroups(pieces)
    .map((g) => `${g.pieces.length} ${labelOf(PIECE_STATUSES, g.stage)}`)
    .join(", ");
}

/** The count on a piece's chip: "212/250w" against a word limit, "812/1000c" for characters, else "340w". */
export function countLabel(p: ProgressPiece): string {
  if (p.limit_kind === "words" && p.limit_value) return `${p.word_count}/${p.limit_value}w`;
  if (p.limit_kind === "chars" && p.limit_value && p.char_count != null) return `${p.char_count}/${p.limit_value}c`;
  return `${p.word_count}w`;
}

/** The same count in words, for the chip's accessible name. */
export function countPhrase(p: ProgressPiece): string {
  if (p.limit_kind === "words" && p.limit_value) return `${p.word_count} of ${p.limit_value} words`;
  if (p.limit_kind === "chars" && p.limit_value && p.char_count != null) {
    return `${p.char_count} of ${p.limit_value} characters`;
  }
  return `${p.word_count} word${p.word_count === 1 ? "" : "s"}`;
}

/** The piece a college's name opens: its first unfinished one, else its first. */
export function nextPiece(pieces: ProgressPiece[]): ProgressPiece | null {
  return pieces.find((p) => p.status !== "final" && p.status !== "submitted") ?? pieces[0] ?? null;
}

// ─── live changes ────────────────────────────────────────────────────────────

/** The fields the board keeps from a pieces row (realtime rows carry the whole document too). */
export function toProgressPiece(row: Record<string, unknown>): ProgressPiece | null {
  if (typeof row.id !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const kind = row.limit_kind === "chars" || row.limit_kind === "none" ? row.limit_kind : "words";
  const status = PIECE_STATUSES.some((s) => s.id === row.status) ? (row.status as PieceStatus) : "not_started";
  const piece: ProgressPiece = {
    id: row.id,
    college_id: str(row.college_id),
    title: str(row.title) ?? "Untitled",
    status,
    word_count: num(row.word_count) ?? 0,
    limit_kind: kind,
    limit_value: num(row.limit_value),
  };
  if ("char_count" in row) piece.char_count = num(row.char_count);
  if ("sort" in row) piece.sort = num(row.sort) ?? 0;
  if ("created_at" in row) piece.created_at = str(row.created_at) ?? undefined;
  if ("due" in row) piece.due = str(row.due);
  if ("rating" in row) piece.rating = num(row.rating);
  if ("rating_reason" in row) piece.rating_reason = str(row.rating_reason) ?? "";
  if ("rated_by" in row) piece.rated_by = str(row.rated_by) ?? "";
  if ("rated_at" in row) piece.rated_at = str(row.rated_at);
  if ("rating_stale" in row) piece.rating_stale = row.rating_stale === true;
  if ("rating_ai" in row) piece.rating_ai = str(row.rating_ai) ?? "";
  return piece;
}

export type PieceChange =
  | { type: "INSERT" | "UPDATE"; row: Record<string, unknown> }
  | { type: "DELETE"; id: string };

/** The desk's pieces after one realtime change. Unrelated changes return the same array. */
export function applyPieceChange(pieces: ProgressPiece[], change: PieceChange): ProgressPiece[] {
  if (change.type === "DELETE") {
    return pieces.some((p) => p.id === change.id) ? pieces.filter((p) => p.id !== change.id) : pieces;
  }
  const next = toProgressPiece(change.row);
  if (!next) return pieces;
  const i = pieces.findIndex((p) => p.id === next.id);
  if (i < 0) return [...pieces, next];
  const out = [...pieces];
  out[i] = { ...pieces[i], ...next };
  return out;
}

/** Pieces as the student should see them: moves still being saved already applied. */
export function withPending(pieces: ProgressPiece[], pending: ReadonlyMap<string, PieceStatus>): ProgressPiece[] {
  if (pending.size === 0) return pieces;
  return pieces.map((p) => {
    const s = pending.get(p.id);
    return s && s !== p.status ? { ...p, status: s } : p;
  });
}
