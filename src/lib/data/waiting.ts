import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * How many suggestions and comments are waiting on each piece: shown beside the pieces in the
 * Write page's list and on the board's cards. Read on the server with the page, and again in the
 * browser whenever a suggestion or comment is made, changed or dealt with.
 */

/** Open suggestions and comments on one piece. */
export interface Waiting {
  suggestions: number;
  comments: number;
}

export const NO_WAITING: Waiting = { suggestions: 0, comments: 0 };

/** By piece id; pieces with none are left out. Empty if they can't be read. */
export async function loadWaiting(supabase: SupabaseClient, pieceIds: string[]): Promise<Record<string, Waiting>> {
  const out: Record<string, Waiting> = {};
  if (!pieceIds.length) return out;
  const PAGE = 1000;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("suggestions")
        .select("piece_id, kind")
        .in("piece_id", pieceIds)
        .eq("status", "open")
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) return out;
      for (const r of (data ?? []) as { piece_id: string; kind: string }[]) {
        const w = (out[r.piece_id] ??= { suggestions: 0, comments: 0 });
        if (r.kind === "comment") w.comments++;
        else w.suggestions++;
      }
      if (!data || data.length < PAGE) return out;
    }
  } catch {
    return out;
  }
}

/** ", 2 suggestions, 1 comment waiting" for a screen reader, or nothing. */
export function waitingLabel(w: Waiting): string {
  const parts = [
    w.suggestions ? `${w.suggestions} suggestion${w.suggestions === 1 ? "" : "s"}` : "",
    w.comments ? `${w.comments} comment${w.comments === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? `, ${parts.join(", ")} waiting` : "";
}
