"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { noticeFor, onTab, showing, type Notice, type NoticeTab } from "@/lib/bridge/notices";
import { ASKED_COLS, type DeskRequest } from "@/lib/bridge/requests";
import { clearUnread, markUnread, subscribeUnread } from "@/lib/bridge/unread";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * When Claude answers something on the desk while the student is on another page, the page it
 * belongs to gets a dot in the tabs (DeskNav) and a short note says where to find it. If the
 * site isn't the browser tab they're looking at, its title gets a dot too.
 */

const SHOWN_MS = 12_000;
const FRESH_MS = 60_000;
const POLL_MS = 10_000;
const TABS: NoticeTab[] = ["Write", "Strategy", "Profile", "Counselor"];
const DOT = "● ";

type Seen = Pick<DeskRequest, "id" | "kind" | "status" | "piece_id" | "answered_by" | "answered_at" | "asked_by">;
const SEEN_COLS = "id, kind, status, piece_id, answered_by, answered_at";
const STEP: Record<Seen["status"], number> = { pending: 0, answered: 1, dismissed: 2 };

export function DeskNotices({ deskId }: { deskId: string }) {
  const path = usePathname();
  const where = useRef(path);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ready, setReady] = useState(false);

  // Opening what a note points to is reading it.
  if (notice && showing(notice, path)) setNotice(null);

  // What's on screen is read: its tab's dot goes, now, on coming back to the browser tab, and when
  // another browser tab marks it.
  useEffect(() => {
    where.current = path;
    const clear = () => {
      if (document.visibilityState !== "visible") return;
      if (document.title.startsWith(DOT)) document.title = document.title.slice(DOT.length);
      for (const t of TABS) if (onTab(t, path)) clearUnread(deskId, t);
    };
    clear();
    document.addEventListener("visibilitychange", clear);
    const stop = subscribeUnread(deskId, clear);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", clear);
    };
  }, [path, deskId]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const statuses = new Map<string, Seen["status"]>();
    let seeded = false;

    const announce = async (row: Seen) => {
      let title: string | null = null;
      if (row.piece_id && (row.kind === "ask" || row.kind === "polish")) {
        const { data } = await supabase.from("pieces").select("title").eq("id", row.piece_id).maybeSingle();
        title = (data?.title as string | undefined) ?? null;
      }
      const n = noticeFor(row, where.current, title);
      if (!n) return;
      // On its own tab already (another piece of writing), the note says which; the dot is for other tabs.
      if (!onTab(n.tab, where.current)) markUnread(deskId, n.tab);
      setNotice(n);
      if (document.visibilityState !== "visible" && !document.title.startsWith(DOT)) document.title = DOT + document.title;
    };

    const consider = (row: Seen, loud = true) => {
      const before = statuses.get(row.id);
      // A slower read can't take a row back (answered, then an older copy saying pending).
      if (before && STEP[row.status] < STEP[before]) return;
      statuses.set(row.id, row.status);
      if (!loud || row.status !== "answered" || before === "answered") return;
      // Seen pending here, or answered just now (while this page was catching up).
      const fresh = before === "pending" || (!!row.answered_at && Date.now() - Date.parse(row.answered_at) < FRESH_MS);
      if (fresh) void announce(row);
    };

    // What realtime missed: before it connected, while it was down, while the tab slept. The first
    // read only learns what's there, so a reload doesn't announce answers again.
    const catchUp = async () => {
      const query = (cols: string) =>
        supabase
          .from("desk_requests")
          .select(cols)
          .eq("desk_id", deskId)
          .in("status", ["pending", "answered"])
          .order("answered_at", { ascending: false, nullsFirst: true })
          .limit(50);
      let { data, error } = await query(SEEN_COLS + ASKED_COLS);
      // A database from before the shared chat (migration 20261019).
      if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await query(SEEN_COLS));
      const loud = seeded;
      seeded = true;
      for (const r of (data ?? []) as unknown as Seen[]) consider(r, loud);
    };

    const stop = subscribeDeskRequests(supabase, deskId, {
      onRow: (row) => consider(row),
      onDelete: (id) => statuses.delete(id),
      onReady: () => {
        setReady(true);
        void catchUp();
      },
    });
    // A backstop for a dropped realtime connection while an answer is due.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && [...statuses.values()].includes("pending")) void catchUp();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && seeded) void catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deskId]);

  // The note stays until the student has had it in view for a while.
  useEffect(() => {
    if (!notice) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      if (document.visibilityState === "visible" && !t) t = setTimeout(() => setNotice(null), SHOWN_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [notice]);

  return (
    <div
      data-testid="desk-notices"
      data-ready={ready ? "true" : "false"}
      role="status"
      className="desk-notices pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2"
    >
      {notice && (
        <div className="card pointer-events-auto flex items-start gap-3 px-4 py-3 text-sm shadow-lg">
          <span aria-hidden className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 flex-1">
            {notice.text}{" "}
            <Link href={notice.href} className="font-medium text-accent underline underline-offset-2" onClick={() => setNotice(null)}>
              Open
            </Link>
          </span>
          <button type="button" aria-label="Dismiss" className="shrink-0 text-muted hover:text-ink" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
