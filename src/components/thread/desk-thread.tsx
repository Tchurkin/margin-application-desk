"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnswerText } from "@/components/ask/answer-text";
import { PendingAnswer } from "@/components/ask/pending-answer";
import { useConnectors, WatchStatus } from "@/components/ask/watch-status";
import { ConfirmButton } from "@/components/confirm-button";
import { LengthNote } from "@/components/length-note";
import { setCounselorModel } from "@/app/desk/connector-actions";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { MESSAGE_MAX } from "@/lib/bridge/listing";
import { bridgeMissing, queueRequest, REQUEST_COLS, type DeskRequest, type RequestKind } from "@/lib/bridge/requests";
import { hasWaiting, mergeRequest, removeRequest, sortThread, THREAD_LIMIT } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import { activityOn, counselors, type Connector } from "@/lib/bridge/watchers";
import { counselorChoice, EFFORTS, MODELS, type EffortId, type ModelId } from "@/lib/counselor/models";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * A conversation with the counselor through the desk, not tied to a piece: the Counselor page's
 * chat, with the profile interview and shared transcripts in it. Each message queues a request;
 * the counselor (or a watching chat) answers it, and the answer arrives here live, streamed while
 * it is written. It fills its page: only the messages scroll, and the message box stays in view.
 */

const NOT_YET = "Run the latest database update to use this.";
/** How close to the end (px) still counts as reading the latest, so new text keeps it in view. */
const NEAR_END = 64;

type Choice = { model: ModelId; effort: EffortId };

/** A counselor whose model can be chosen from here (a desk with migration 20261004, a counselor from version 2 on). */
function choosable(c: Connector | undefined): c is Connector & { id: string } {
  return !!c?.id && c.counselor_model !== undefined && c.counselor_version !== undefined;
}

function Pick<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      {label}
      <select
        className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface DeskThreadProps {
  deskId: string;
  /** What a message sent here is. */
  kind: Extract<RequestKind, "interview" | "chat">;
  /** Other kinds shown in the same conversation (the counselor chat shows the interview too). */
  also?: RequestKind[];
  /** The page's heading. */
  title: string;
  /** Shown above the conversation, scrolling with it (setting up the counselor). */
  top?: ReactNode;
  /** Label and placeholder of the message box. */
  inputLabel: string;
  placeholder: string;
  sendLabel: string;
  /** Shown for a message sent with no text (starting an interview). */
  startedLabel?: string;
  clearQuestion: string;
  /** Shown before the first message; `send("")` starts without text. */
  empty: (send: (text: string) => void, busy: boolean) => ReactNode;
  testId: string;
}

export function DeskThread(p: DeskThreadProps) {
  const { deskId, kind } = p;
  const supabase = supabaseBrowser();
  const ids = useId();
  const now = useNow(5_000);
  const { connectors, reload } = useConnectors(deskId);
  // The counselor's model and how hard it thinks, chosen right here; shown at once, saved for every question after.
  const counselor = counselors(connectors, now)[0];
  const [picked, setPicked] = useState<(Choice & { id: string }) | null>(null);
  const choice: Choice | null = choosable(counselor) ? (picked?.id === counselor.id ? picked : counselorChoice(counselor)) : null;
  const [rows, setRows] = useState<DeskRequest[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Following the conversation (at its end): new messages and a streaming answer stay in view.
  const following = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const shownKey = [kind, ...(p.also ?? [])].join(",");
  const shown = useMemo(() => shownKey.split(",") as RequestKind[], [shownKey]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", deskId)
      .is("piece_id", null)
      .in("kind", shown)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    if (error) {
      setError(bridgeMissing(error) || error.code === "42703" ? NOT_YET : `Couldn't load this conversation (${error.message}).`);
      setRows((r) => r ?? []);
      return;
    }
    setRows(sortThread((data ?? []) as DeskRequest[], null, shown));
  }, [supabase, deskId, shown]);

  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) => setRows((l) => mergeRequest(l ?? [], row, null, shown)),
        onDelete: (id) => setRows((l) => (l ? removeRequest(l, id) : l)),
        onReady: () => void load(),
      }),
    [supabase, deskId, shown, load],
  );

  // A backstop for a dropped realtime connection while an answer is due.
  const waiting = hasWaiting(rows ?? []);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const started = (rows?.length ?? 0) > 0;
  const tooLong = draft.length > MESSAGE_MAX;
  const nearEnd = (log: HTMLElement) => log.scrollHeight - log.scrollTop - log.clientHeight < NEAR_END;
  // Gliding to the end (not jumping). The student scrolling meanwhile takes over from it.
  const gliding = useRef(false);
  const glideToEnd = (log: HTMLElement) => {
    gliding.current = true;
    log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  };
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const takeOver = () => (gliding.current = false);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    events.forEach((e) => log.addEventListener(e, takeOver, { passive: true }));
    return () => events.forEach((e) => log.removeEventListener(e, takeOver));
  }, []);

  // In a conversation, whenever it grows (a message, an answer being written) or its window
  // shrinks (a long message being typed), keep its end in view, unless the student has scrolled up
  // to read. Before one, the page stays at its top (the setup card, the ideas).
  useEffect(() => {
    const log = logRef.current;
    const content = contentRef.current;
    if (!log || !content) return;
    if (!started) {
      log.scrollTop = 0;
      return;
    }
    following.current = true;
    let first = true;
    const observer = new ResizeObserver(() => {
      // At its end at once when it opens; gliding to what arrives after.
      if (following.current) {
        if (first) log.scrollTop = log.scrollHeight;
        else glideToEnd(log);
      }
      first = false;
      // A size change fires no scroll event: whether the end is in view is worked out here too.
      following.current = gliding.current || nearEnd(log);
      setAtEnd(following.current);
    });
    observer.observe(content);
    observer.observe(log);
    return () => observer.disconnect();
  }, [started]);

  // Sending a message goes back to the end of the conversation.
  const [sent, setSent] = useState(0);
  useEffect(() => {
    const log = logRef.current;
    if (!sent || !log) return;
    following.current = true;
    glideToEnd(log);
  }, [sent]);

  function onScroll() {
    const log = logRef.current;
    if (!log) return;
    // Gliding to the end passes through places that aren't the end: that isn't scrolling away.
    if (gliding.current) {
      if (nearEnd(log)) gliding.current = false;
      return;
    }
    following.current = nearEnd(log);
    setAtEnd(following.current);
  }

  // The button goes, so the message box takes the focus.
  function toEnd() {
    const log = logRef.current;
    if (!log) return;
    following.current = true;
    setAtEnd(true);
    glideToEnd(log);
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }

  // The message box grows with what's typed (up to a limit, then it scrolls), and fits again when
  // the window changes width, since the text wraps differently.
  const fitInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fitInput, [draft, fitInput]);
  useEffect(() => {
    window.addEventListener("resize", fitInput);
    return () => window.removeEventListener("resize", fitInput);
  }, [fitInput]);

  // Ready to type on arrival, with a mouse; on a phone the keyboard waits for a tap.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  async function send(text: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await queueRequest(supabase, { deskId, pieceId: null, kind, prompt: text, model: choice?.model ?? "" });
      setRows((l) => mergeRequest(l ?? [], row, null, shown));
      setDraft("");
      setSent((n) => n + 1);
      setAtEnd(true);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(bridgeMissing(err) || err.code === "23514" ? NOT_YET : `Couldn't send it (${err.message ?? "unknown error"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function choose(next: Choice) {
    if (!choosable(counselor)) return;
    const id = counselor.id;
    setPicked({ ...next, id });
    setError(null);
    try {
      await setCounselorModel(id, next.model, next.effort);
      await reload();
    } catch (e) {
      setPicked(null);
      setError(`Couldn't change the model (${(e as Error).message}).`);
    }
  }

  async function clear() {
    const { error } = await supabase.from("desk_requests").delete().eq("desk_id", deskId).is("piece_id", null).in("kind", shown);
    if (error) return setError(`Couldn't clear it (${error.message}).`);
    setRows([]);
    setAtEnd(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (draft.trim() && !tooLong) void send(draft.trim());
    }
  }

  const list = rows ?? [];

  return (
    <section aria-labelledby={`${ids}-h`} className="flex min-h-0 flex-1 flex-col" data-testid={p.testId}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
        <h1 id={`${ids}-h`} className="font-serif text-2xl">
          {p.title}
        </h1>
        {/* On a phone the status gets a line of its own under the title. */}
        <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-64">
          <WatchStatus connectors={connectors} now={now} />
        </div>
        {started && <ConfirmButton label="Start over" confirmLabel="Clear" question={p.clearQuestion} onConfirm={clear} quiet />}
      </div>

      {/* Never squeezed to nothing: on a very short window the page scrolls instead. */}
      <div className="relative min-h-32 flex-1">
        <div ref={logRef} onScroll={onScroll} className="h-full overflow-y-auto">
          <div ref={contentRef} className="flex min-h-full flex-col py-4">
            {p.top && <div className="mb-4 shrink-0">{p.top}</div>}
            {rows === null ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : !started ? (
              <div className="flex flex-1 flex-col items-center justify-center py-6">{p.empty((t) => void send(t), busy)}</div>
            ) : (
              <ol aria-label="Conversation" aria-live="polite" className="flex flex-col gap-6">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2" data-testid={`${p.testId}-turn`}>
                    {r.kind === "transcript" ? (
                      <details className="max-w-[85%] self-end rounded-2xl bg-accent-soft px-3.5 py-2 text-sm">
                        <summary className="cursor-pointer">You shared your transcript</summary>
                        <p className="mt-1 max-h-60 overflow-y-auto font-mono text-xs break-words whitespace-pre-wrap">{r.prompt}</p>
                      </details>
                    ) : r.prompt ? (
                      <p className="max-w-[85%] self-end rounded-2xl bg-accent-soft px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                        {r.prompt}
                      </p>
                    ) : (
                      <p className="self-end text-xs text-muted">{p.startedLabel ?? "You"}</p>
                    )}
                    {r.status === "pending" ? (
                      <PendingAnswer r={r} who="Claude" doing={activityOn(connectors, r.id, now)} large />
                    ) : (
                      <div className="border-l-2 border-accent pl-3">
                        <p className="mb-1 font-mono text-[11px] tracking-wide text-muted uppercase">{r.answered_by || "Claude"}</p>
                        <AnswerText text={r.answer} large />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        {!atEnd && started && (
          <button
            type="button"
            onClick={toEnd}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink shadow-md hover:border-muted"
          >
            Jump to latest ↓
          </button>
        )}
      </div>

      {error && <p className="mb-2 shrink-0 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      <form
        className="shrink-0 rounded-xl border border-line bg-panel shadow-sm focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !tooLong) void send(draft.trim());
        }}
      >
        <label htmlFor={`${ids}-a`} className="sr-only">
          {p.inputLabel}
        </label>
        <textarea
          ref={inputRef}
          id={`${ids}-a`}
          className="block max-h-[40vh] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted"
          rows={2}
          value={draft}
          placeholder={p.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="px-3.5">
          <LengthNote length={draft.length} max={MESSAGE_MAX} over="send it in parts, or put long things about you in files on your Profile page." />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-2">
          <span className="flex flex-wrap items-center gap-2">
            {choice && (
              <>
                <Pick label="Model" options={MODELS} value={choice.model} onChange={(m) => void choose({ ...choice, model: m })} />
                <Pick label="Thinking" options={EFFORTS} value={choice.effort} onChange={(e) => void choose({ ...choice, effort: e })} />
              </>
            )}
          </span>
          <span className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">Enter to send · Shift+Enter for a new line</span>
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim() || tooLong}>
              {p.sendLabel}
            </button>
          </span>
        </div>
      </form>
    </section>
  );
}
