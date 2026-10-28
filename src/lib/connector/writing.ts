/*
 * read_writing: every piece on the desk with its whole text, grouped by college, in parts small
 * enough to read one at a time. For work across many pieces (rating them all, finding a story
 * told twice for one college) without read_piece's profile and research on every call, which
 * fills an assistant's context long before a big desk is through. Pure, so it is tested without
 * a connector.
 */

export interface WritingPiece {
  id: string;
  title: string;
  prompt: string;
  status: string;
  words: number;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  text: string;
  rating?: { rating: number; stale: boolean; ai?: boolean } | null;
}

export interface WritingGroup {
  /** The college's name, or null for the pieces tied to no college. */
  name: string | null;
  id: string | null;
  deadline?: string | null;
  pieces: WritingPiece[];
}

/** About how many characters each part holds (a college is never split). */
export const WRITING_PART = 40_000;
/** One piece's text is cut past this (read_piece has all of it). */
const PIECE_MAX = 15_000;

const limitOf = (p: WritingPiece) =>
  p.limit_kind === "none" || !p.limit_value ? "no limit" : `limit ${p.limit_value} ${p.limit_kind === "chars" ? "characters" : "words"}`;

const current = (p: WritingPiece) => !!p.rating && !p.rating.stale;
const written = (p: WritingPiece) => p.text.trim() !== "";

function groupBlock(g: WritingGroup, skipRated: boolean): string {
  const head = g.name
    ? `## ${g.name} [college_id: ${g.id}]${g.deadline ? `, deadline ${g.deadline}` : ""}`
    : "## Independent pieces (not tied to one college)";
  const pieces = g.pieces.filter(written);
  if (skipRated && pieces.length && pieces.every(current)) {
    return `${head}\nEvery piece here has a rating and hasn't been edited since (${pieces.map((p) => `${p.title}: ${p.rating!.rating}`).join("; ")}).`;
  }
  const lines = [head];
  for (const p of g.pieces) {
    const rated = p.rating
      ? `, rated ${p.rating.rating}${p.rating.stale ? " (edited since)" : ""}${p.rating.ai ? ", flagged as sounding AI-written" : ""}`
      : ", not rated";
    if (!written(p)) {
      lines.push("", `### ${p.title} [piece_id: ${p.id}] empty: nothing to rate`);
      continue;
    }
    const body = p.text.length > PIECE_MAX ? `${p.text.slice(0, PIECE_MAX)}\n[…cut here: read_piece has the whole text]` : p.text;
    lines.push(
      "",
      `### ${p.title} [piece_id: ${p.id}] ${p.words} words, ${limitOf(p)}, ${p.status}${rated}`,
      `Prompt: ${p.prompt.trim() || "(none entered)"}`,
      '"""',
      body,
      '"""',
    );
  }
  return lines.join("\n");
}

/** The parts, each a list of college blocks. */
export function writingParts(groups: WritingGroup[], skipRated = false): string[][] {
  const parts: string[][] = [];
  let size = 0;
  for (const g of groups) {
    if (!g.pieces.length) continue;
    const block = groupBlock(g, skipRated);
    if (!parts.length || (size + block.length > WRITING_PART && size > 0)) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1].push(block);
    size += block.length;
  }
  return parts;
}

/** One part, with where it stands and what to do next. */
export function renderWriting(groups: WritingGroup[], part: number, skipRated = false): string {
  const parts = writingParts(groups, skipRated);
  if (!parts.length) return "There are no pieces on the desk yet.";
  if (part > parts.length) return `There are only ${parts.length} part${parts.length === 1 ? "" : "s"}.`;
  const n = parts.length;
  const next =
    part < n
      ? `This is part ${part} of ${n}. When you're rating, save this part's ratings with set_piece_ratings before reading part ${part + 1} (read_writing with part: ${part + 1}).`
      : n > 1
        ? `This is the last part (${n} of ${n}).`
        : "This is all of it.";
  return [`# The writing on the desk, by college`, next, "", parts[part - 1].join("\n\n")].join("\n");
}
