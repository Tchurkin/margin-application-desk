"use client";

import { Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { UndoCaret } from "@/lib/editor/undo-caret";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { PieceRatingPanel, ratingLabel, TEXT_SAVED, usePieceRating } from "@/components/rating/piece-rating";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { essayStarterKit } from "@/lib/editor/kit";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnswerText, InlineText } from "@/components/ask/answer-text";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { FormatToolbar } from "@/components/write/format-toolbar";
import { useMedia, usePref, writePref } from "@/components/write/hooks";
import { VersionCompare, type LoadedVersion } from "@/components/write/version-compare";
import { PREF } from "@/lib/write/layout";
import { countLabel, type RailGroup, type RailPiece } from "@/lib/write/rail";
import type { Waiting } from "@/lib/data/waiting";
import { WriteWorkspace } from "./write-workspace";
import { PIECE_STATUSES, labelOf, type PieceStatus } from "@/lib/domain/colleges";
import { countChars, countWords, limitState, type LimitKind } from "@/lib/domain/count";
import { HeldSelection, heldRange, heldSelectionKey } from "@/lib/editor/held-selection";
import { Rewrites } from "@/lib/editor/rewrites";
import { acceptInto, commentOn, DIRECT_EDIT, liveSelection, resolveSuggestion, suggestKey, suggestPlugin, type SuggestMode } from "@/lib/suggest/plugin";
import { SuggestionStore, type Suggestion } from "@/lib/suggest/store";
import { SupabaseSuggestionBackend } from "@/lib/suggest/supabase-backend";
import { supabaseBrowser } from "@/lib/supabase/client";
import { safeLocalStorage, tabClientId } from "@/lib/sync/client-id";
import { PieceSync, type SyncStatus } from "@/lib/sync/piece-sync";
import { colorFor, PieceChannel, type Person } from "@/lib/sync/realtime";
import { SupabaseUpdateStore } from "@/lib/sync/supabase-store";
import { listVersions, loadVersion, saveVersion, SNAPSHOT_EVERY, type VersionRow } from "@/lib/sync/versions";

export interface PieceMeta {
  id: string;
  college_id: string | null;
  title: string;
  prompt: string;
  limit_kind: LimitKind;
  limit_value: number | null;
  status: PieceStatus;
  notes: string;
  /** Its own due date; empty means the college's deadline. */
  due?: string | null;
}

export type Role = "owner" | "edit" | "suggest" | "view";

const STATUS_TEXT: Record<SyncStatus, string> = {
  loading: "Opening…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Can't reach the server. Your writing is kept on this device and will be sent when it reconnects.",
  gone: "This piece was deleted.",
};

function textOf(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n" });
}

/** Debounced writes of a piece's own fields (never the essay text). */
function useMetaSaver(pieceId: string) {
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await supabaseBrowser().from("pieces").update(patch).eq("id", pieceId);
  }, [pieceId]);
  const save = useCallback(
    (patch: Record<string, unknown>, delay = 600) => {
      Object.assign(pending.current, patch);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );
  useEffect(() => () => void flush(), [flush]);
  return useMemo(() => ({ save, flush }), [save, flush]);
}

/**
 * A piece's notes: the student and anyone who can suggest or edit write them. The student saves
 * them with the piece's other fields; everyone else through set_piece_notes, the only part of a
 * piece they may change. Everyone sees the others' changes live, except while typing in them.
 */
function useNotes(pieceId: string, initial: string, own: { save: (notes: string) => void; flush: () => Promise<void> } | null) {
  const supabase = supabaseBrowser();
  const [notes, setNotes] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = pending.current;
    pending.current = null;
    if (body === null) return;
    const { error: e } = await supabase.rpc("set_piece_notes", { piece: pieceId, body });
    setError(e ? `Couldn't save the notes (${e.message}).` : null);
  }, [supabase, pieceId]);
  useEffect(() => () => void flush(), [flush]);

  useEffect(() => {
    const ch = supabase
      .channel(`piece-notes:${pieceId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pieces", filter: `id=eq.${pieceId}` }, (p) => {
        const n = (p.new as { notes?: unknown }).notes;
        if (typeof n === "string" && !focused.current && pending.current === null) setNotes(n);
      })
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [supabase, pieceId]);

  const change = (text: string) => {
    setNotes(text);
    if (own) return own.save(text);
    pending.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  };
  const onFocus = () => (focused.current = true);
  const onBlur = () => {
    focused.current = false;
    void (own ? own.flush() : flush());
  };
  return { notes, change, onFocus, onBlur, error };
}

/**
 * An accept, decline or resolve, or a comment deleted or suggestion withdrawn, as Ctrl+Z takes it
 * back: the essay before and after it, and when it was done.
 */
interface Act {
  label: string;
  id: string;
  status: "accepted" | "declined" | "removed";
  changesText: boolean;
  before: Editor["state"]["doc"];
  after: Editor["state"]["doc"];
  at: number;
  /** What was deleted or withdrawn, to put back. */
  row?: Suggestion;
}

interface Live {
  sync: PieceSync;
  store: SuggestionStore;
  channel: PieceChannel;
}

export function PieceEditor({
  piece,
  userId,
  author,
  collegeName,
  role = "owner",
  deskId,
  workspace,
}: {
  deskId?: string;
  /** The Write workspace: the college rail and this college's pieces as tabs, linking under `base`. */
  workspace?: { groups: RailGroup[]; tabs: RailPiece[]; base: string; waiting?: Record<string, Waiting> };
  piece: PieceMeta;
  userId: string;
  author: string;
  collegeName: string | null;
  role?: Role;
}) {
  const supabase = supabaseBrowser();
  const owner = role === "owner";
  const me = useMemo(() => ({ id: userId, name: author }), [userId, author]);
  const [live, setLive] = useState<Live | null>(null);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // The database refused a comment: it hasn't had its update for comments (migration 20261022).
  const [commentsBehind, setCommentsBehind] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState(piece.title);
  const [prompt, setPrompt] = useState(piece.prompt);
  const [pieceStatus, setPieceStatus] = useState<PieceStatus>(piece.status);
  const [limitKind, setLimitKind] = useState<LimitKind>(piece.limit_kind);
  const [limitValue, setLimitValue] = useState<number | null>(piece.limit_value);
  const [due, setDue] = useState<string | null>(piece.due ?? null);
  const [text, setText] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const meta = useMetaSaver(piece.id);
  const notesBox = useNotes(piece.id, piece.notes, owner ? { save: (n: string) => meta.save({ notes: n }), flush: meta.flush } : null);
  const notes = notesBox.notes;
  // The suggestions margin, folded away or not (per browser).
  const marginFolded = usePref(PREF.marginFolded) === "1";
  // Prompt and Notes open above the writing; the prompt starts open when there is one.
  const [panels, setPanels] = useState({ prompt: !!piece.prompt, notes: false, rating: false });
  const rating = usePieceRating(piece.id, owner);
  const togglePanel = (k: keyof typeof panels) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  /** A fold-out: its button, with what it opens right below it. */
  const fold = (key: keyof typeof panels, label: string, filled: boolean, content: ReactNode) => (
    <div>
      <button
        type="button"
        aria-expanded={panels[key]}
        aria-controls={`${piece.id}-${key}`}
        onClick={() => togglePanel(key)}
        className={`rounded-md border px-2.5 py-1 text-sm ${panels[key] ? "border-muted bg-panel text-ink" : "border-line text-muted hover:text-ink"}`}
      >
        {label}
        {filled && !panels[key] && <span aria-hidden className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />}
        <span aria-hidden className="ml-1 text-xs">{panels[key] ? "▴" : "▾"}</span>
      </button>
      <div id={`${piece.id}-${key}`} hidden={!panels[key]} className="mt-2">
        {content}
      </div>
    </div>
  );

  // Comparing a version with now: held here so it stays open when the side panel folds.
  const [compare, setCompare] = useState<{ versions: VersionRow[]; id: string } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [restore, setRestore] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const restoring = useRef(false);
  const comparingId = useRef<string | null>(null);
  useEffect(() => {
    comparingId.current = compare?.id ?? null;
  }, [compare]);

  const loadForCompare = useCallback(
    async (id: string): Promise<LoadedVersion> => {
      const full = await loadVersion(supabase, id);
      return { text: full.plain_text, content: full.content as JSONContent };
    },
    [supabase],
  );

  async function restoreVersion(id: string, v: LoadedVersion) {
    if (!editor || restoring.current) return;
    restoring.current = true;
    setRestore({ busy: true, error: null });
    try {
      // Today's text is kept as a version first; if that can't be saved, nothing is restored.
      const now = textOf(editor);
      if (now.trim() && now !== v.text) {
        const saved = await saveVersion(supabase, piece.id, `${me.name || "You"}, before restoring`, editor.getJSON(), now).catch(() => false);
        if (!saved) {
          setRestore({ busy: false, error: "Couldn't save your current text to History first, so nothing was restored. Check your connection and try again." });
          return;
        }
      }
      // Closed, or moved to another version, while that was saving: leave the essay alone.
      if (comparingId.current !== id || editor.isDestroyed) return;
      // An ordinary edit: it syncs to everyone like any other change.
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta(DIRECT_EDIT, true);
          return true;
        })
        .setContent(v.content)
        .run();
      setCompare(null);
      setHistoryTick((t) => t + 1);
      setRestore({ busy: false, error: null });
    } catch (e) {
      setRestore({ busy: false, error: `Couldn't restore it (${(e as Error).message}).` });
    } finally {
      restoring.current = false;
      setRestore((r) => (r.busy ? { ...r, busy: false } : r));
    }
  }

  // Saving a version by hand, from History, with a name if the student gives one.
  const saveNow = async (label: string) => {
    if (!editor || editor.isDestroyed) return false;
    const ok = await saveVersion(supabase, piece.id, me.name, editor.getJSON(), textOf(editor), label).catch(() => false);
    if (ok) setHistoryTick((t) => t + 1);
    return ok;
  };

  const openCompare = (versions: VersionRow[], id: string) => {
    setRestore({ busy: false, error: null });
    setCompare({ versions, id });
  };
  const compareView = compare && (
    <VersionCompare
      versions={compare.versions}
      id={compare.id}
      load={loadForCompare}
      editor={editor}
      onPick={(id) => !restoring.current && setCompare((c) => (c ? { ...c, id } : c))}
      onRestore={owner && editor ? (v) => void restoreVersion(compare.id, v) : null}
      restoring={restore.busy}
      error={restore.error}
      onClose={() => setCompare(null)}
    />
  );
  // Editing or Suggesting. The student and people on a "can edit" link switch between them (the
  // student starts in Editing, others in Suggesting; the choice is remembered per browser).
  // "Can suggest" links only suggest, and read-only links only read.
  const canWrite = role !== "view";
  const canEdit = role === "owner" || role === "edit";
  const [editMode, setEditMode] = useState<EditMode>(owner ? "editing" : "suggesting");
  const editorMode: SuggestMode = !canWrite ? "view" : canEdit && editMode === "editing" ? "owner" : "suggest";
  const chooseMode = (m: EditMode) => {
    setEditMode(m);
    writeMode(role, m);
  };

  // Load the document and its suggestions, keep them saved, and follow everyone else live.
  useEffect(() => {
    let alive = true;
    const clientId = tabClientId();
    const storage = safeLocalStorage();
    const sync = new PieceSync(piece.id, new SupabaseUpdateStore(supabase), storage, clientId, {
      readOnly: role !== "owner" && role !== "edit",
      onStatus: (st) => alive && setStatus(st),
    });
    const backend = new SupabaseSuggestionBackend(supabase, { onBehind: () => alive && setCommentsBehind(true) });
    const store = new SuggestionStore(piece.id, backend, storage, clientId);
    const person: Person = { name: me.name, color: colorFor(me.id), role };
    const channel = new PieceChannel(supabase, piece.id, sync.doc, person, {
      onUpdateRow: (row) => sync.applyRemoteRow(row),
      onSuggestion: (row) => store.applyRemote(row),
      onSuggestionDeleted: (id) => store.applyRemoteDelete(id),
      onReconnect: () => {
        void sync.catchUp();
        void store.reload();
      },
      onPeople: (p) => alive && setPeople(p),
    });
    // Suggestions failing to load must never stop the essay from opening.
    Promise.all([sync.start(), store.start().catch(() => undefined)])
      .then(([r]) => {
        if (!alive || r !== "ok") return;
        channel.start();
        const saved = readMode(role);
        if (saved) setEditMode(saved);
        setLive({ sync, store, channel });
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    const flushSoon = () => {
      void sync.flush();
      void store.flush();
    };
    const onHide = () => document.visibilityState === "hidden" && flushSoon();
    window.addEventListener("pagehide", flushSoon);
    document.addEventListener("visibilitychange", onHide);
    // Reopen this piece after a reload or a later visit. (Supabase queries are lazy: .then() sends them.)
    if (role === "owner") supabase.from("profiles").update({ last_piece_id: piece.id }).eq("id", me.id).then(() => {});
    return () => {
      alive = false;
      window.removeEventListener("pagehide", flushSoon);
      document.removeEventListener("visibilitychange", onHide);
      channel.stop();
      void Promise.all([sync.flush(), store.flush()]).finally(() => {
        sync.stop();
        store.stop();
      });
    };
  }, [piece.id, supabase, me, role]);

  // The first words move a piece out of "Not started", only if it still is in the database (it
  // may have been submitted with its college from the board since this page loaded).
  const onText = useCallback(
    (t: string) => {
      setText(t);
      if (owner && t.trim()) {
        setPieceStatus((st) => {
          if (st !== "not_started") return st;
          void supabase
            .from("pieces")
            .update({ status: "drafting" })
            .eq("id", piece.id)
            .eq("status", "not_started")
            .then(() => {});
          return "drafting";
        });
      }
    },
    [owner, supabase, piece.id],
  );

  const openCount = useOpenCount(live?.store ?? null);
  const waitingNow = useWaitingNow(live?.store ?? null);
  const limit = limitState(text, limitKind, limitValue);

  // Comments: anyone who can suggest highlights words and comments on them in the margin.
  const canComment = canWrite && !!live && !!editor;
  const [draft, setDraft] = useState<Suggestion | null>(null);
  const startComment = useCallback(() => {
    if (!editor || !canComment) return;
    // The highlight as the browser shows it: the editor's copy can be a keystroke behind.
    const { from, to } = editor.view.hasFocus() ? liveSelection(editor.view) : editor.state.selection;
    const range = to > from ? { from, to } : heldRange(editor.state);
    const c = range && commentOn(editor.state, range.from, range.to, me, piece.id);
    if (!c) return;
    // Keep the words highlighted while the comment is written.
    editor.view.dispatch(editor.state.tr.setMeta(heldSelectionKey, { from: range.from, to: range.to }).setMeta("addToHistory", false));
    setDraft(c);
    if (marginFolded) writePref(PREF.marginFolded, "0");
  }, [editor, canComment, me, piece.id, marginFolded]);
  const endComment = useCallback(() => {
    setDraft(null);
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(heldSelectionKey, null).setMeta("addToHistory", false));
  }, [editor]);
  // Ctrl+Alt+M (as in Google Docs) comments on the highlighted words.
  useEffect(() => {
    if (!editor || !canComment) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        startComment();
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor, canComment, startComment]);

  const body = (
    <div className={`grid gap-6 ${marginFolded ? "lg:grid-cols-[1fr_auto]" : "lg:grid-cols-[1fr_18rem]"} ${workspace ? "p-4" : ""}`}>
      <section className="min-w-0">
        {owner ? (
          <input
            className="w-full bg-transparent font-serif text-3xl outline-none"
            value={title}
            aria-label="Piece title"
            onChange={(e) => {
              setTitle(e.target.value);
              meta.save({ title: e.target.value.slice(0, 300) || "Untitled" });
            }}
          />
        ) : (
          <h1 className="font-serif text-3xl">{title}</h1>
        )}

        {/* The piece's details, above the writing: the margin is for suggestions. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          {collegeName && <span>{collegeName}</span>}
          {owner ? (
            <>
              <span className="flex items-center gap-1">
                <label htmlFor={`${piece.id}-status`}>Status</label>
                <select
                  id={`${piece.id}-status`}
                  className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-ink"
                  value={pieceStatus}
                  onChange={(e) => {
                    const v = e.target.value as PieceStatus;
                    setPieceStatus(v);
                    meta.save({ status: v }, 0);
                  }}
                >
                  {/* A piece goes in with its whole application (Submit on the board), not on its own. */}
                  {PIECE_STATUSES.filter((s) => s.id !== "submitted" || pieceStatus === "submitted").map((s) => (
                    <option key={s.id} value={s.id} disabled={s.id === "submitted"}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </span>
              <span className="flex items-center gap-1">
                <label htmlFor={`${piece.id}-limit`}>Limit</label>
                <input
                  id={`${piece.id}-limit`}
                  className="w-20 rounded-md border border-line bg-panel px-1.5 py-0.5 text-ink disabled:opacity-50"
                  type="number"
                  min={1}
                  value={limitValue ?? ""}
                  disabled={limitKind === "none"}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    const v = Number.isFinite(n) && n > 0 ? n : null;
                    setLimitValue(v);
                    meta.save({ limit_value: v });
                  }}
                />
                <select
                  aria-label="Counted in"
                  className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-ink"
                  value={limitKind}
                  onChange={(e) => {
                    const v = e.target.value as LimitKind;
                    setLimitKind(v);
                    meta.save({ limit_kind: v }, 0);
                  }}
                >
                  <option value="words">words</option>
                  <option value="chars">characters</option>
                  <option value="none">no limit</option>
                </select>
              </span>
              <span className="flex items-center gap-1" title={collegeName ? "Empty: the college's deadline" : undefined}>
                <label htmlFor={`${piece.id}-due`}>Due</label>
                <input
                  id={`${piece.id}-due`}
                  className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-ink"
                  type="date"
                  value={due ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setDue(v);
                    meta.save({ due: v }, 0);
                  }}
                />
              </span>
            </>
          ) : (
            <span>{labelOf(PIECE_STATUSES, pieceStatus)}</span>
          )}
          {people.length > 0 && (
            <span className="flex flex-wrap gap-1" aria-label="Also here">
              {people.map((p, i) => (
                <span key={i} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ backgroundColor: p.color }}>
                  {p.name}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2" role="group" aria-label="Piece details">
          {fold(
            "prompt",
            "Prompt",
            !!prompt,
            owner ? (
              <FormattedTextarea
                className="field"
                rows={3}
                value={prompt}
                aria-label="Prompt"
                placeholder="Paste the question exactly as the college asks it."
                onChange={(e) => {
                  setPrompt(e.target.value);
                  meta.save({ prompt: e.target.value });
                }}
              />
            ) : (
              <div className="rounded-md border border-line bg-panel px-3 py-2">{prompt ? <AnswerText text={prompt} /> : <p className="text-sm">No prompt entered.</p>}</div>
            ),
          )}
          {fold(
            "notes",
            "Notes",
            !!notes,
            canWrite ? (
              <div>
                <FormattedTextarea
                  className="field"
                  rows={4}
                  value={notes}
                  aria-label="Notes"
                  placeholder={
                    owner
                      ? "Ideas, reminders, feedback. Kept apart from the essay and never counted. People you share with can read them, and edit them if they can suggest or edit."
                      : "Ideas, reminders, feedback for the student. Kept apart from the essay and never counted."
                  }
                  onChange={(e) => notesBox.change(e.target.value)}
                  onFocus={notesBox.onFocus}
                  onBlur={notesBox.onBlur}
                />
                {notesBox.error && (
                  <p className="mt-1 text-xs text-danger" role="alert">
                    {notesBox.error}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-line bg-panel px-3 py-2">{notes ? <AnswerText text={notes} /> : <p className="text-sm">No notes.</p>}</div>
            ),
          )}
          {rating.ready &&
            fold("rating", ratingLabel(rating), false, <PieceRatingPanel state={rating} deskId={deskId ?? ""} pieceId={piece.id} owner={owner} />)}
        </div>
        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {canEdit && (
              <div role="radiogroup" aria-label="Mode" className="inline-flex rounded-md border border-line bg-panel p-0.5 text-sm">
                {(["editing", "suggesting"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={editMode === m}
                    onClick={() => chooseMode(m)}
                    className={`rounded px-3 py-1 ${editMode === m ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
                  >
                    {m === "editing" ? "Editing" : "Suggesting"}
                  </button>
                ))}
              </div>
            )}
            {editorMode === "suggest" && (
              <p className="text-sm text-muted">
                Your changes show as suggestions{owner ? " you can accept or decline" : " for the writer to accept or decline"}. Ctrl+Z
                undoes your last suggestions.
              </p>
            )}
          </div>
        )}
        {role === "view" && <p className="mt-3 text-sm text-muted">You can read this piece. You can&apos;t change it.</p>}

        {editor && live && canWrite && (
          <div className="mt-3">
            <FormatToolbar editor={editor} mode={editorMode === "suggest" ? "suggest" : "owner"} store={live.store} />
          </div>
        )}
        <div className="card essay relative mt-4 px-5 py-4 sm:px-8 sm:py-6">
          {editor && canComment && <CommentButton editor={editor} onComment={startComment} />}
          {loadError ? (
            <p className="text-danger">Couldn&apos;t open this piece: {loadError}</p>
          ) : status === "gone" ? (
            <p className="text-danger">{STATUS_TEXT.gone}</p>
          ) : live ? (
            <EssayEditor
              key={editorMode}
              live={live}
              pieceId={piece.id}
              me={me}
              mode={editorMode}
              isDeskOwner={owner}
              onText={onText}
              onEditor={setEditor}
            />
          ) : (
            <p className="text-muted">{STATUS_TEXT.loading}</p>
          )}
        </div>

        <div className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg py-2 text-sm">
          <span data-testid="count" className={limit.over ? "font-medium text-danger" : ""}>
            {limit.limit
              ? `${limit.used} / ${limit.limit} ${limitKind === "chars" ? "characters" : "words"}`
              : `${countWords(text)} words · ${countChars(text)} characters`}
            {limit.over && ` (${limit.used - limit.limit!} over)`}
          </span>
          <span data-testid="sync-status" className={status === "offline" ? "text-warn" : "text-muted"}>
            {editorMode === "owner" ? STATUS_TEXT[status] : status === "loading" ? STATUS_TEXT.loading : "Live"}
          </span>
        </div>
        {limit.fraction !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className={`h-full ${limit.over ? "bg-danger" : "bg-accent"}`} style={{ width: `${limit.fraction * 100}%` }} />
          </div>
        )}
      </section>

      {/* The margin: suggestions, and nothing else. On a wide screen it folds away to the right. */}
      {/* It runs the height of the writing, each card beside its words; its heading and caret stay in view. */}
      <aside className="flex items-start gap-2" aria-label="Margin">
        <div id="essay-margin" className={`min-w-0 flex-1 self-stretch ${marginFolded ? "lg:hidden" : ""}`}>
          {commentsBehind && (
            <p className="mb-2 rounded-md border border-warn/40 bg-warn-soft px-2 py-1 text-xs text-warn" role="alert" data-testid="comments-behind">
              {owner
                ? "Comments can't be saved yet: your desk's database needs its latest update (run supabase/setup.sql in Supabase). Yours are kept on this device and sent once it's done."
                : "Comments can't be saved yet: this desk needs an update from its owner. Yours are kept on this device and sent once it's done."}
            </p>
          )}
          {live && editor ? (
            <SuggestionsPanel live={live} editor={editor} role={role} me={me.id} draft={draft} onDraftDone={endComment} />
          ) : (
            <p className="text-sm text-muted">Suggestions appear here.</p>
          )}
        </div>
        <MarginToggle folded={marginFolded} count={openCount} />
      </aside>
    </div>
  );
  if (!workspace) {
    return (
      <>
        {body}
        {compareView}
      </>
    );
  }
  return (
    <WriteWorkspace
      workspace={workspace}
      owner={owner}
      canAsk={role === "suggest" || role === "edit"}
      me={{ id: me.id, name: me.name, color: colorFor(me.id) }}
      pieceId={piece.id}
      deskId={deskId ?? ""}
      title={title}
      countNow={countLabel({ words: countWords(text), chars: countChars(text), kind: limitKind, limit: limitValue })}
      waitingNow={waitingNow}
      ratingNow={rating.ready ? (rating.rating ?? { rating: null }) : null}
      status={pieceStatus}
      editor={editor}
      history={
        <History
          pieceId={piece.id}
          comparingId={compare?.id ?? null}
          onCompare={openCompare}
          tick={historyTick}
          onSave={owner && editor ? saveNow : undefined}
        />
      }
      onDeleteCurrent={async () => {
        await live?.sync.flush().catch(() => {});
        live?.sync.discard();
      }}
    >
      {body}
      {compareView}
    </WriteWorkspace>
  );
}

/** The essay itself: TipTap bound to the piece's Yjs document. */
function EssayEditor({
  live,
  pieceId,
  me,
  mode,
  isDeskOwner = false,
  onText,
  onEditor,
}: {
  live: Live;
  pieceId: string;
  me: { id: string; name: string };
  mode: SuggestMode;
  /** The student (who keeps the version history); others editing only update the counts. */
  isDeskOwner?: boolean;
  onText: (t: string) => void;
  onEditor: (e: Editor | null) => void;
}) {
  const supabase = supabaseBrowser();
  const lastSnapshot = useRef<{ at: number; text: string | null }>({ at: 0, text: null });
  // The text as it was when this piece was opened.
  const opening = useRef<{ text: string; json: JSONContent } | null>(null);
  const owner = mode === "owner";

  const extensions = useMemo(() => {
    const { sync, store, channel } = live;
    const Suggestions = Extension.create({
      name: "suggestions",
      addProseMirrorPlugins: () => [suggestPlugin({ store, mode, me, pieceId })],
    });
    const user = channel.awareness.getLocalState()?.user as { name: string; color: string };
    return [
      essayStarterKit(),
      Collaboration.configure({ document: sync.doc, field: "default" }),
      CollaborationCaret.configure({ provider: { awareness: channel.awareness }, user }),
      Placeholder.configure({ placeholder: mode === "owner" ? "Start writing…" : "Nothing written yet." }),
      UndoCaret,
      HeldSelection,
      Rewrites(pieceId),
      Suggestions,
    ];
  }, [live, mode, me, pieceId]);

  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      editorProps: { attributes: { "aria-label": "Essay", "data-testid": "essay" } },
      onCreate: ({ editor }) => {
        const t = textOf(editor);
        onText(t);
        lastSnapshot.current = { at: Date.now(), text: t };
        opening.current = { text: t, json: editor.getJSON() };
      },
      onUpdate: ({ editor }) => onText(textOf(editor)),
    },
    [extensions],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  // After each save: refresh the board's derived fields, and take a version now and then. The
  // student's own saves count in Suggesting mode too (accepting a suggestion changes the text).
  useEffect(() => {
    if (!editor || !(owner || isDeskOwner)) return;
    const { sync } = live;
    let derivedTimer: ReturnType<typeof setTimeout> | null = null;
    let firstChecked = false;

    const saveDerived = () => {
      derivedTimer = null;
      const t = textOf(editor);
      const stats = { plain_text: t, word_count: countWords(t), char_count: countChars(t) };
      // Anyone editing may update the counts (migration 20260930); before it, only the student could.
      supabase
        .rpc("set_piece_text_stats", { piece: pieceId, plain: t, words: stats.word_count, chars: stats.char_count })
        .then(({ error }) => {
          if (error && isDeskOwner) supabase.from("pieces").update(stats).eq("id", pieceId).then(() => {});
          // The saved text moved on: a rating of the old one is now stale.
          else window.dispatchEvent(new CustomEvent(TEXT_SAVED, { detail: pieceId }));
        });
    };
    const snapshot = (force: boolean) => {
      // The version history is the student's; their editor keeps it.
      if (!isDeskOwner) return;
      const t = textOf(editor);
      const last = lastSnapshot.current;
      if (t === last.text) return;
      if (!force && Date.now() - last.at < SNAPSHOT_EVERY) return;
      lastSnapshot.current = { at: Date.now(), text: t };
      void saveVersion(supabase, pieceId, me.name, editor.getJSON(), t);
    };
    const onSaved = async () => {
      if (derivedTimer) clearTimeout(derivedTimer);
      derivedTimer = setTimeout(saveDerived, 800);
      if (!firstChecked && isDeskOwner) {
        firstChecked = true;
        const { data } = await supabase
          .from("piece_versions")
          .select("plain_text")
          .eq("piece_id", pieceId)
          .order("at", { ascending: false })
          .limit(1);
        const newest = data?.[0]?.plain_text ?? null;
        const open = opening.current;
        // Leaving a page can't be relied on to save a version, so the text a session ends with
        // is recorded when the next session starts changing it.
        if (open && open.text.trim() && open.text !== newest) {
          await saveVersion(supabase, pieceId, me.name, open.json, open.text);
        }
        // A new piece's first save records a version straight away, so history reaches the start.
        if (newest === null && !open?.text.trim()) {
          lastSnapshot.current.text = null;
          return snapshot(true);
        }
      }
      snapshot(false);
    };
    const unsubscribe = sync.addSavedListener(() => void onSaved());
    // A reload or a closed tab doesn't unmount: send the counts now rather than lose them.
    const onHide = () => {
      if (!derivedTimer) return;
      clearTimeout(derivedTimer);
      saveDerived();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      unsubscribe();
      if (derivedTimer) {
        clearTimeout(derivedTimer);
        saveDerived();
      }
      if (!editor.isDestroyed) snapshot(true);
    };
  }, [editor, live, supabase, pieceId, me.name, owner, isDeskOwner]);

  return <EditorContent editor={editor} />;
}

const cut = (t: string | undefined) => {
  const s = t ?? "";
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
};

/** What a suggestion does, in words, for screen readers. */
function describe(s: Suggestion): string {
  if (s.kind === "comment") return `Comment on “${cut(s.quote)}”: ${cut(s.body)}`;
  if (s.kind === "insert") return `Add “${cut(s.body)}”`;
  if (s.kind === "delete") return `Delete “${cut(s.quote)}”`;
  return `Replace “${cut(s.quote)}” with “${cut(s.body)}”`;
}

/** What a suggestion does, as it looks in the essay: taken out in red, added in green, line breaks kept. */
function SuggestionText({ s }: { s: Suggestion }) {
  return (
    <>
      <span className="sr-only">{describe(s)}</span>
      <span aria-hidden className="block font-serif break-words whitespace-pre-wrap">
        {s.kind !== "insert" && <span className="sugg-cut">{cut(s.quote)}</span>}
        {s.kind === "replace" && " "}
        {s.kind !== "delete" && <span className="sugg-add">{cut(s.body)}</span>}
      </span>
    </>
  );
}

const CARD: Record<Suggestion["kind"], string> = {
  insert: "border-add/40 bg-add-soft",
  delete: "border-danger/40 bg-danger-soft",
  replace: "border-line bg-panel",
  comment: "border-warn/40 bg-warn-soft",
};
const VERB: Record<Suggestion["kind"], string> = { insert: "Add", delete: "Delete", replace: "Replace", comment: "Comment" };

/**
 * A small "Comment" button just under highlighted words, while the essay has a highlight. It
 * doesn't take the focus, so the words stay highlighted when it's pressed.
 */
function CommentButton({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const place = () => {
      const { from, to, empty } = editor.state.selection;
      const box = editor.view.dom.closest(".essay") as HTMLElement | null;
      if (empty || !editor.isFocused || !box || !editor.state.doc.textBetween(from, to, " ").trim()) return setAt(null);
      try {
        const end = editor.view.coordsAtPos(to);
        const r = box.getBoundingClientRect();
        setAt({ top: end.bottom - r.top + 6, left: Math.max(8, Math.min(end.left - r.left - 24, r.width - 116)) });
      } catch {
        setAt(null);
      }
    };
    const hide = () => setAt(null);
    editor.on("selectionUpdate", place);
    editor.on("focus", place);
    editor.on("update", place);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", place);
      editor.off("focus", place);
      editor.off("update", place);
      editor.off("blur", hide);
    };
  }, [editor]);
  if (!at) return null;
  return (
    <button
      type="button"
      data-testid="comment-button"
      title="Comment on the highlighted words (Ctrl+Alt+M)"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setAt(null);
        onComment();
      }}
      style={{ top: at.top, left: at.left }}
      className="absolute z-10 flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 font-sans text-xs text-ink shadow-sm hover:border-muted"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
      </svg>
      Comment
    </button>
  );
}

/** Writing a new comment, at the top of the margin. */
function CommentDraft({ draft, onPost, onCancel }: { draft: Suggestion; onPost: (body: string) => void; onCancel: () => void }) {
  const [body, setBody] = useState("");
  const post = () => body.trim() && onPost(body.trim());
  // Focused without scrolling: it appears beside the highlighted words, which are already in view
  // (autoFocus would scroll to where it is for an instant before it is placed: the top).
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), []);
  return (
    <div className="rounded-md border border-warn/40 bg-warn-soft p-2 text-sm" data-testid="comment-draft">
      <p className="mb-1 font-serif text-muted italic break-words">“{cut(draft.quote)}”</p>
      <label htmlFor={`comment-${draft.id}`} className="sr-only">
        Your comment
      </label>
      <textarea
        id={`comment-${draft.id}`}
        className="field min-h-16 w-full resize-y"
        rows={3}
        ref={box}
        value={body}
        placeholder="Add a comment…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            post();
          } else if (e.key === "Escape") onCancel();
        }}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-primary" disabled={!body.trim()} onClick={post}>
          Comment
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The suggestion or comment last clicked in the essay (or its card). */
function usePicked(editor: Editor): string | null {
  const subscribe = useCallback(
    (fn: () => void) => {
      editor.on("transaction", fn);
      return () => void editor.off("transaction", fn);
    },
    [editor],
  );
  return useSyncExternalStore(
    subscribe,
    () => suggestKey.getState(editor.state)?.picked ?? null,
    () => null,
  );
}

/** How many suggestions are open (none while the piece loads). */
function useOpenCount(store: SuggestionStore | null): number {
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : () => {}), [store]);
  return useSyncExternalStore(
    subscribe,
    () => (store ? store.open().length : 0),
    () => 0,
  );
}

/** The open piece's suggestions and comments, as they come and go (null while it loads). */
function useWaitingNow(store: SuggestionStore | null): Waiting | null {
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : () => {}), [store]);
  const key = useSyncExternalStore(
    subscribe,
    () => {
      if (!store) return "";
      const open = store.open();
      const comments = open.filter((s) => s.kind === "comment").length;
      return `${open.length - comments}:${comments}`;
    },
    () => "",
  );
  return useMemo(() => {
    if (!key) return null;
    const [suggestions, comments] = key.split(":").map(Number);
    return { suggestions, comments };
  }, [key]);
}

/** The caret that folds the margin away (the writing takes its space) and brings it back, with how many suggestions wait there. */
function MarginToggle({ folded, count }: { folded: boolean; count: number }) {
  const waiting = count ? ` (${count} waiting)` : "";
  return (
    <button
      type="button"
      aria-expanded={!folded}
      aria-controls="essay-margin"
      aria-label={folded ? `Show the margin${waiting}` : "Fold the margin away"}
      title={folded ? `Show the suggestions and comments${waiting}` : "Fold the margin away: the writing takes its space"}
      onClick={() => writePref(PREF.marginFolded, folded ? "0" : "1")}
      className="hidden shrink-0 flex-col items-center gap-1 rounded-md p-1 text-muted hover:bg-bg hover:text-ink lg:sticky lg:top-0 lg:flex"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={folded ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
      </svg>
      {folded && count > 0 && (
        <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-semibold text-accent-ink" data-testid="margin-count">
          {count}
        </span>
      )}
    </button>
  );
}

function SuggestionsPanel({
  live,
  editor,
  role,
  me,
  draft,
  onDraftDone,
}: {
  live: Live;
  editor: Editor;
  role: Role;
  me: string;
  /** A comment being written, if any. */
  draft: Suggestion | null;
  onDraftDone: () => void;
}) {
  const { store } = live;
  const picked = usePicked(editor);
  const open = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.open(),
    () => store.open(),
  );
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  // What was accepted, declined, resolved, deleted or withdrawn, newest last: Ctrl+Z takes each
  // back in turn (the text and the card both) whenever the essay is as that left it, and Ctrl+Y
  // (or Ctrl+Shift+Z) does it again. In between, the essay's own undo and redo work as usual, and
  // so does a suggester's undo of what they suggested since.
  const done = useRef<Act[]>([]);
  const undone = useRef<Act[]>([]);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const undoManager = () => (yUndoPluginKey.getState(editor.state) as { undoManager?: { stopCapturing(): void } } | undefined)?.undoManager;
  const takeBack = () => {
    const a = done.current.pop();
    if (!a) return;
    if (a.status === "removed") store.bringBack(a.row!);
    else {
      if (a.changesText) editor.commands.undo();
      store.resolve(a.id, "open");
    }
    undone.current.push(a);
    setUndo(null);
  };
  const doAgain = () => {
    const a = undone.current.pop();
    if (!a) return;
    if (a.status === "removed") store.remove(a.id, { record: false });
    else {
      if (a.changesText) editor.commands.redo();
      store.resolve(a.id, a.status);
    }
    done.current.push(a);
  };
  const did = (a: Omit<Act, "after" | "at">) => {
    undoManager()?.stopCapturing();
    done.current.push({ ...a, after: editor.state.doc, at: store.clock() });
    undone.current = [];
    setUndo({ label: a.label, run: takeBack });
    setProblem(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || editor.isDestroyed) return;
      const k = e.key.toLowerCase();
      const back = k === "z" && !e.shiftKey;
      const again = k === "y" || (k === "z" && e.shiftKey);
      if (!back && !again) return;
      const at = document.activeElement as HTMLElement | null;
      if (at && at !== document.body && !editor.view.dom.contains(at) && !at.closest("#essay-margin")) return;
      const doc = editor.state.doc;
      const top = back ? done.current.at(-1) : undone.current.at(-1);
      if (!top || !doc.eq(back ? top.after : top.before)) return;
      // Something suggested since is the suggester's own undo's to take back first.
      if (back && store.lastUndoAt() > top.at) return;
      e.preventDefault();
      e.stopPropagation();
      if (back) takeBack();
      else doAgain();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // takeBack and doAgain only read refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
  /** Delete my comment, or withdraw my suggestion; Ctrl+Z puts it back. */
  const takeAway = (s: Suggestion, label: string) => {
    const before = editor.state.doc;
    store.remove(s.id, { record: false });
    did({ label, id: s.id, status: "removed", changesText: false, before, row: s });
    backToEssay();
  };
  /** Back to the essay after a button in the margin, without scrolling it. */
  const backToEssay = () => {
    if (!editor.isDestroyed) editor.view.dom.focus({ preventScroll: true });
  };

  /**
   * A card clicked: its words in the essay are picked, and (beside the writing) scrolled into view,
   * with the card lined up next to them.
   */
  const pick = (id: string) => {
    editor.view.dispatch(editor.state.tr.setMeta(suggestKey, { pick: id }));
    if (wide) editor.view.dom.querySelector(`[data-sugg="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // In the order they come in the essay (where two start at the same place, the older first);
  // ones whose words are gone go last. A comment being written sits among them, at its words.
  const placed = [...open, ...(draft ? [draft] : [])]
    .map((s, i) => {
      const r = resolveSuggestion(editor.state, s);
      return { s, r, i, pos: r.from ?? r.at ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((x, y) => x.pos - y.pos || x.i - y.i);

  // Beside the writing (a wide screen), each card sits level with its words, moved down only as
  // far as the card above it needs. Below the writing (a narrow one), they are a plain list.
  const wide = useMedia("(min-width: 64rem)");
  const listRef = useRef<HTMLUListElement>(null);
  const [spots, setSpots] = useState<{ tops: Record<string, number>; height: number }>({ tops: {}, height: 0 });
  // Cards already in place glide to new places; a new one is put straight where it goes.
  const placedCards = useRef(new Set<string>());
  const [, again] = useState(0);
  useEffect(() => {
    // The words move when the essay changes, and when anything above or around it changes size.
    const redo = () => again((n) => n + 1);
    editor.on("update", redo);
    window.addEventListener("resize", redo);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redo);
    ro?.observe(editor.view.dom);
    const section = editor.view.dom.closest("section");
    if (section) ro?.observe(section);
    return () => {
      editor.off("update", redo);
      window.removeEventListener("resize", redo);
      ro?.disconnect();
    };
  }, [editor]);
  // After every render: the cards' own heights decide the places, and a place that hasn't changed
  // sets nothing, so this settles at once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul || !wide) return;
    const base = ul.getBoundingClientRect().top;
    // Each card, where its words are (null if the editor can't place them right now), and how tall.
    const cards = placed
      .map(({ s, r }) => {
        const el = ul.querySelector<HTMLElement>(`[data-card="${s.id}"]`);
        const pos = r.from ?? r.at;
        let want: number | null = null;
        if (pos !== null) {
          try {
            want = editor.view.coordsAtPos(pos).top - base - 6;
          } catch {
            // It goes after the one above.
          }
        }
        return el ? { id: s.id, want, h: el.offsetHeight } : null;
      })
      .filter((c) => c !== null);
    // Top to bottom, each beside its words or just below the one above.
    const stack = (from: number) => {
      const tops: Record<string, number> = {};
      let floor = 0;
      for (let i = from; i < cards.length; i++) {
        const top = Math.round(Math.max(cards[i].want ?? floor, floor));
        tops[cards[i].id] = top;
        floor = top + cards[i].h + 8;
      }
      return { tops, floor };
    };
    // The picked one sits exactly beside its words: the ones above it move up out of its way and
    // the ones below move down, as in a word processor's margin. With no room above it for them
    // (they'd go past the top, out of reach), they all go below it instead, in their order.
    const at = picked ? cards.findIndex((c) => c.id === picked && c.want !== null) : -1;
    let tops: Record<string, number> = {};
    let floor = 0;
    if (at >= 0) {
      const want = Math.round(cards[at].want!);
      tops[cards[at].id] = want;
      let ceiling = want - 8;
      for (let i = at - 1; i >= 0; i--) {
        const top = Math.round(Math.min(cards[i].want ?? ceiling, ceiling - cards[i].h));
        tops[cards[i].id] = top;
        ceiling = top - 8;
      }
      floor = want + cards[at].h + 8;
      const rest = ceiling + 8 < 0 ? cards.filter((_, i) => i !== at) : cards.slice(at + 1);
      for (const c of rest) {
        const top = Math.round(Math.max(c.want ?? floor, floor));
        tops[c.id] = top;
        floor = top + c.h + 8;
      }
    } else ({ tops, floor } = stack(0));
    floor = Math.max(floor, ...cards.map((c) => (tops[c.id] ?? 0) + c.h + 8));
    for (const c of cards) {
      if (placedCards.current.has(c.id)) continue;
      const el = ul.querySelector<HTMLElement>(`[data-card="${c.id}"]`);
      if (!el) continue;
      // Straight to its place; from the next frame on, it glides when it moves.
      el.style.top = `${tops[c.id]}px`;
      placedCards.current.add(c.id);
      requestAnimationFrame(() => (el.style.transition = "top 180ms ease-out"));
    }
    setSpots((prev) => {
      const ids = Object.keys(tops);
      const same = prev.height === floor && ids.length === Object.keys(prev.tops).length && ids.every((id) => prev.tops[id] === tops[id]);
      return same ? prev : { tops, height: floor };
    });
  });
  const spot = (id: string) => (wide ? { top: spots.tops[id] ?? 0 } : undefined);
  // Below the writing (a narrow screen), a suggestion clicked in the essay is shown by scrolling to its card.
  useEffect(() => {
    if (picked && !wide) document.querySelector(`[data-card="${picked}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked, wide]);
  const CARD_AT = "lg:absolute lg:inset-x-0";

  if (!placed.length && !undo) {
    return (
      <div className="bg-bg lg:sticky lg:top-0">
        <p className="label">Suggestions and comments</p>
        <p className="text-sm text-muted">
          {role === "owner"
            ? "Suggestions and comments from the people you share with, and from Claude, appear here beside the words they are about. Highlight words to comment on them."
            : role === "view"
              ? "No suggestions or comments yet."
              : "None yet. Your suggestions and comments appear here for the writer, beside the words they are about. Highlight words to comment on them."}
        </p>
      </div>
    );
  }

  const comments = open.filter((s) => s.kind === "comment").length;
  const counts = [open.length - comments ? `${open.length - comments} suggestion${open.length - comments === 1 ? "" : "s"}` : "", comments ? `${comments} comment${comments === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="flex h-full flex-col">
      {/* The heading follows the essay down; the cards stay beside their words. */}
      <div className="z-10 bg-bg pb-1 lg:sticky lg:top-0" data-testid="margin-heading">
        <p className="label">Suggestions and comments{counts && ` (${counts})`}</p>
        {undo && (
          <p className="mb-1 flex items-center justify-between rounded-md bg-accent-soft px-2 py-1 text-sm" role="status">
            {undo.label}
            <button
              type="button"
              className="underline"
              onClick={() => {
                undo.run();
                setUndo(null);
              }}
            >
              Undo
            </button>
          </p>
        )}
      </div>
      <ul
        ref={listRef}
        className="relative flex flex-1 flex-col gap-2 lg:block"
        style={wide ? { minHeight: spots.height } : undefined}
        aria-label="Suggestions and comments"
      >
        {placed.map(({ s, r }) => {
          if (draft && s.id === draft.id) {
            return (
              <li key={s.id} data-card={s.id} className={CARD_AT} style={spot(s.id)}>
                <CommentDraft
                  draft={draft}
                  onCancel={onDraftDone}
                  onPost={(body) => {
                    store.put({ ...draft, body, created_at: new Date().toISOString() });
                    onDraftDone();
                  }}
                />
              </li>
            );
          }
          if (s.kind === "comment") {
            return (
              <li
                key={s.id}
                data-card={s.id}
                className={`rounded-md border p-2 text-sm ${CARD_AT} ${CARD.comment} ${picked === s.id ? "ring-2 ring-accent" : ""}`}
                style={spot(s.id)}
                data-testid="comment"
              >
                <button type="button" className="block w-full text-left" onClick={() => pick(s.id)}>
                  <span className="mb-1 block text-xs text-muted">
                    <span aria-hidden className="font-medium text-warn">
                      Comment ·{" "}
                    </span>
                    {s.author_name || "Someone"}
                    {s.source === "ai" && " · AI"}
                    {r.gone && " · its words are gone"}
                  </span>
                  <span className="sr-only">{describe(s)}</span>
                  <span aria-hidden className="block font-serif text-muted italic break-words">
                    “{cut(s.quote)}”
                  </span>
                  <span aria-hidden className="mt-1 block break-words whitespace-pre-wrap">
                    {s.body}
                  </span>
                </button>
                <div className="mt-2 flex gap-2">
                  {role === "owner" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const before = editor.state.doc;
                        store.resolve(s.id, "accepted");
                        did({ label: "Resolved.", id: s.id, status: "accepted", changesText: false, before });
                        backToEssay();
                      }}
                    >
                      Resolve
                    </button>
                  )}
                  {role !== "view" && s.author_id === me && (
                    <button type="button" className="btn" onClick={() => takeAway(s, "Deleted.")}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          }
          return (
            <li
              key={s.id}
              data-card={s.id}
              className={`rounded-md border p-2 text-sm ${CARD_AT} ${CARD[s.kind]} ${picked === s.id ? "ring-2 ring-accent" : ""}`}
              style={spot(s.id)}
              data-testid="suggestion"
              data-kind={s.kind}
            >
              <button type="button" className="block w-full text-left" onClick={() => pick(s.id)}>
                <span className="mb-1 block text-xs text-muted">
                  <span aria-hidden className={`font-medium ${s.kind === "insert" ? "text-add" : s.kind === "delete" ? "text-danger" : "text-ink"}`}>
                    {VERB[s.kind]} ·{" "}
                  </span>
                  {s.author_name || "Someone"}
                  {s.source === "ai" && " · AI"}
                  {r.stale && !r.gone && " · the text changed since"}
                  {r.gone && " · its text is gone"}
                </span>
                <SuggestionText s={s} />
                {s.note && (
                  <span className="mt-1 block text-xs text-muted">
                    Why: <InlineText text={s.note} />
                  </span>
                )}
              </button>
              {problem?.id === s.id && (
                <p className="mt-1 text-xs text-danger" role="alert">
                  {problem.text}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                {role === "owner" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={r.gone && s.kind !== "insert"}
                      onClick={() => {
                        const before = editor.state.doc;
                        // Its own step in the essay's undo, apart from typing just before it.
                        undoManager()?.stopCapturing();
                        // Only marked accepted once the essay has really changed.
                        if (!acceptInto(editor.view, s) || editor.state.doc.eq(before)) {
                          console.warn("Accepting a suggestion changed nothing", { kind: s.kind, resolved: { from: r.from, to: r.to, at: r.at, stale: r.stale, gone: r.gone }, quote: s.quote, body: s.body });
                          setProblem({ id: s.id, text: "This one couldn't be put in: its words may have changed since. Make the change by hand, or decline it." });
                          return;
                        }
                        store.resolve(s.id, "accepted");
                        did({ label: "Accepted.", id: s.id, status: "accepted", changesText: true, before });
                        backToEssay();
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const before = editor.state.doc;
                        store.resolve(s.id, "declined");
                        did({ label: "Declined.", id: s.id, status: "declined", changesText: false, before });
                        backToEssay();
                      }}
                    >
                      Decline
                    </button>
                  </>
                )}
                {role !== "owner" && role !== "view" && s.author_id === me && (
                  <button type="button" className="btn" onClick={() => takeAway(s, "Withdrawn.")}>
                    Withdraw
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The piece's saved versions. Picking one opens the side-by-side comparison, which the piece
 * editor holds (so it stays open when the side panel folds).
 */
function History({
  pieceId,
  comparingId,
  onCompare,
  tick,
  onSave,
}: {
  pieceId: string;
  comparingId: string | null;
  onCompare: (versions: VersionRow[], id: string) => void;
  /** Bumped after a restore or a save, to list the version it saved. */
  tick: number;
  /** Save the piece as it is now as a version, with an optional name (the student only). */
  onSave?: (label: string) => Promise<boolean>;
}) {
  const supabase = supabaseBrowser();
  const [all, setVersions] = useState<VersionRow[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState<"idle" | "busy" | "saved" | "failed">("idle");
  const [namedOnly, setNamedOnly] = useState(false);

  useEffect(() => {
    listVersions(supabase, pieceId).then(setVersions, () => setVersions([]));
  }, [supabase, pieceId, tick]);
  useEffect(() => {
    if (saving !== "saved") return;
    const t = setTimeout(() => setSaving("idle"), 3000);
    return () => clearTimeout(t);
  }, [saving]);

  const named = all?.some((v) => v.label) ?? false;
  const versions = all && namedOnly && named ? all.filter((v) => v.label) : all;

  return (
    <div className="flex flex-col gap-2 p-3">
      {onSave && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (saving === "busy") return;
            setSaving("busy");
            void onSave(name).then((ok) => {
              setSaving(ok ? "saved" : "failed");
              if (ok) setName("");
            });
          }}
        >
          <label htmlFor={`${pieceId}-version-name`} className="text-xs text-muted">
            Save the piece as it is now, to find it again later
          </label>
          <div className="flex gap-1.5">
            <input
              id={`${pieceId}-version-name`}
              className="field min-w-0 flex-1 text-sm"
              value={name}
              maxLength={120}
              placeholder="Name it (optional)"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={saving === "busy"}>
              Save version
            </button>
          </div>
          {saving === "saved" && (
            <p className="text-xs text-add" role="status">
              Saved.
            </p>
          )}
          {saving === "failed" && (
            <p className="text-xs text-danger" role="alert">
              Couldn&apos;t save it. Check your connection and try again.
            </p>
          )}
        </form>
      )}
      {named && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
          Named versions only
        </label>
      )}
      {versions === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted">No saved versions yet.</p>
      ) : (
        <>
          <p className="text-xs text-muted">Pick a version to see it beside the piece as it is now, with what changed since.</p>
          <ul className="max-h-[70vh] overflow-y-auto rounded-md border border-line bg-panel text-sm" aria-label="Saved versions">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`flex w-full justify-between gap-2 px-2 py-1 text-left hover:bg-bg ${comparingId === v.id ? "bg-accent-soft" : ""}`}
                  onClick={() => onCompare(versions, v.id)}
                >
                  <span className="min-w-0">
                    {v.label && <span className="block font-medium break-words text-ink">{v.label}</span>}
                    <span className={v.label ? "text-xs text-muted" : ""}>
                      {new Date(v.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted">{v.words} words</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

type EditMode = "editing" | "suggesting";
const modeKey = (role: Role) => `desk:mode:${role}`;

/** The Editing/Suggesting choice this browser made for this role, if any. */
function readMode(role: Role): EditMode | null {
  try {
    const v = localStorage.getItem(modeKey(role));
    return v === "editing" || v === "suggesting" ? v : null;
  } catch {
    return null;
  }
}

function writeMode(role: Role, m: EditMode) {
  try {
    localStorage.setItem(modeKey(role), m);
  } catch {
    // Private mode: just don't remember.
  }
}
