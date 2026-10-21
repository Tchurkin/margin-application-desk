"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFolds } from "@/components/progress/use-folds";
import { withLetter, type LetterStatus, type Recommender } from "@/lib/board/letters";
import type { PieceStatus } from "@/lib/domain/colleges";
import { localISODate } from "@/lib/progress/due";
import { applyPieceChange, buildLanes, withPending, type PieceChange, type ProgressCollege } from "@/lib/progress/lanes";
import { loadProgress, type ProgressData } from "@/lib/progress/load";
import { stageIndex, stageLabel } from "@/lib/progress/stages";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLiveWaiting } from "@/components/waiting-badges";
import type { Waiting } from "@/lib/data/waiting";
import { RecommendersBar, type LetterActions } from "./letters";
import { Swimlanes, type BoardMove, type LaneContext } from "./swimlanes";

/*
 * The master board: every college with its deadline, portal, round and letters, and every piece
 * at its stage. It starts from what the server loaded, then keeps itself current: changes to
 * pieces, recommenders and letters stream in (from the editor, another screen or the counselor),
 * and it reloads when the tab regains focus, which also covers a database without live updates.
 * A move or a letter change shows at once and is saved in the background; if the save fails the
 * board goes back and says why.
 */

type BoardData = Omit<ProgressData, "behind">;

interface Notice {
  kind: "done" | "error";
  text: string;
}

/** The student's calendar day, checked every minute so "today" rolls over at midnight. */
function subscribeClock(onChange: () => void) {
  const t = setInterval(onChange, 60_000);
  return () => clearInterval(t);
}

const REC_COLS = "id, name, role, color, created_at";

export function MasterBoard({
  deskId,
  initial,
  serverToday,
  base,
  canWrite,
  collegeLinks,
  behind,
  waiting: initialWaiting,
}: {
  deskId: string;
  initial: BoardData;
  /** Suggestions and comments waiting on each piece, as the page loaded. */
  waiting?: Record<string, Waiting>;
  /** The server's date, used until the browser's own calendar day takes over. */
  serverToday: string;
  /** "/desk" for the owner, "/shared/<id>" for people it's shared with. */
  base: string;
  canWrite: boolean;
  collegeLinks: boolean;
  /** The database is a migration behind: say that updates only arrive on refocus. */
  behind?: boolean;
}) {
  const [data, setData] = useState<BoardData>(initial);
  const pieceIds = useMemo(() => data.pieces.map((p) => p.id), [data.pieces]);
  const waiting = useLiveWaiting(initialWaiting, pieceIds, deskId);
  // Moves still being saved, shown ahead of the database.
  const [pending, setPending] = useState<ReadonlyMap<string, PieceStatus>>(() => new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const today = useSyncExternalStore(subscribeClock, () => localISODate(), () => serverToday);
  const { folded, toggle, setFolded } = useFolds();
  // Bumped by every change made here, so a reload that started before it can't undo it.
  const epoch = useRef(0);
  // Where focus goes after a keyboard move re-creates the piece's element.
  const refocus = useRef<string | null>(null);
  // The stage each piece with a save under way should end up at.
  const saving = useRef(new Map<string, PieceStatus>());
  const held = useRef({ colleges: new Set<string>(), recommenders: new Set<string>() });
  useEffect(() => {
    held.current = { colleges: new Set(data.colleges.map((c) => c.id)), recommenders: new Set(data.recommenders.map((r) => r.id)) };
  }, [data.colleges, data.recommenders]);

  const refresh = useCallback(async () => {
    const started = epoch.current;
    try {
      const next = await loadProgress(supabaseBrowser(), deskId);
      if (started !== epoch.current) return;
      setData({
        colleges: next.colleges,
        pieces: next.pieces,
        recommenders: next.recommenders,
        letters: next.letters,
        lettersReady: next.lettersReady,
      });
    } catch {
      // Offline or signed out: keep showing what we have.
    }
  }, [deskId]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const apply = (change: PieceChange) =>
      setData((d) => {
        const pieces = applyPieceChange(d.pieces, change);
        return pieces === d.pieces ? d : { ...d, pieces };
      });
    const filter = `desk_id=eq.${deskId}`;
    const again = () => void refresh();
    // A fresh topic per mount: a remount can't pick up a channel that is still closing.
    const channel = supabase
      .channel(`board:${deskId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pieces", filter }, (p) =>
        apply({ type: "INSERT", row: p.new as Record<string, unknown> }),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pieces", filter }, (p) =>
        apply({ type: "UPDATE", row: p.new as Record<string, unknown> }),
      )
      // Deletes carry only the key and can't be filtered by desk; ones we don't hold are ignored.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pieces" }, (p) => {
        const id = (p.old as { id?: unknown }).id;
        if (typeof id === "string") apply({ type: "DELETE", id });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "colleges", filter }, again)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "colleges", filter }, again)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "colleges" }, (p) => {
        if (held.current.colleges.has((p.old as { id?: string }).id ?? "")) again();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "recommenders", filter }, again)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "recommenders", filter }, again)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "recommenders" }, (p) => {
        if (held.current.recommenders.has((p.old as { id?: string }).id ?? "")) again();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "letters", filter }, again)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "letters", filter }, again)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "letters" }, (p) => {
        if (held.current.colleges.has((p.old as { college_id?: string }).college_id ?? "")) again();
      })
      .subscribe((status) => {
        // Connected (or reconnected): catch up on anything missed meanwhile.
        if (status === "SUBSCRIBED") again();
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [deskId, refresh]);

  // After a keyboard move, keep focus on the piece even though its card moved to another column.
  useEffect(() => {
    const token = refocus.current;
    if (!token) return;
    refocus.current = null;
    const el = document.querySelector<HTMLElement>(`[data-focus~="${CSS.escape(token)}"]`);
    if (el && el !== document.activeElement) el.focus();
  });

  const move: BoardMove = useCallback(
    (piece, to, focusToken) => {
      // The same column is no move: a submitted piece dropped back in Final stays submitted.
      if (!canWrite || stageIndex(piece.status) === stageIndex(to)) return;
      epoch.current++;
      refocus.current = focusToken;
      setNotice(null);
      setPending((m) => new Map(m).set(piece.id, to));
      const wanted = saving.current;
      const running = wanted.has(piece.id);
      wanted.set(piece.id, to);
      if (running) return; // the save already under way picks up the new stage when it's done

      // One save at a time per piece, always of the latest stage asked for: two requests in
      // flight at once could land in either order and leave the older stage saved.
      void (async () => {
        let written: PieceStatus | null = null;
        let failure: string | null = null;
        for (let target = wanted.get(piece.id)!; target !== written; target = wanted.get(piece.id)!) {
          try {
            const { data: rows, error } = await supabaseBrowser()
              .from("pieces")
              .update({ status: target })
              .eq("id", piece.id)
              .select("id");
            // No row back means the database refused it quietly (row-level security).
            if (error || !rows?.length) failure = error ? error.message : "You may not have permission to change it.";
          } catch (e) {
            failure = e instanceof Error ? e.message : "The connection dropped.";
          }
          if (failure) break;
          written = target;
        }
        const last = wanted.get(piece.id)!;
        wanted.delete(piece.id);
        setPending((m) => {
          const next = new Map(m);
          next.delete(piece.id);
          return next;
        });
        if (written) {
          const saved = written;
          setData((d) => ({ ...d, pieces: d.pieces.map((p) => (p.id === piece.id ? { ...p, status: saved } : p)) }));
        }
        setNotice(
          failure
            ? {
                kind: "error",
                text: `Couldn't move “${piece.title}” to ${stageLabel(last)}${
                  written ? `; it's at ${stageLabel(written)}` : ", so it's back where it was"
                }. ${failure}`,
              }
            : { kind: "done", text: `Moved “${piece.title}” to ${stageLabel(last)}.` },
        );
      })();
    },
    [canWrite],
  );

  // ─── recommenders and letters ──────────────────────────────────────────────

  const failed = useCallback(
    (what: string, message: string) => {
      setNotice({ kind: "error", text: `Couldn't ${what}. ${message}` });
      void refresh();
    },
    [refresh],
  );

  const setLetter = useCallback(
    (recommenderId: string, collegeId: string, status: LetterStatus | null) => {
      epoch.current++;
      setNotice(null);
      setData((d) => ({ ...d, letters: withLetter(d.letters, recommenderId, collegeId, status) }));
      const sb = supabaseBrowser();
      const save = status
        ? sb
            .from("letters")
            .upsert({ college_id: collegeId, recommender_id: recommenderId, desk_id: deskId, status }, { onConflict: "college_id,recommender_id" })
        : sb.from("letters").delete().eq("college_id", collegeId).eq("recommender_id", recommenderId);
      void Promise.resolve(save).then(
        ({ error }) => error && failed("change the letter", error.message),
        (e: Error) => failed("change the letter", e.message),
      );
    },
    [deskId, failed],
  );

  const letterActions: LetterActions = {
    canWrite,
    ready: data.lettersReady,
    recommenders: data.recommenders,
    letters: data.letters,
    setLetter,
    addRecommender: async (fields, collegeId) => {
      epoch.current++;
      const { data: made, error } = await supabaseBrowser()
        .from("recommenders")
        .insert({ desk_id: deskId, name: fields.name, role: fields.role })
        .select(REC_COLS)
        .single();
      if (error || !made) {
        failed("add the recommender", error?.message ?? "");
        return false;
      }
      const r = made as Recommender;
      setData((d) => ({ ...d, recommenders: [...d.recommenders.filter((x) => x.id !== r.id), r] }));
      if (collegeId) setLetter(r.id, collegeId, "planned");
      return true;
    },
    saveRecommender: async (id, fields) => {
      epoch.current++;
      setData((d) => ({ ...d, recommenders: d.recommenders.map((r) => (r.id === id ? { ...r, ...fields } : r)) }));
      const { error } = await supabaseBrowser().from("recommenders").update(fields).eq("id", id);
      if (error) {
        failed("save the recommender", error.message);
        return false;
      }
      return true;
    },
    deleteRecommender: async (id) => {
      epoch.current++;
      const { error } = await supabaseBrowser().from("recommenders").delete().eq("id", id);
      if (error) {
        failed("remove the recommender", error.message);
        return false;
      }
      setData((d) => ({
        ...d,
        recommenders: d.recommenders.filter((r) => r.id !== id),
        letters: d.letters.filter((l) => l.recommender_id !== id),
      }));
      return true;
    },
  };

  // Submitting a whole application: the college gets its date, its pieces are marked submitted.
  // Undoing it puts them back at Final. On a database without submitted_at (migration 20261007)
  // the pieces alone carry it.
  const submit = useCallback(
    async (college: ProgressCollege, on: boolean) => {
      epoch.current++;
      setNotice(null);
      const marked = college.submitted_at !== undefined;
      if (on && !marked && !data.pieces.some((p) => p.college_id === college.id)) {
        setNotice({ kind: "error", text: "Run the latest database update to submit a college with no pieces yet." });
        return;
      }
      const at = on ? new Date().toISOString() : null;
      setData((d) => ({
        ...d,
        colleges: d.colleges.map((c) => (c.id === college.id && marked ? { ...c, submitted_at: at } : c)),
        pieces: d.pieces.map((p) =>
          p.college_id !== college.id ? p : { ...p, status: on ? "submitted" : p.status === "submitted" ? "final" : p.status },
        ),
      }));
      const sb = supabaseBrowser();
      let failure: string | null = null;
      try {
        if (marked) {
          const { error } = await sb.from("colleges").update({ submitted_at: at }).eq("id", college.id);
          if (error) failure = error.message;
        }
        if (!failure) {
          const pieces = sb.from("pieces").update({ status: on ? "submitted" : "final" }).eq("college_id", college.id);
          const { error } = await (on ? pieces.neq("status", "submitted") : pieces.eq("status", "submitted"));
          if (error) failure = error.message;
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : "The connection dropped.";
      }
      if (failure) {
        setNotice({ kind: "error", text: `Couldn't ${on ? "submit" : "undo"} ${college.name}. ${failure}` });
        void refresh();
      } else {
        epoch.current++;
        void refresh();
        setNotice({ kind: "done", text: on ? `Submitted ${college.name}.` : `${college.name} is back on the board.` });
      }
    },
    [data.pieces, refresh],
  );

  const pieces = useMemo(() => withPending(data.pieces, pending), [data.pieces, pending]);
  const lanes = useMemo(() => buildLanes(data.colleges, pieces, today), [data.colleges, pieces, today]);
  const ctx: LaneContext = { today, base, canWrite, collegeLinks, onMove: move, onSubmit: submit, letters: letterActions, waiting };
  // Submitted colleges fold on their own; Fold all is for the rest.
  const keys = lanes.filter((l) => !l.submitted).map((l) => l.key);
  const anyFolded = keys.some((k) => folded.has(k));

  if (lanes.length === 0) {
    return (
      <div className="card px-4 py-6">
        <p className="font-medium">Nothing on the board yet.</p>
        <p className="mt-1 text-sm text-muted">
          {collegeLinks ? (
            <>
              <Link href={`${base}/add/college`} className="underline">
                Add a college
              </Link>{" "}
              or an independent piece, or{" "}
              <Link href={`${base}/import`} className="underline">
                import your essays
              </Link>
              ; each piece shows up here at its stage.
            </>
          ) : (
            "When colleges and essays are added to this desk, they show up here."
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <RecommendersBar actions={letterActions} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Announces each move to screen readers; also a quiet confirmation on screen. */}
        <p role="status" className="min-h-5 text-sm text-muted">
          {notice?.kind === "done" ? notice.text : ""}
        </p>
        <button type="button" className="btn" onClick={() => setFolded(anyFolded ? [] : keys)}>
          {anyFolded ? "Unfold all" : "Fold all"}
        </button>
      </div>
      {notice?.kind === "error" && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{notice.text}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Swimlanes lanes={lanes} folded={folded} onFold={toggle} ctx={ctx} />

      {behind && (
        <p className="mt-4 text-xs text-muted">
          Run the latest database update to see changes from other screens live and to give pieces their own due dates. Until
          then this board refreshes when you come back to it.
        </p>
      )}
    </div>
  );
}
