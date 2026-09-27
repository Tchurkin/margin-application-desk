"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import type { DeskRequest } from "@/lib/bridge/requests";
import { hasWaiting, mergeRequest, removeRequest } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fetchThread, RequestItem } from "./ask-panel";

/*
 * The Ask chat on an essay, for someone the desk is shared with (Braxton's call, 9/27/26): the
 * student's questions and theirs, with who asked each, answered by the student's counselor on the
 * student's computer. They can ask (if they can suggest or edit) while that counselor is on. What's
 * only the student's stays out: rewrites in the essay, dismissing, choosing the model.
 */

const POLL_MS = 10_000;
const ON_MS = 15_000;

type Phase = "loading" | "ready" | "missing" | "error";

export function SharedAskPanel({ deskId, pieceId, pieceTitle, canAsk }: { deskId: string; pieceId: string; pieceTitle: string; canAsk: boolean }) {
  const supabase = supabaseBrowser();
  const ids = useId();
  const now = useNow(5_000);
  const [thread, setThread] = useState<{ pieceId: string; phase: Phase; rows: DeskRequest[] }>({ pieceId, phase: "loading", rows: [] });
  const [on, setOn] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);

  const current = thread.pieceId === pieceId ? thread : { pieceId, phase: "loading" as Phase, rows: [] };
  const { phase, rows } = current;

  const load = useCallback(
    () =>
      fetchThread(supabase, pieceId, epoch).then((f) =>
        setThread((t) => (f.ok ? { pieceId, phase: "ready", rows: f.rows } : { pieceId, phase: f.phase, rows: t.pieceId === pieceId ? t.rows : [] })),
      ),
    [supabase, pieceId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live: the counselor's answers, and questions from the student or others on the desk.
  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) => {
          epoch.current++;
          setThread((t) => (t.pieceId === pieceId ? { ...t, rows: mergeRequest(t.rows, row, pieceId) } : t));
        },
        onDelete: (id) => {
          epoch.current++;
          setThread((t) => (t.pieceId === pieceId ? { ...t, rows: removeRequest(t.rows, id) } : t));
        },
        onReady: () => void load(),
      }),
    [supabase, deskId, pieceId, load],
  );

  // A backstop for a dropped realtime connection while an answer is due, and for what realtime
  // can't bring here: a question the student dismisses is one this viewer may no longer read.
  const waiting = hasWaiting(rows);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void load(), waiting ? POLL_MS : ON_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  // Whether the student's counselor is on, so a question would be answered now.
  useEffect(() => {
    let alive = true;
    const check = () =>
      void supabase.rpc("desk_counselor_on", { d: deskId }).then(({ data, error }) => alive && setOn(error ? false : !!data));
    check();
    const t = setInterval(check, ON_MS);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [supabase, deskId]);

  async function send() {
    const question = draft.trim();
    if (!question || busy || !on) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("ask_on_shared_desk", { piece: pieceId, question });
    setBusy(false);
    if (error) return setError(error.message);
    epoch.current++;
    setThread((t) => (t.pieceId === pieceId ? { ...t, rows: mergeRequest(t.rows, data as DeskRequest, pieceId) } : t));
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div data-testid="shared-ask-panel" className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <p className="label mb-0.5">Asking about</p>
        <p className="font-serif text-lg leading-tight break-words">{pieceTitle}</p>
        <p className="mt-1.5 text-xs text-muted">
          Questions here go to the student&apos;s counselor (Claude, on their computer), and everyone on the desk sees them and the
          answers.
        </p>
      </div>

      <p data-testid="counselor-on" className={`text-xs ${on ? "text-accent" : "text-muted"}`}>
        {on === null ? "" : on ? "The student's counselor is on." : "The student's counselor is off right now."}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {phase === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {phase === "missing" && <p className="text-sm text-muted">The Ask chat isn&apos;t available on this desk yet.</p>}
        {phase === "error" && <p className="text-sm text-danger">Couldn&apos;t load this piece&apos;s questions.</p>}
        {phase === "ready" && rows.length === 0 && <p className="text-sm text-muted">No questions about this piece yet.</p>}
        {rows.length > 0 && (
          <ol aria-label="Questions and answers" aria-live="polite" className="flex flex-col gap-4">
            {rows.map((r) => (
              <RequestItem key={r.id} r={r} viewer="guest" now={now} waitingFor="the counselor" doing={null} showing={null} kept={null} onShow={() => {}} />
            ))}
          </ol>
        )}
      </div>

      {canAsk ? (
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`${ids}-q`} className="sr-only">
            Ask about this piece
          </label>
          <textarea
            id={`${ids}-q`}
            className="field min-h-20 resize-y"
            rows={3}
            value={draft}
            disabled={!on}
            placeholder={on ? "Ask about this piece…" : "You can ask once the student's counselor is on."}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !on || !draft.trim()}>
              Send
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="border-t border-line pt-3 text-xs text-muted">You can read along here. Asking takes suggest or edit access.</p>
      )}
    </div>
  );
}
