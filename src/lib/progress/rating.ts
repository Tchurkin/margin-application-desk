/*
 * The counselor's ratings on the board: each piece's percentile against other applicants to that
 * college on that prompt (set with the connector's set_piece_ratings), in four bands. Pure, so it
 * is tested without a browser.
 */

export type RatingBand = "low" | "mid" | "ok" | "high";

export const RATING_BANDS: { id: RatingBand; label: string }[] = [
  { id: "low", label: "below 55" },
  { id: "mid", label: "55–64" },
  { id: "ok", label: "65–79" },
  { id: "high", label: "80+" },
];

export interface Rated {
  rating?: number | null;
  rating_reason?: string;
  rated_by?: string;
  rated_at?: string | null;
  /** Edited after it was rated. */
  rating_stale?: boolean;
}

/**
 * A rating's band, or null for a piece without one. (Not the word count: it is saved a moment
 * after the text and can lag. A rated piece whose text was cleared since shows as stale.)
 */
export function ratingBand(p: Rated): RatingBand | null {
  const r = p.rating;
  if (r == null) return null;
  return r < 55 ? "low" : r < 65 ? "mid" : r < 80 ? "ok" : "high";
}

/** For a card's name and tooltip: " · rated 72, edited since: <reason>" (empty when unrated). */
export function ratingPhrase(p: Rated, withReason: boolean): string {
  if (!ratingBand(p)) return "";
  const stale = p.rating_stale ? ", edited since" : "";
  const reason = withReason && p.rating_reason ? `: ${p.rating_reason}` : "";
  return ` · rated ${p.rating}${stale}${reason}`;
}

export type ColorBy = "stage" | "rating";

/** 1st, 2nd, 3rd, 11th, 22nd, 72nd. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
