"use client";

import { useEffect, useMemo, useState } from "react";
import { loadWaiting, type Waiting } from "@/lib/data/waiting";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Small counts beside a piece (or a folded college): suggestions in green, comments in amber. */
export function WaitingBadges({ w }: { w: Waiting }) {
  if (!w.suggestions && !w.comments) return null;
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1" data-testid="rail-waiting">
      {w.suggestions > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-add-soft px-1.5 text-[11px] leading-4 font-semibold text-add"
          title={`${w.suggestions} suggestion${w.suggestions === 1 ? "" : "s"} waiting`}
          data-testid="rail-suggestions"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13l1-3.5L10.5 3l2.5 2.5L6.5 12z" />
          </svg>
          {w.suggestions}
        </span>
      )}
      {w.comments > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 text-[11px] leading-4 font-semibold text-warn"
          title={`${w.comments} comment${w.comments === 1 ? "" : "s"} waiting`}
          data-testid="rail-comments"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          </svg>
          {w.comments}
        </span>
      )}
    </span>
  );
}

/** How often the counts are read again while the page is in view. */
const POLL_MS = 10_000;

/**
 * The counts as the page loaded them, kept current: whenever a suggestion or comment the viewer
 * can read is made, changed or dealt with, they are read again (a moment later, once for a burst).
 */
export function useLiveWaiting(initial: Record<string, Waiting> | undefined, pieceIds: string[], deskId: string): Record<string, Waiting> {
  const [waiting, setWaiting] = useState<Record<string, Waiting>>(initial ?? {});
  const ids = useMemo(() => pieceIds.slice().sort().join(","), [pieceIds]);
  // A new page's counts take over from what was read before.
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setWaiting(initial ?? {});
  }
  useEffect(() => {
    if (!deskId || !ids) return;
    const supabase = supabaseBrowser();
    const list = ids.split(",");
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const again = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadWaiting(supabase, list).then((w) => alive && setWaiting(w));
      }, 400);
    };
    const channel = supabase
      .channel(`waiting:${deskId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "suggestions" }, again)
      .subscribe((status) => status === "SUBSCRIBED" && again());
    // Changes to a whole desk's suggestions don't always arrive live: read again now and then
    // while the page is in view, and on coming back to it.
    const poll = setInterval(() => document.visibilityState === "visible" && again(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && again();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [deskId, ids]);
  return waiting;
}
