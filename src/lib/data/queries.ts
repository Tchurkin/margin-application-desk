import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { College, PieceSummary } from "@/lib/domain/colleges";

export const COLLEGE_COLS =
  "id, name, app_system, round, deadline, materials_deadline, ai_policy, needs_letters, research";
export const PIECE_SUMMARY_COLS = "id, college_id, title, status, word_count, limit_kind, limit_value, sort, created_at";
/** Piece columns added by migration 20260928 (per-piece due date, alternate versions). */
const PIECE_NEW_COLS = ", due, variant_of";

/** Strategy fields on a college (migration 20260928). Absent on older databases. */
export interface CollegeStrategy {
  scorecard_id: number | null;
  chance_percent: number | null;
  chance_source: "ai" | "student" | null;
  chance_note: string;
  fit_rank: number | null;
  campus_life: number | null;
  reputation: number | null;
  cost_sticker: number | null;
  cost_net: number | null;
  country: string;
  intl_course: string;
  intl_criterion: string;
  intl_cost: string;
  intl_status: string;
}

export type CollegeRow = College & { research: string } & Partial<CollegeStrategy>;
export type PieceRow = PieceSummary & {
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  sort?: number;
  created_at?: string;
  /** Its own due date, if set; otherwise the college's deadline applies. */
  due?: string | null;
  /** The piece this is an alternate version of. */
  variant_of?: string | null;
};

/** Postgres "undefined column": the database is a migration behind the code. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

/** All of a desk's colleges and pieces (summaries, no document text). */
export async function loadDesk(supabase: SupabaseClient, deskId: string) {
  const piecesQuery = (cols: string) =>
    supabase.from("pieces").select(cols).eq("desk_id", deskId).order("sort").order("created_at");
  // "*" so strategy columns come back when the database has them, and nothing breaks when not.
  const [colleges, firstPieces] = await Promise.all([
    supabase.from("colleges").select("*").eq("desk_id", deskId).order("name"),
    piecesQuery(PIECE_SUMMARY_COLS + PIECE_NEW_COLS),
  ]);
  let pieces = firstPieces;
  if (missingColumn(pieces.error)) pieces = await piecesQuery(PIECE_SUMMARY_COLS);
  if (colleges.error) throw colleges.error;
  if (pieces.error) throw pieces.error;
  return { colleges: colleges.data as CollegeRow[], pieces: pieces.data as unknown as PieceRow[] };
}

/** The date a piece is due: its own, else its college's deadline. */
export function dueOf(piece: PieceRow, college: CollegeRow | undefined): string | null {
  return piece.due ?? college?.deadline ?? null;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
