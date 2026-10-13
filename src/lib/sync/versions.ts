import type { SupabaseClient } from "@supabase/supabase-js";
import { countWords } from "@/lib/domain/count";

const MINUTE = 60_000;

/**
 * While someone is writing, save a version at most this often. Every version is kept for as long
 * as the piece (Braxton's call, 10/12/26: keep everything, nothing is thinned out).
 */
export const SNAPSHOT_EVERY = MINUTE;

/** Rows per request: the database hands out at most 1,000 at a time. */
const PAGE = 1000;

export interface VersionRow {
  id: string;
  at: string;
  author: string;
  words: number;
  size: number;
  /** A name the student gave it when saving it by hand (migration 20261023). */
  label?: string | null;
}

/** Postgres "undefined column", or PostgREST "column not in schema": a database before migration 20261023. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

/** Every saved version of a piece, newest first. */
export async function listVersions(supabase: SupabaseClient, pieceId: string): Promise<VersionRow[]> {
  const all: VersionRow[] = [];
  let cols = "id, at, author, words, size, label";
  for (let from = 0; ; from += PAGE) {
    const page = () =>
      supabase
        .from("piece_versions")
        .select(cols)
        .eq("piece_id", pieceId)
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
    let { data, error } = await page();
    if (missingColumn(error) && cols.endsWith(", label")) {
      cols = cols.replace(", label", "");
      ({ data, error } = await page());
    }
    if (error) throw error;
    all.push(...(data as unknown as VersionRow[]));
    if (!data || data.length < PAGE) return all;
  }
}

export async function loadVersion(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("piece_versions").select("content, plain_text").eq("id", id).single();
  if (error) throw error;
  return data as { content: unknown; plain_text: string };
}

/**
 * Save a version (by hand, it can have a name). Nothing older is removed. A database without
 * names yet (before migration 20261023) still saves it, unnamed.
 */
export async function saveVersion(
  supabase: SupabaseClient,
  pieceId: string,
  author: string,
  content: unknown,
  text: string,
  label?: string,
): Promise<boolean> {
  const row: Record<string, unknown> = {
    piece_id: pieceId,
    author,
    content,
    plain_text: text,
    words: countWords(text),
    size: JSON.stringify(content).length,
  };
  const name = label?.trim().slice(0, 120);
  if (name) row.label = name;
  let { error } = await supabase.from("piece_versions").insert(row);
  if (missingColumn(error) && "label" in row) {
    delete row.label;
    ({ error } = await supabase.from("piece_versions").insert(row));
  }
  // A deleted piece refuses the insert.
  return !error;
}
