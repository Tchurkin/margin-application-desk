import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackendResult, Suggestion, SuggestionBackend, SuggestionStatus } from "./store";

export const SUGGESTION_COLS =
  "id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note, context, status, version, created_at";

/** Columns added by later migrations, newest first, for databases that don't have them yet. */
const OPTIONAL_COLS = [", context", ", note"];

/** Refusals that retrying won't fix: policy, trigger, or a deleted piece. */
function outcome(error: { code?: string } | null): BackendResult {
  if (!error) return "ok";
  if (error.code && ["42501", "23503", "P0001", "PGRST116"].includes(error.code)) return "rejected";
  return "retry";
}

/** Postgres "undefined column", or PostgREST "column not in schema". */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

export class SupabaseSuggestionBackend implements SuggestionBackend {
  /**
   * `onBehind` hears when the database refuses a kind of suggestion it doesn't know yet (a
   * comment, before migration 20261022). It stays parked here and is sent once the database has it.
   */
  constructor(
    private supabase: SupabaseClient,
    private opts: { onBehind?: (kind: Suggestion["kind"]) => void } = {},
  ) {}

  async list(pieceId: string) {
    const query = (cols: string) =>
      this.supabase.from("suggestions").select(cols).eq("piece_id", pieceId).eq("status", "open").order("created_at");
    let cols = SUGGESTION_COLS;
    let { data, error } = await query(cols);
    for (const drop of OPTIONAL_COLS) {
      if (!missingColumn(error)) break;
      cols = cols.replace(drop, "");
      ({ data, error } = await query(cols));
    }
    if (error) throw error;
    return data as unknown as Suggestion[];
  }

  async put(s: Suggestion) {
    const row: Record<string, unknown> = {
      id: s.id,
      piece_id: s.piece_id,
      author_name: s.author_name,
      source: s.source,
      kind: s.kind,
      anchor_from: s.anchor_from,
      anchor_to: s.anchor_to,
      quote: s.quote,
      body: s.body,
      version: s.version,
      created_at: s.created_at,
    };
    if (s.context) row.context = s.context;
    // A reason (an assistant's), kept when one of its comments is put back.
    if (s.note) row.note = s.note;
    let { error } = await this.supabase.from("suggestions").upsert(row, { onConflict: "id" });
    if (missingColumn(error) && "context" in row) {
      delete row.context;
      ({ error } = await this.supabase.from("suggestions").upsert(row, { onConflict: "id" }));
    }
    // A check the database fails it on: its kind is newer than the database. Kept, and retried.
    if (error?.code === "23514") this.opts.onBehind?.(s.kind);
    return outcome(error);
  }

  async remove(id: string) {
    const { error } = await this.supabase.from("suggestions").delete().eq("id", id);
    return outcome(error);
  }

  async resolve(id: string, status: SuggestionStatus) {
    const { error } = await this.supabase.from("suggestions").update({ status }).eq("id", id);
    return outcome(error);
  }
}
