"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AnswerText } from "@/components/ask/answer-text";
import { ModelPicker, useModelChoice } from "@/components/ask/model-picker";
import { LocalDay } from "@/components/local-day";
import { queueRequest, REQUEST_COLS, setPreferredAssistant, type Assistant, type DeskRequest } from "@/lib/bridge/requests";
import { WATCH_PHRASE } from "@/lib/bridge/watchers";
import { RATING_BANDS, type ColorBy, type RatingBand } from "@/lib/progress/rating";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * Ratings on the board: the counselor's percentile for each piece, asked for with Rate my
 * essays, and shown by coloring the cards by rating instead of by stage.
 */

/** A card's left strip, a folded college's bar and a rating's number, by band. */
export const RATING_BG: Record<RatingBand, string> = { low: "bg-rate-low", mid: "bg-rate-mid", ok: "bg-rate-ok", high: "bg-rate-high" };
export const RATING_TEXT: Record<RatingBand, string> = { low: "text-rate-low", mid: "text-rate-mid", ok: "text-rate-ok", high: "text-rate-high" };
/** A piece without a rating. */
export const UNRATED_STYLE = { backgroundImage: "repeating-linear-gradient(45deg, var(--line) 0 3px, transparent 3px 6px)" };

// The choice is kept per browser; until there is one, the board shows ratings once it has any.
const KEY = "desk:board-color";
const CHANGED = "desk:board-color";
const subscribe = (on: () => void) => {
  window.addEventListener(CHANGED, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(CHANGED, on);
    window.removeEventListener("storage", on);
  };
};
const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

export function useColorBy(anyRated: boolean): [ColorBy, (c: ColorBy) => void] {
  const s = useSyncExternalStore(subscribe, stored, () => "");
  const colorBy: ColorBy = s === "stage" || s === "rating" ? s : anyRated ? "rating" : "stage";
  const set = (c: ColorBy) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // Storage blocked: the choice holds until the page changes.
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  return [colorBy, set];
}

/** Stage or rating, and what the colors mean. */
export function ColorBySwitch({ value, onChange }: { value: ColorBy; onChange: (c: ColorBy) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <div role="radiogroup" aria-label="Color cards by" className="inline-flex overflow-hidden rounded-md border border-line">
        {(["stage", "rating"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            onClick={() => onChange(c)}
            className={`px-2.5 py-1 ${value === c ? "bg-ink text-bg" : "bg-panel text-muted hover:text-ink"}`}
          >
            {c === "stage" ? "Stage" : "Rating"}
          </button>
        ))}
      </div>
      {value === "rating" && (
        <ul aria-label="Rating colors" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted" data-testid="rating-legend">
          {RATING_BANDS.map((b) => (
            <li key={b.id} className="flex items-center gap-1">
              <span aria-hidden className={`inline-block size-2.5 rounded-sm ${RATING_BG[b.id]}`} />
              {b.label}
            </li>
          ))}
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rounded-sm border border-line" style={UNRATED_STYLE} />
            not rated
          </li>
          <li className="flex items-center gap-1">
            <span aria-hidden className="inline-block size-2.5 rounded-sm bg-muted opacity-40" />
            faded: edited since
          </li>
        </ul>
      )}
    </div>
  );
}

const NAME: Record<Assistant, string> = { claude: "Claude", chatgpt: "ChatGPT" };
const POLL_MS = 4000;

const RATE_PROMPT = "Rate every piece of writing on my desk.";

/**
 * Rate my essays: queue a rating request for the counselor (or a watching chat). The ratings
 * stream onto the board as they are saved; the answer is a short summary.
 */
export function RateRequest({
  deskId,
  assistants,
  pending: initialPending,
  last,
  bridge,
}: {
  deskId: string;
  assistants: Assistant[];
  pending: DeskRequest | null;
  last: DeskRequest | null;
  /** The database takes rating requests (migration 20261025). */
  bridge: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<DeskRequest | null>(initialPending);
  const [queuing, setQueuing] = useState(false);
  const [answered, setAnswered] = useState<DeskRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useModelChoice("rate");

  const pendingId = pending?.id ?? null;
  useEffect(() => {
    if (!pendingId) return;
    const supabase = supabaseBrowser();
    let stopped = false;
    async function check() {
      const { data, error: e } = await supabase.from("desk_requests").select(REQUEST_COLS).eq("id", pendingId).maybeSingle();
      if (stopped || e) return;
      const r = data as DeskRequest | null;
      if (!r || r.status !== "pending") {
        setPending(null);
        if (r?.status === "answered") setAnswered(r);
        router.refresh();
      }
    }
    void check();
    const timer = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [pendingId, router]);

  if (!bridge) return null;
  if (assistants.length === 0) {
    return (
      <p className="text-sm text-muted">
        Connect Claude or ChatGPT in{" "}
        <Link href="/desk/settings/connectors" className="text-accent underline">
          Settings
        </Link>{" "}
        and it can rate your essays.
      </p>
    );
  }

  async function queue(a: Assistant) {
    setPreferredAssistant(a);
    setError(null);
    setAnswered(null);
    setQueuing(true);
    try {
      setPending(await queueRequest(supabaseBrowser(), { deskId, kind: "rate", prompt: RATE_PROMPT, model }));
    } catch (e) {
      setError(`Couldn't ask ${NAME[a]}: ${(e as Error).message}`);
    } finally {
      setQueuing(false);
    }
  }

  async function cancel() {
    if (!pending) return;
    const { error: e } = await supabaseBrowser().from("desk_requests").update({ status: "dismissed" }).eq("id", pending.id);
    if (e) setError(e.message);
    else setPending(null);
  }

  const whoName = assistants.length === 1 ? NAME[assistants[0]] : "your counselor";
  const shown = answered ?? (pending ? null : last);

  return (
    <div className="mb-4 flex flex-col gap-2 text-sm" data-testid="rate-request">
      {pending || queuing ? (
        <div role="status" className="rounded-md border border-accent bg-accent-soft px-3 py-2">
          <p className="font-medium">Waiting for {whoName} to rate your essays…</p>
          <p className="mt-1">
            If your counselor or a {whoName} chat is watching your desk it starts now, and each piece is colored by its rating as
            it&apos;s saved. If not, turn on your counselor in Settings, or say &ldquo;{WATCH_PHRASE}&rdquo; in your {whoName} chat.
          </p>
          <button type="button" className="btn mt-2" onClick={cancel} disabled={queuing}>
            Cancel request
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {assistants.map((a) => (
            <button key={a} type="button" className="btn" onClick={() => void queue(a)}>
              Rate my essays{assistants.length > 1 ? ` with ${NAME[a]}` : ""}
            </button>
          ))}
          <ModelPicker value={model} onChange={setModel} />
          <span className="text-xs text-muted">Each piece against other applicants to that college, on that prompt.</span>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">
          {error}
        </p>
      )}
      {shown?.answer && (
        <details className="text-muted" open={!!answered}>
          <summary className="cursor-pointer">
            {answered ? `${answered.answered_by || whoName} rated your essays` : "Last rated"}
            {!answered && shown.answered_at && (
              <>
                {" "}
                <LocalDay at={shown.answered_at} />
              </>
            )}
            {!answered && shown.answered_by ? ` by ${shown.answered_by}` : ""}
          </summary>
          <div className="mt-1 text-ink">
            <AnswerText text={shown.answer} />
          </div>
        </details>
      )}
    </div>
  );
}
