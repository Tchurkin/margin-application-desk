"use client";

import type { Editor, JSONContent } from "@tiptap/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "@/components/write/modal";
import type { VersionRow } from "@/lib/sync/versions";
import { wordDiff, type DiffSegment } from "@/lib/write/diff";

/*
 * An earlier version beside the piece as it is now, full screen: on the left the version, with
 * the words the piece has lost since then struck through; on the right the piece now, with the
 * words it has gained since then marked. Both sides scroll together. ← and → (or the buttons)
 * step to older and newer versions; the right side follows edits live while it's open.
 */

export interface LoadedVersion {
  text: string;
  content: JSONContent;
}

const when = (at: string) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** The piece's text as saved in versions: paragraphs separated by single line breaks. */
const textOf = (editor: Editor) => editor.getText({ blockSeparator: "\n" });

function useLiveText(editor: Editor | null): string {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => {};
      editor.on("update", onChange);
      return () => {
        editor.off("update", onChange);
      };
    },
    [editor],
  );
  return useSyncExternalStore(
    subscribe,
    () => (editor && !editor.isDestroyed ? textOf(editor) : ""),
    () => "",
  );
}

function Marked({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "removed" ? (
          <del key={i} className="diff-removed">
            {s.text}
          </del>
        ) : s.kind === "added" ? (
          <ins key={i} className="diff-added">
            {s.text}
          </ins>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** A button that stays focusable while unavailable (disabling the focused button would drop focus out of the dialog). */
function StepButton({ off, onClick, label, children, primary = false }: { off: boolean; onClick: () => void; label?: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      className={`btn ${primary ? "btn-primary" : ""} ${off ? "cursor-not-allowed opacity-50" : ""}`}
      aria-disabled={off}
      aria-label={label}
      onClick={() => !off && onClick()}
    >
      {children}
    </button>
  );
}

export function VersionCompare({
  versions,
  id,
  load,
  editor,
  onPick,
  onRestore,
  restoring = false,
  error = null,
  onClose,
}: {
  /** Newest first, as the History list shows them. */
  versions: VersionRow[];
  /** The version being compared. */
  id: string;
  load: (id: string) => Promise<LoadedVersion>;
  /** The piece as it is now (read, never changed here). */
  editor: Editor | null;
  onPick: (id: string) => void;
  /** Restore the version; null when this person can't. */
  onRestore: ((v: LoadedVersion) => void) | null;
  /** A restore is under way: nothing else can be done until it finishes. */
  restoring?: boolean;
  /** Why the last restore didn't happen. */
  error?: string | null;
  onClose: () => void;
}) {
  const ids = useId();
  const [loaded, setLoaded] = useState<Record<string, LoadedVersion>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const now = useLiveText(editor);
  const at = versions.findIndex((v) => v.id === id);
  const version = versions[at];
  const current = loaded[id];

  useEffect(() => {
    if (loaded[id]) return;
    let alive = true;
    load(id).then(
      (v) => alive && setLoaded((l) => ({ ...l, [id]: v })),
      (e: Error) => alive && setFailed((f) => ({ ...f, [id]: e.message || "Couldn't load that version." })),
    );
    return () => {
      alive = false;
    };
  }, [id, load, loaded]);

  const diff = useMemo(() => (current ? wordDiff(current.text, now) : null), [current, now]);

  // Both sides scroll together, in proportion (they differ in length).
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const echo = useRef<HTMLDivElement | null>(null);
  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    if (echo.current === from) {
      echo.current = null;
      return;
    }
    const range = from.scrollHeight - from.clientHeight;
    const ratio = range > 0 ? from.scrollTop / range : 0;
    const before = to.scrollTop;
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    // Only a pane that actually moved answers with a scroll event of its own.
    if (to.scrollTop !== before) echo.current = to;
  };

  const older = at >= 0 && at < versions.length - 1 ? versions[at + 1] : null;
  const newer = at > 0 ? versions[at - 1] : null;

  // ← and → wherever focus is (and Esc, if focus has fallen out of the dialog).
  const keys = useRef({ older, newer, restoring, onPick, onClose });
  useEffect(() => {
    keys.current = { older, newer, restoring, onPick, onClose };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const k = keys.current;
      if (e.key === "ArrowLeft" && k.older && !k.restoring) {
        e.preventDefault();
        k.onPick(k.older.id);
      } else if (e.key === "ArrowRight" && k.newer && !k.restoring) {
        e.preventDefault();
        k.onPick(k.newer.id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        k.onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const pane = "essay min-h-0 flex-1 overflow-y-auto px-4 pb-6 font-serif leading-relaxed whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset";

  return (
    <Modal labelledBy={`${ids}-h`} onClose={onClose} placement="fill" className="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col" data-testid="version-compare">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-h`} className="font-serif text-lg">
              {version?.label ? `“${version.label}”, ${when(version.at)}` : version ? `Version from ${when(version.at)}` : "Version"}
              {version?.author ? <span className="text-sm text-muted"> · {version.author}</span> : null}
            </h2>
            <p className="text-xs text-muted" data-testid="diff-counts">
              {diff
                ? diff.removed || diff.added
                  ? `Since then: ${diff.removed} word${diff.removed === 1 ? "" : "s"} taken out, ${diff.added} added`
                  : "Nothing has changed since then."
                : (failed[id] ?? "Loading…")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StepButton off={!older || restoring} onClick={() => older && onPick(older.id)} label="Older version">
              ← Older
            </StepButton>
            <span className="text-xs text-muted">
              {at + 1} of {versions.length}
            </span>
            <StepButton off={!newer || restoring} onClick={() => newer && onPick(newer.id)} label="Newer version">
              Newer →
            </StepButton>
            {onRestore && (
              <StepButton primary off={!current || restoring} onClick={() => current && onRestore(current)}>
                {restoring ? "Restoring…" : "Restore this version"}
              </StepButton>
            )}
            <button type="button" className="btn" onClick={onClose} data-autofocus>
              Close
            </button>
          </div>
          {error && (
            <p role="alert" className="w-full rounded-md bg-danger-soft px-3 py-1.5 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          <section className="flex min-h-0 flex-col border-b border-line md:border-r md:border-b-0">
            <p className="label px-4 pt-3" id={`${ids}-then`}>
              Then
            </p>
            <div
              ref={left}
              role="region"
              aria-labelledby={`${ids}-then`}
              tabIndex={0}
              onScroll={() => follow(left.current, right.current)}
              className={pane}
              data-testid="version-preview"
            >
              {diff ? diff.left.length ? <Marked segments={diff.left} /> : <em className="text-muted">(empty)</em> : null}
            </div>
          </section>
          <section className="flex min-h-0 flex-col">
            <p className="label px-4 pt-3" id={`${ids}-now`}>
              Now
            </p>
            <div
              ref={right}
              role="region"
              aria-labelledby={`${ids}-now`}
              tabIndex={0}
              onScroll={() => follow(right.current, left.current)}
              className={pane}
              data-testid="version-now"
            >
              {diff ? diff.right.length ? <Marked segments={diff.right} /> : <em className="text-muted">(empty)</em> : null}
            </div>
          </section>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          <del className="diff-removed">Struck through</del>: in this version, gone now. <ins className="diff-added">Marked</ins>: added
          since. ← → step through versions.
        </p>
      </div>
    </Modal>
  );
}
