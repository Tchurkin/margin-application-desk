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
}

/** Every saved version of a piece, newest first. */
export async function listVersions(supabase: SupabaseClient, pieceId: string): Promise<VersionRow[]> {
  const all: VersionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("piece_versions")
      .select("id, at, author, words, size")
      .eq("piece_id", pieceId)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...(data as VersionRow[]));
    if (!data || data.length < PAGE) return all;
  }
}

export async function loadVersion(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("piece_versions").select("content, plain_text").eq("id", id).single();
  if (error) throw error;
  return data as { content: unknown; plain_text: string };
}

/** Save a version. Nothing older is removed. */
export async function saveVersion(
  supabase: SupabaseClient,
  pieceId: string,
  author: string,
  content: unknown,
  text: string,
): Promise<boolean> {
  const { error } = await supabase.from("piece_versions").insert({
    piece_id: pieceId,
    author,
    content,
    plain_text: text,
    words: countWords(text),
    size: JSON.stringify(content).length,
  });
  // A deleted piece refuses the insert.
  return !error;
}
