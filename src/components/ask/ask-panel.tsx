"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { parseOptions } from "@/lib/bridge/options";
import {
  ASKED_COLS,
  assistantLabel,
  bridgeMissing,
  queueRequest,
  REQUEST_COLS,
  type Assistant,
  type DeskRequest,
} from "@/lib/bridge/requests";
import { clip, hasWaiting, mergeRequest, removeRequest, sortThread, THREAD_KINDS, THREAD_LIMIT, whenLabel } from "@/lib/bridge/thread";
import { useAssistant } from "@/lib/bridge/use-assistant";
import { useNow } from "@/lib/bridge/use-now";
import { activityOn, counselors, isCounselor, WATCH_PHRASE, watcher } from "@/lib/bridge/watchers";
import { offerRewrites, onRewriteEvent } from "@/lib/editor/rewrites";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AnswerText } from "./answer-text";
import { ModelPicker, useModelChoice } from "./model-picker";
import { PendingAnswer } from "./pending-answer";
import { useConnectors, WatchStatus } from "./watch-status";

/**
 * The Ask panel: questions about a piece, answered through the connector and shown here live.
 * With a passage highlighted, a message asks for rewrites of it: the counselor answers with a
 * few versions, and the first one shows in the essay in place of the passage (← → to switch,
 * Enter to keep, Esc to go back; see src/lib/editor/rewrites.ts).
 *
 * The website can't talk to Claude or ChatGPT itself. Asking queues a request on the desk; the
 * counselor on the student's computer, or a chat they told to watch the desk, picks it up and
 * answers through the connector (answer_request). The answer
 * arrives here over realtime, with a refresh on focus and a slow poll while anything is waiting
 * as a backstop.
 *
 * Contract used by the Write workspace:
 *   <AskPanel deskId pieceId pieceTitle getSelection />
 * - getSelection() returns the text currently selected in the editor ("" if none), used to
 *   point the AI at a passage and ask for rewrites of it.
 * - collegeName and aiPolicy are optional extras: the header names the college, and a college
 *   that doesn't allow AI help with drafting gets advice instead of rewrites.
 */
export interface AskPanelProps {
  deskId: string;
  pieceId: string;
  pieceTitle: string;
  getSelection: () => string;
  collegeName?: string | null;
  aiPolicy?: "allowed" | "no_drafting";
}

type Phase = "loading" | "ready" | "missing" | "error";

/** Rows are held with the piece they were loaded for, so switching pieces never shows the last one's thread. */
interface Thread {
  pieceId: string;
  phase: Phase;
  rows: DeskRequest[];
}

type Notice =
  | { kind: "queued"; watching: boolean; counselor: boolean; paused: boolean; label: string; polish: boolean }
  | { kind: "info"; text: string }
  | { kind: "connect" }
  | { kind: "error"; text: string };

const QUICK = ["What's the weakest part?", "How do I cut this to the limit?", "Does this answer the prompt?"];
const POLL_MS = 10_000;
const NOT_YET = "Run the latest database update to use this.";

const errText = (e: unknown) => (e as { message?: string })?.message || "unknown error";

type Fetched = { ok: true; rows: DeskRequest[] } | { ok: false; phase: "missing" | "error" };

/**
 * The piece's thread, newest 100, oldest first. If a local or live change lands while the
 * fetch is out, the result may already be stale, so it asks again (twice at most).
 */
export async function fetchThread(supabase: SupabaseClient, pieceId: string, epoch: { current: number }): Promise<Fetched> {
  const query = (cols: string) =>
    supabase
      .from("desk_requests")
      .select(cols)
      .eq("piece_id", pieceId)
      .in("kind", THREAD_KINDS)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
  for (let attempt = 0; ; attempt++) {
    const started = epoch.current;
    let { data, error } = await query(REQUEST_COLS + ASKED_COLS);
    // A database before migration 20261019 has no asked_by: then everything was the student's.
    if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await query(REQUEST_COLS));
    if (epoch.current !== started && attempt < 2) continue;
    if (error) return { ok: false, phase: bridgeMissing(error) ? "missing" : "error" };
    return { ok: true, rows: sortThread((data ?? []) as unknown as DeskRequest[], pieceId) };
  }
}

export function AskPanel({ deskId, pieceId, pieceTitle, getSelection, collegeName = null, aiPolicy = "allowed" }: AskPanelProps) {
  const supabase = supabaseBrowser();
  const ids = useId();
  // Ticks often enough to follow what the counselor is doing.
  const now = useNow(5_000);
  const [thread, setThread] = useState<Thread>({ pieceId, phase: "loading", rows: [] });
  const { connectors } = useConnectors(deskId);
  const onlyChatGPT = !!connectors?.length && connectors.every((c) => c.label === "ChatGPT");
  const [assistant, setAssistant] = useAssistant(onlyChatGPT ? "chatgpt" : "claude");
  const label = assistantLabel(assistant);
  const [draft, setDraft] = useState("");
  const [pointed, setPointed] = useState("");
  const [ignored, setIgnored] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<(Notice & { pieceId: string }) | null>(null);
  const [model, setModel] = useModelChoice("ask");
  // Rewrites showing in the essay (which request, which version), and ones already kept.
  const [showing, setShowing] = useState<{ requestId: string; index: number } | null>(null);
  const [kept, setKept] = useState<Record<string, number>>({});
  // A rewrite request sent from here: its versions show in the essay as soon as they arrive.
  const awaiting = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef(getSelection);
  // Bumped by every local or live change, so a fetch that raced one is asked again, not applied.
  const epoch = useRef(0);
  const lastLoad = useRef(0);

  useEffect(() => {
    selectionRef.current = getSelection;
  }, [getSelection]);

  const current: Thread = thread.pieceId === pieceId ? thread : { pieceId, phase: "loading", rows: [] };
  const { phase, rows } = current;
  const pointing = pointed && pointed !== ignored ? pointed : "";
  const noDrafting = aiPolicy === "no_drafting";
  const shownNotice = notice?.pieceId === pieceId ? notice : null;
  const say = (n: Notice) => setNotice({ ...n, pieceId });

  const readSelection = () => {
    try {
      return selectionRef.current().trim();
    } catch {
      return "";
    }
  };

  const apply = useCallback(
    (f: Fetched) =>
      setThread((t) =>
        f.ok ? { pieceId, phase: "ready", rows: f.rows } : { pieceId, phase: f.phase, rows: t.pieceId === pieceId ? t.rows : [] },
      ),
    [pieceId],
  );

  const load = useCallback(() => {
    lastLoad.current = Date.now();
    return fetchThread(supabase, pieceId, epoch).then(apply);
  }, [supabase, pieceId, apply]);

  // First load, and whenever the piece changes.
  useEffect(() => {
    let alive = true;
    lastLoad.current = Date.now();
    void fetchThread(supabase, pieceId, epoch).then((f) => alive && apply(f));
    return () => {
      alive = false;
    };
  }, [supabase, pieceId, apply]);

  // Live: the assistant's answers, and questions asked in another tab.
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

  // Back from another tab (or Settings): catch up at once.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLoad.current < 1000) return;
      void load();
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [load]);

  // A backstop for a dropped realtime connection while an answer is due.
  const waiting = hasWaiting(rows);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  // The passage highlighted in the editor. Moving focus into this panel keeps it.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      // After the editor has taken in the new selection.
      frame = requestAnimationFrame(() => {
        let s = "";
        try {
          s = selectionRef.current().trim();
        } catch {
          // The editor is between pieces.
        }
        if (!s) {
          if (panelRef.current?.contains(document.activeElement)) return;
          // Nothing highlighted any more: highlighting the same words again points again.
          setIgnored(null);
        }
        setPointed(s);
      });
    };
    read();
    document.addEventListener("selectionchange", read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", read);
    };
  }, []);

  // The versions of a passage, shown in the essay once they arrive.
  useEffect(() => {
    const id = awaiting.current;
    const r = id ? rows.find((x) => x.id === id) : null;
    if (!r || r.status !== "answered") return;
    awaiting.current = null;
    const { options } = parseOptions(r.answer);
    if (options.length && r.selection) offerRewrites({ pieceId, requestId: r.id, passage: r.selection, options, index: 0 });
  }, [rows, pieceId]);

  useEffect(
    () =>
      onRewriteEvent((e) => {
        if (e.type === "shown") setShowing({ requestId: e.requestId, index: e.index });
        else if (e.type === "accepted") {
          setShowing(null);
          setKept((k) => ({ ...k, [e.requestId]: e.index }));
        } else if (e.type === "closed") setShowing(null);
        else setNotice({ kind: "info", text: "That passage isn't in your essay as it was any more, so the versions are only here to copy.", pieceId });
      }),
    [pieceId],
  );

  // Keep the newest exchange in view.
  const signature = rows.map((r) => `${r.id}:${r.status}:${r.answer.length}`).join();
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [signature]);

  async function send() {
    if (busy) return;
    const prompt = draft.trim();
    const passage = readSelection() || pointed;
    const selection = passage && passage !== ignored ? passage : "";
    // A highlighted passage asks for rewrites of it (or answers a question about it).
    const kind = selection ? "polish" : "ask";
    if (kind === "ask" && !prompt) {
      inputRef.current?.focus();
      return;
    }
    const connected = connectors === null || connectors.length > 0;
    const watching = watcher(connectors, Date.now());
    setBusy(true);
    try {
      const row = await queueRequest(supabase, { deskId, pieceId, kind, prompt, selection, model });
      if (kind === "polish") awaiting.current = row.id;
      epoch.current++;
      setThread((t) => (t.pieceId === pieceId ? { ...t, phase: "ready", rows: mergeRequest(t.rows, row, pieceId) } : t));
      setDraft("");
      // Sending clears the pointer; a new highlight brings it back.
      if (selection) setIgnored(selection);
      if (!connected) say({ kind: "connect" });
      else
        say({
          kind: "queued",
          watching: !!watching,
          counselor: isCounselor(watching, Date.now()),
          paused: isCounselor(watching, Date.now()) && !!watching?.counselor_paused,
          label: watching?.label ?? label,
          polish: kind === "polish",
        });
    } catch (e) {
      say({
        kind: "error",
        text: bridgeMissing(e as { code?: string })
          ? NOT_YET
          : `Couldn't save your ${kind === "polish" ? "request" : "question"} (${errText(e)}), so ${label} has nothing to answer. Try again.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(r: DeskRequest) {
    epoch.current++;
    setThread((t) => (t.pieceId === pieceId ? { ...t, rows: removeRequest(t.rows, r.id) } : t));
    const { error } = await supabase.from("desk_requests").update({ status: "dismissed" }).eq("id", r.id);
    if (error) {
      epoch.current++;
      setThread((t) => (t.pieceId === pieceId ? { ...t, rows: mergeRequest(t.rows, r, pieceId) } : t));
      say({ kind: "error", text: `Couldn't dismiss it (${error.message}).` });
    }
  }

  async function clearThread() {
    const { error } = await supabase.from("desk_requests").delete().eq("piece_id", pieceId).in("kind", THREAD_KINDS);
    if (error) {
      say({ kind: "error", text: `Couldn't clear this piece's questions (${error.message}).` });
      return;
    }
    epoch.current++;
    setThread((t) => (t.pieceId === pieceId ? { ...t, rows: [] } : t));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const off = phase === "missing";
  const defaultModel = counselors(connectors)[0]?.counselor_model;

  return (
    <div ref={panelRef} data-testid="ask-panel" className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <p className="label mb-0.5">Asking about</p>
        <p className="font-serif text-lg leading-tight break-words">
          {pieceTitle}
          {collegeName && <span className="text-sm text-muted"> · {collegeName}</span>}
        </p>
        <p className="mt-1.5 text-xs text-muted">
          Your question waits on your desk; your counselor (or a {label} chat watching your desk) answers it through your
          connector, and the answer shows up here. People you share your desk with can read this chat too.
        </p>
      </div>

      {connectors?.length === 0 && (
        <div role="note" aria-label="Set up Ask" className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs">
          <p className="mb-0.5 font-medium">First, connect Claude or ChatGPT to your desk</p>
          <p>
            Set up your counselor in{" "}
            <Link href="/desk/settings/counselor" className="underline underline-offset-2">
              Settings
            </Link>{" "}
            (one download), or make a connector link there, add it to Claude or ChatGPT, and say &ldquo;{WATCH_PHRASE}&rdquo;
            in a chat. Either way, it answers what you ask here, and the answers appear in this panel.
          </p>
        </div>
      )}
      <WatchStatus connectors={connectors} now={now} />

      {off && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{NOT_YET}</p>}

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
        {phase === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {phase === "error" && (
          <p className="text-sm text-danger">
            Couldn&apos;t load this piece&apos;s questions.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}
        {phase === "ready" && rows.length === 0 && (
          <div className="text-sm text-muted">
            <p>
              Ask anything about this piece: what&apos;s weakest, whether a line earns its place, how to cut it to the limit.
              Highlight a passage in your essay first and the question is about that passage.
            </p>
            <div role="group" aria-label="Question ideas" className="mt-2 flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-muted hover:text-ink"
                  onClick={() => {
                    setDraft(q);
                    inputRef.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <ol aria-label="Questions and answers" aria-live="polite" className="flex flex-col gap-4">
            {rows.map((r) => (
              <RequestItem
                key={r.id}
                r={r}
                viewer="owner"
                now={now}
                waitingFor={label}
                doing={r.status === "pending" ? activityOn(connectors, r.id, now) : null}
                onDismiss={() => void dismiss(r)}
                showing={showing?.requestId === r.id ? showing.index : null}
                kept={kept[r.id] ?? null}
                onShow={(options, index) =>
                  // After keeping a version, that version is what's in the essay now.
                  offerRewrites({ pieceId, requestId: r.id, passage: kept[r.id] !== undefined ? options[kept[r.id]] : r.selection, options, index })
                }
              />
            ))}
          </ol>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex justify-end">
          <ConfirmButton
            label="Clear"
            confirmLabel="Delete"
            question="Delete every question and answer on this piece?"
            onConfirm={clearThread}
          />
        </div>
      )}

      <form
        className="flex flex-col gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {pointing && (
          <div data-testid="pointing" className="flex items-start gap-2 rounded-md border border-warn bg-warn-soft px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium">Pointing at </span>“{clip(pointing, 160)}”
            </span>
            <button
              type="button"
              className="text-muted hover:text-ink"
              aria-label="Stop pointing at this passage"
              onClick={() => setIgnored(pointing)}
            >
              ✕
            </button>
          </div>
        )}
        <label htmlFor={`${ids}-q`} className="sr-only">
          Ask about this piece
        </label>
        <textarea
          id={`${ids}-q`}
          ref={inputRef}
          className="field min-h-20 resize-y"
          rows={3}
          value={draft}
          disabled={off}
          placeholder={pointing ? "How should it change? (or ask about it)" : "Ask about this piece…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy || off || (!draft.trim() && !pointing)} aria-describedby={`${ids}-how`}>
            Send
          </button>
          <ModelPicker value={model} onChange={setModel} defaultModel={defaultModel} />
          <label className="ml-auto flex items-center gap-1 text-xs text-muted">
            Answer with
            <select
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
              value={assistant}
              onChange={(e) => setAssistant(e.target.value as Assistant)}
            >
              <option value="claude">Claude</option>
              <option value="chatgpt">ChatGPT</option>
            </select>
          </label>
        </div>
        <p id={`${ids}-how`} className="text-xs text-muted">
          {pointing
            ? noDrafting
              ? "This college doesn't allow AI help with drafting, so you'll get advice on the highlighted passage rather than rewrites."
              : "Say how it should change (or send as is): a few versions appear in place of the highlighted text. ← → switch between them, Enter keeps one, Esc goes back."
            : "Ask about the whole piece, or highlight a passage to get rewrites of just that part."}
        </p>
        <div role="status" aria-live="polite" className="text-xs">
          {shownNotice && <NoticeLine notice={shownNotice} />}
        </div>
      </form>
    </div>
  );
}

/**
 * One question and its answer. The student sees who asked each ("You", or the name of someone
 * they share the desk with) and can dismiss it and show rewrites in the essay; someone the desk
 * is shared with reads it.
 */
export function RequestItem({
  r,
  viewer,
  now,
  waitingFor,
  doing,
  onDismiss,
  showing,
  kept,
  onShow,
}: {
  r: DeskRequest;
  viewer: "owner" | "guest";
  now: number;
  waitingFor: string;
  doing: string | null;
  onDismiss?: () => void;
  /** The version showing in the essay, if it's one of this request's. */
  showing: number | null;
  /** The version kept, if one was. */
  kept: number | null;
  onShow: (options: string[], index: number) => void;
}) {
  const asked = whenLabel(r.created_at, now);
  const answered = whenLabel(r.answered_at, now);
  const question = r.prompt || (r.kind === "polish" ? "Make this better." : "");
  const { options, note } = r.kind === "polish" ? parseOptions(r.answer) : { options: [], note: r.answer };
  const who = r.asked_by?.trim() || (viewer === "owner" ? "You" : "The student");
  return (
    <li data-testid="request" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-wide text-muted uppercase" data-testid="asked-by">
          {r.kind === "polish" ? `${who} · Rewrite` : who}
          {asked && ` · ${asked}`}
        </span>
        {onDismiss && (
          <button
            type="button"
            className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
            aria-label={r.status === "pending" ? "Dismiss (withdraw it)" : "Dismiss"}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        )}
      </div>
      {r.selection && (
        <blockquote className="border-l-2 border-warn bg-warn-soft px-2 py-1 text-xs break-words" aria-label="Highlighted passage">
          “{clip(r.selection, 280)}”
        </blockquote>
      )}
      {question && <p className="rounded-md bg-accent-soft px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap">{question}</p>}
      {r.status === "pending" ? (
        <PendingAnswer r={r} who={waitingFor} doing={doing} />
      ) : (
        <div className="border-l-2 border-accent pl-2.5">
          <p className="mb-1 font-mono text-[11px] tracking-wide text-muted uppercase">
            {r.answered_by || "Assistant"}
            {answered && ` · ${answered}`}
          </p>
          {note && <AnswerText text={note} />}
          {options.length > 0 && (
            <ol className="mt-1.5 flex flex-col gap-1.5" aria-label="Versions">
              {options.map((o, i) => (
                <li
                  key={i}
                  data-testid="rewrite-option"
                  className={`rounded-md border px-2 py-1.5 text-sm ${showing === i ? "border-warn bg-warn-soft" : kept === i ? "border-accent bg-accent-soft" : "border-line"}`}
                >
                  <p className="break-words whitespace-pre-wrap">{o}</p>
                  <p className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                    {viewer === "guest" ? null : kept === i ? (
                      <span>Kept in your essay</span>
                    ) : showing === i ? (
                      <span>Showing in your essay: Enter keeps it</span>
                    ) : (
                      <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => onShow(options, i)}>
                        Show in essay
                      </button>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const link = "font-medium underline underline-offset-2";
  switch (notice.kind) {
    case "queued":
      if (notice.paused) {
        return (
          <p className="text-warn">
            Saved. Your counselor is paused, so it answers once you resume it in{" "}
            <Link className={link} href="/desk/settings/counselor">
              Settings
            </Link>
            .
          </p>
        );
      }
      return notice.watching ? (
        <p className="text-muted">
          Sent to {notice.counselor ? "your counselor" : notice.label}.{" "}
          {notice.polish ? "The rewrites appear in your essay in place of the highlighted text." : "The answer appears here in a moment."}
        </p>
      ) : (
        <p className="text-warn">
          Saved. Nobody is watching your desk right now: turn on your counselor in{" "}
          <Link className={link} href="/desk/settings/counselor">
            Settings
          </Link>
          , or say &ldquo;{WATCH_PHRASE}&rdquo; in your {notice.label} chat, and it picks this up.
        </p>
      );
    case "connect":
      return (
        <p className="text-warn">
          Saved on your desk. Connect Claude or ChatGPT in{" "}
          <Link className={link} href="/desk/settings/connectors">
            Settings
          </Link>
          , then ask it to handle your desk requests and the answer appears here.
        </p>
      );
    case "info":
      return <p className="text-warn">{notice.text}</p>;
    default:
      return <p className="text-danger">{notice.text}</p>;
  }
}
