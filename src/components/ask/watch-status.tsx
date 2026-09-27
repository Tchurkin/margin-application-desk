"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { activityText, fetchConnectors, isCounselor, WATCH_PHRASE, watcher, type Connector } from "@/lib/bridge/watchers";
import { COUNSELOR_VERSION } from "@/lib/counselor/version";
import { supabaseBrowser } from "@/lib/supabase/client";

/** The desk's connectors, re-read every `every` ms while the page is visible and on return to it. */
export function useConnectors(deskId: string, every = 15_000) {
  const supabase = supabaseBrowser();
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const reload = useCallback(() => fetchConnectors(supabase, deskId).then((c) => c && setConnectors(c)), [supabase, deskId]);

  useEffect(() => {
    let alive = true;
    void fetchConnectors(supabase, deskId).then((c) => alive && c && setConnectors(c));
    const again = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const t = setInterval(again, every);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [supabase, deskId, reload, every]);

  return { connectors, reload };
}

/** A counselor running an older watcher than this site offers. */
export function isOutdated(c: Connector | null): boolean {
  return !!c && c.counselor_version !== undefined && c.counselor_version.split("-")[0] !== COUNSELOR_VERSION;
}

/** The computer a counselor runs on: the Mac one reports its version as "3-mac". */
export function counselorPlatform(c: Connector): "windows" | "mac" {
  return c.counselor_version?.endsWith("-mac") ? "mac" : "windows";
}

/** One line: who is answering the desk right now and what it's doing, or how to get someone to. */
export function WatchStatus({ connectors, now }: { connectors: Connector[] | null; now: number }) {
  if (!connectors?.length) return null;
  const w = watcher(connectors, now);
  const counselor = isCounselor(w, now);
  const paused = counselor && !!w?.counselor_paused;
  const doing = activityText(w, now);
  const link = "underline underline-offset-2";
  return (
    <p
      role="status"
      data-testid="watch-status"
      className={`flex flex-wrap items-center gap-1.5 text-xs ${paused ? "text-warn" : w ? "text-accent" : "text-muted"}`}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${paused ? "bg-warn" : w ? "bg-accent" : "bg-line"}`} />
      {paused ? (
        <>
          Your counselor is paused.{" "}
          <Link href="/desk/settings/counselor" className={link}>
            Resume it
          </Link>
        </>
      ) : w ? (
        <>
          {counselor ? (doing ? `Your counselor is ${doing}…` : "Your counselor is on and watching your desk: ask away.") : `${w.label} is ${doing ?? "watching your desk: ask away"}${doing ? "…" : "."}`}
          {counselor && isOutdated(w) && (
            <Link href="/desk/settings/counselor" className={link}>
              An update is ready
            </Link>
          )}
        </>
      ) : (
        <>
          Not watching.{" "}
          <Link href="/desk/settings/counselor" className={link}>
            Set up your counselor
          </Link>{" "}
          to have answers arrive on their own, or say &ldquo;{WATCH_PHRASE}&rdquo; in a Claude or ChatGPT chat.
          <button type="button" className={link} onClick={() => void navigator.clipboard?.writeText(WATCH_PHRASE)}>
            Copy
          </button>
        </>
      )}
    </p>
  );
}
