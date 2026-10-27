"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnswerText } from "@/components/ask/answer-text";
import { ModelPicker, useModelChoice } from "@/components/ask/model-picker";
import { RATING_BG, RATING_TEXT } from "@/components/board/ratings";
import { LocalDay } from "@/components/local-day";
import { queueRequest, REQUEST_COLS, type Assistant, type DeskRequest } from "@/lib/bridge/requests";
import { WATCH_PHRASE } from "@/lib/bridge/watchers";
import { ordinal, ratingBand, type Rated } from "@/lib/progress/rating";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * A piece's own rating, on its page: the counselor's last rating and why, and (for the student)
 * Rate this piece, which asks for a fresh rating of just this one.
 */

const RATING_COLS = "rating, rating_reason, rated_by, rated_at, rating_stale";
/** The editor saved a piece's text (its detail is the piece's id), which can make its rating stale. */
export const TEXT_SAVED = "desk:piece-text-saved";
const POLL_MS = 4000;
const NAME: Record<Assistant, string> = { claude: "Claude", chatgpt: "ChatGPT" };

export interface PieceRatingState {
  /** The database has ratings (migration 20261025). */
  ready: boolean;
  rating: Rated | null;
  assistants: Assistant[];
  pending: DeskRequest | null;
  last: DeskRequest | null;
  reload: () => void;
  setPending: (r: DeskRequest | null) => void;
}

export function usePieceRating(pieceId: string, owner: boolean): PieceRatingState {
  const [state, setState] = useState<Omit<PieceRatingState, "reload" | "setPending">>({
    ready: false,
    rating: null,
    assistants: [],
    pending: null,
    last: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let stopped = false;
    void (async () => {
      const none = Promise.resolve({ data: null, error: null });
      const [piece, reqs, links] = await Promise.all([
        supabase.from("pieces").select(RATING_COLS).eq("id", pieceId).maybeSingle(),
        owner
          ? supabase
              .from("desk_requests")
              .select(REQUEST_COLS)
              .eq("piece_id", pieceId)
              .eq("kind", "rate")
              .in("status", ["pending", "answered"])
              .order("created_at", { ascending: false })
              .limit(3)
          : none,
        owner ? supabase.from("connector_links").select("label").is("revoked_at", null) : none,
      ]);
      if (stopped) return;
      // A database without ratings yet: nothing to show.
      if (piece.error) return setState((s) => ({ ...s, ready: false }));
      const rows = (reqs.data ?? []) as unknown as DeskRequest[];
      const labels = new Set(((links.data ?? []) as { label: string }[]).map((l) => l.label.toLowerCase()));
      setState({
        ready: true,
        rating: (piece.data as Rated | null) ?? null,
        assistants: (["claude", "chatgpt"] as const).filter((a) => labels.has(a)),
        pending: rows.find((r) => r.status === "pending") ?? null,
        last: rows.find((r) => r.status === "answered") ?? null,
      });
    })();
    return () => {
      stopped = true;
    };
  }, [pieceId, owner, tick]);

  // A fresh rating goes stale as the text is saved: look again then.
  const fresh = !!state.rating && state.rating.rating != null && !state.rating.rating_stale;
  useEffect(() => {
    if (!fresh) return;
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<string>).detail === pieceId) reload();
    };
    window.addEventListener(TEXT_SAVED, onSaved);
    return () => window.removeEventListener(TEXT_SAVED, onSaved);
  }, [fresh, pieceId, reload]);

  // While a rating is on its way, look again now and then (and on coming back to the tab).
  const waiting = !!state.pending;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reload, POLL_MS);
    window.addEventListener("focus", reload);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", reload);
    };
  }, [waiting, reload]);

  return { ...state, reload, setPending: (pending) => setState((s) => ({ ...s, pending })) };
}

/** What the Rating fold-out's button says: "Rating 72", or just "Rating". */
export function ratingLabel(s: PieceRatingState): string {
  return s.rating && ratingBand(s.rating) ? `Rating ${s.rating.rating}` : "Rating";
}

export function PieceRatingPanel({ state, deskId, pieceId, owner }: { state: PieceRatingState; deskId: string; pieceId: string; owner: boolean }) {
  const [model, setModel] = useModelChoice("rate");
  const [error, setError] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);
  const r = state.rating;
  const band = r ? ratingBand(r) : null;

  async function ask() {
    setError(null);
    setQueuing(true);
    try {
      state.setPending(await queueRequest(supabaseBrowser(), { deskId, pieceId, kind: "rate", prompt: "Rate this piece.", model }));
    } catch (e) {
      setError(`Couldn't ask: ${(e as Error).message}`);
    } finally {
      setQueuing(false);
    }
  }
  async function cancel() {
    if (!state.pending) return;
    const { error: e } = await supabaseBrowser().from("desk_requests").update({ status: "dismissed" }).eq("id", state.pending.id);
    if (e) setError(e.message);
    else state.setPending(null);
  }

  const who = state.assistants.length === 1 ? NAME[state.assistants[0]] : "your counselor";
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm" data-testid="piece-rating">
      {r && band ? (
        <div className="flex items-start gap-3">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-md font-mono text-lg font-semibold text-white ${RATING_BG[band]} ${r.rating_stale ? "opacity-40" : ""}`}
            aria-hidden
          >
            {r.rating}
          </span>
          <div className="min-w-0">
            <p>
              <span className={`font-medium ${RATING_TEXT[band]}`}>{ordinal(r.rating ?? 0)} percentile</span>
              <span className="text-muted">
                {" "}
                against other applicants on this prompt
                {r.rated_by ? `, rated by ${r.rated_by}` : ""}
                {r.rated_at && (
                  <>
                    {" "}
                    on <LocalDay at={r.rated_at} />
                  </>
                )}
                .
              </span>
            </p>
            {r.rating_reason && <p className="mt-1">{r.rating_reason}</p>}
            {r.rating_stale && (
              <p className="mt-1 text-xs text-warn" data-testid="rating-stale">
                Edited since this rating.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-muted">Not rated yet.</p>
      )}

      {state.last?.answer && !state.pending && (
        <details className="mt-2 text-muted">
          <summary className="cursor-pointer">What {state.last.answered_by || who} said</summary>
          <div className="mt-1 text-ink">
            <AnswerText text={state.last.answer} />
          </div>
        </details>
      )}

      {owner &&
        (state.assistants.length === 0 ? (
          <p className="mt-2 text-xs text-muted">
            Connect Claude or ChatGPT in{" "}
            <Link href="/desk/settings/connectors" className="underline">
              Settings
            </Link>{" "}
            to have it rated.
          </p>
        ) : state.pending || queuing ? (
          <div role="status" className="mt-2 rounded-md border border-accent bg-accent-soft px-2.5 py-1.5">
            <p className="font-medium">Waiting for {who} to rate this piece…</p>
            <p className="mt-0.5 text-xs">
              If your counselor or a {who} chat is watching your desk it starts now. If not, turn on your counselor in Settings, or say
              &ldquo;{WATCH_PHRASE}&rdquo; in your {who} chat.
            </p>
            <button type="button" className="btn mt-1.5" onClick={cancel} disabled={queuing}>
              Cancel request
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={() => void ask()}>
              Rate this piece
            </button>
            <ModelPicker value={model} onChange={setModel} />
          </div>
        ))}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
