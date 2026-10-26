import type { SupabaseClient } from "@supabase/supabase-js";
import { asLetterStatus, type Letter, type Recommender } from "@/lib/board/letters";
import type { ProgressCollege, ProgressPiece } from "./lanes";

/*
 * What the board reads. Used by the page on the server and again by the board in the browser
 * when the tab regains focus, so it can't live in the server-only queries module.
 */

const COLLEGE_COLS = "id, name, deadline, app_system, round, needs_letters, ai_policy";
/** Added by migration 20261007. */
const COLLEGE_NEW_COLS = ", submitted_at";
const PIECE_COLS = "id, college_id, title, status, word_count, char_count, limit_kind, limit_value, sort, created_at";
/** Added by migration 20260928. */
const PIECE_NEW_COLS = ", due";
/** Added by migration 20261025: the counselor's rating. */
const RATING_COLS = ", rating, rating_reason, rated_by, rated_at, rating_stale";

export interface ProgressData {
  colleges: ProgressCollege[];
  pieces: ProgressPiece[];
  recommenders: Recommender[];
  letters: Letter[];
  /** The database has recommenders and letters (migration 20261005). */
  lettersReady: boolean;
  /** The database is a migration behind: no per-piece due dates, and pieces aren't streamed live. */
  behind: boolean;
}

/** Postgres "undefined column": the database is a migration behind the code. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

export async function loadProgress(supabase: SupabaseClient, deskId: string): Promise<ProgressData> {
  const piecesQuery = (cols: string) =>
    supabase.from("pieces").select(cols).eq("desk_id", deskId).order("sort").order("created_at");
  const collegesQuery = (cols: string) => supabase.from("colleges").select(cols).eq("desk_id", deskId).order("name");
  const [firstColleges, rated, recs, lets] = await Promise.all([
    collegesQuery(COLLEGE_COLS + COLLEGE_NEW_COLS),
    piecesQuery(PIECE_COLS + PIECE_NEW_COLS + RATING_COLS),
    supabase.from("recommenders").select("id, name, role, color, created_at").eq("desk_id", deskId).order("created_at"),
    supabase.from("letters").select("college_id, recommender_id, status").eq("desk_id", deskId),
  ]);
  // Without ratings yet the board is otherwise current.
  let pieces = missingColumn(rated.error) ? await piecesQuery(PIECE_COLS + PIECE_NEW_COLS) : rated;
  const behind = missingColumn(pieces.error);
  if (behind) pieces = await piecesQuery(PIECE_COLS);
  // Before migration 20261007 a college is submitted when every piece is (lanes.ts isSubmitted).
  const colleges = missingColumn(firstColleges.error) ? await collegesQuery(COLLEGE_COLS) : firstColleges;
  if (colleges.error) throw colleges.error;
  if (pieces.error) throw pieces.error;
  // Without migration 20261005 there are no recommenders yet; the board still works.
  const lettersReady = !recs.error && !lets.error;
  return {
    colleges: colleges.data as unknown as ProgressCollege[],
    pieces: pieces.data as unknown as ProgressPiece[],
    recommenders: lettersReady ? ((recs.data ?? []) as Recommender[]) : [],
    letters: lettersReady
      ? (lets.data ?? []).map((l) => ({
          college_id: l.college_id as string,
          recommender_id: l.recommender_id as string,
          status: asLetterStatus(l.status),
        }))
      : [],
    lettersReady,
    behind,
  };
}
