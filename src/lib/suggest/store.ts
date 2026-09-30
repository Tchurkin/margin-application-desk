/*
 * Suggestions for one piece: the local copy, what still has to reach the server, and undo.
 *
 * Local first: a suggestion is drawn the moment it is made, parked in local storage until the
 * server has it, and replayed on the next load if the page goes away first. An echo of our own
 * write never overwrites what we have since typed.
 */

import type { KeyValue } from "@/lib/sync/piece-sync";

/** A comment is a note on the words it covers (`body`); it never changes the text. */
export type SuggestionKind = "insert" | "delete" | "replace" | "comment";
export type SuggestionStatus = "open" | "accepted" | "declined";

export interface Suggestion {
  id: string;
  piece_id: string;
  author_id: string;
  author_name: string;
  source: "person" | "ai";
  kind: SuggestionKind;
  /** Base64 Yjs relative positions. */
  anchor_from: string;
  anchor_to: string | null;
  quote: string;
  body: string;
  /** Why it was suggested (always present on AI suggestions). */
  note?: string;
  /** For an insertion: the text just before it, to find the spot again if its anchor comes loose. */
  context?: string;
  status: SuggestionStatus;
  version: number;
  created_at: string;
}

export type BackendResult = "ok" | "retry" | "rejected";

export interface SuggestionBackend {
  list(pieceId: string): Promise<Suggestion[]>;
  /** Create or update one of the caller's own suggestions. */
  put(s: Suggestion): Promise<BackendResult>;
  /** Withdraw one of the caller's own open suggestions. */
  remove(id: string): Promise<BackendResult>;
  /** The student accepts, declines, or reopens. */
  resolve(id: string, status: SuggestionStatus): Promise<BackendResult>;
}

type Pending =
  | { op: "put"; row: Suggestion }
  | { op: "remove" }
  | { op: "resolve"; status: SuggestionStatus };

interface UndoEntry {
  id: string;
  before: Suggestion | null;
  after: Suggestion | null;
}

/** Edits closer together than this undo as one step. */
const BURST_MS = 1000;

export class SuggestionStore {
  private rows = new Map<string, Suggestion>();
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private stopped = false;
  private undoStack: { at: number; entries: UndoEntry[] }[] = [];
  private redoStack: { at: number; entries: UndoEntry[] }[] = [];
  private key: string;
  private retryMs = 500;
  /** Local changes are numbered, so a reload can tell what changed here while it was in flight. */
  private seq = 0;
  private touched = new Map<string, number>();

  constructor(
    private pieceId: string,
    private backend: SuggestionBackend,
    private storage: KeyValue | null,
    clientId: string,
    private opts: { flushDelayMs?: number; now?: () => number } = {},
  ) {
    this.key = `desk:sugg:${pieceId}:${clientId}`;
  }

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private openCache: Suggestion[] | null = null;

  private emit() {
    this.openCache = null;
    this.listeners.forEach((f) => f());
  }

  /** Open suggestions, oldest first. The same array until something changes. */
  open(): Suggestion[] {
    if (this.openCache) return this.openCache;
    return (this.openCache = [...this.rows.values()]
      .filter((s) => s.status === "open")
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1)));
  }

  get(id: string): Suggestion | undefined {
    return this.rows.get(id);
  }

  async start(): Promise<void> {
    const list = await this.backend.list(this.pieceId);
    for (const s of list) this.rows.set(s.id, s);
    // Replay anything parked by an earlier load of this tab.
    const parked = this.readParked();
    for (const [id, p] of parked) {
      this.pending.set(id, p);
      if (p.op === "put") this.rows.set(id, p.row);
      else if (p.op === "remove") this.rows.delete(id);
      else {
        const s = this.rows.get(id);
        if (s) this.rows.set(id, { ...s, status: p.status });
      }
    }
    this.emit();
    if (this.pending.size) this.schedule(0);
  }

  // ─── changes made here ────────────────────────────────────────────────────

  /** Create or change one of my suggestions. */
  put(row: Suggestion) {
    const before = this.rows.get(row.id) ?? null;
    const next = { ...row, version: (before?.version ?? 0) + 1 };
    this.rows.set(row.id, next);
    this.queue(row.id, { op: "put", row: next });
    this.record({ id: row.id, before, after: next });
  }

  /** Withdraw one of my suggestions. */
  remove(id: string) {
    const before = this.rows.get(id) ?? null;
    if (!before) return;
    this.rows.delete(id);
    // Withdrawing one the server never received deletes nothing there, which is fine.
    this.queue(id, { op: "remove" });
    this.record({ id, before, after: null });
  }

  /** The student accepts, declines or reopens. Not part of the suggester's undo. */
  resolve(id: string, status: SuggestionStatus) {
    const s = this.rows.get(id);
    if (!s) return;
    this.rows.set(id, { ...s, status });
    this.queue(id, { op: "resolve", status });
  }

  private queue(id: string, p: Pending) {
    this.touched.set(id, ++this.seq);
    this.pending.set(id, p);
    this.writeParked();
    this.emit();
    this.schedule(this.opts.flushDelayMs ?? 250);
  }

  private record(e: UndoEntry) {
    const t = this.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && t - top.at < BURST_MS) {
      top.entries.push(e);
      top.at = t;
    } else this.undoStack.push({ at: t, entries: [e] });
    this.redoStack = [];
  }

  private restore(id: string, state: Suggestion | null) {
    if (state) {
      const cur = this.rows.get(id);
      const next = { ...state, version: Math.max(cur?.version ?? 0, state.version) + 1 };
      this.rows.set(id, next);
      this.queue(id, { op: "put", row: next });
    } else if (this.rows.has(id)) {
      this.rows.delete(id);
      this.queue(id, { op: "remove" });
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  /** Step back one burst of my suggesting. */
  undo(): boolean {
    const g = this.undoStack.pop();
    if (!g) return false;
    for (const e of [...g.entries].reverse()) this.restore(e.id, e.before);
    this.redoStack.push(g);
    return true;
  }

  redo(): boolean {
    const g = this.redoStack.pop();
    if (!g) return false;
    for (const e of g.entries) this.restore(e.id, e.after);
    this.undoStack.push(g);
    return true;
  }

  // ─── changes from elsewhere ───────────────────────────────────────────────

  /** A row arrived from the server (someone else's change, or an echo of ours). */
  applyRemote(incoming: Suggestion) {
    const p = this.pending.get(incoming.id);
    const cur = this.rows.get(incoming.id);
    if (p && p.op !== "resolve") return; // ours is newer and on its way
    if (p?.op === "resolve" && incoming.status !== p.status) return;
    // Realtime leaves out long text columns an UPDATE didn't change (Postgres TOAST), and
    // drops large fields from oversized rows. Merge what arrived into the row we have; if we
    // don't have it, fetch it whole rather than keep a row with missing text.
    const present = Object.fromEntries(Object.entries(incoming).filter(([, v]) => v != null));
    if (!cur && (incoming.quote == null || incoming.body == null || incoming.anchor_from == null)) {
      void this.reload();
      return;
    }
    const row = (cur ? { ...cur, ...present } : incoming) as Suggestion;
    if (row.anchor_to === undefined) row.anchor_to = null;
    if (cur && cur.author_id === row.author_id && cur.version > row.version) return; // stale echo
    if (cur && sameRow(cur, row)) return;
    this.rows.set(row.id, row);
    this.emit();
  }

  applyRemoteDelete(id: string) {
    if (this.pending.has(id)) return;
    if (this.rows.delete(id)) this.emit();
  }

  // ─── sending ──────────────────────────────────────────────────────────────

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  hasPending() {
    return this.pending.size > 0;
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.pending.size ? this.flush() : undefined));
    if (!this.pending.size) return Promise.resolve();
    const batch = [...this.pending.entries()];
    this.flushing = (async () => {
      let retry = false;
      for (const [id, p] of batch) {
        let r: BackendResult;
        try {
          r = p.op === "put" ? await this.backend.put(p.row) : p.op === "remove" ? await this.backend.remove(id) : await this.backend.resolve(id, p.status);
        } catch {
          r = "retry";
        }
        if (this.stopped) return;
        if (r === "retry") {
          retry = true;
          continue;
        }
        // Only clear it if nothing newer was queued for this id meanwhile.
        if (this.pending.get(id) === p) this.pending.delete(id);
        if (r === "rejected") {
          // The server refused it (resolved by the student, link revoked, piece deleted).
          await this.reload();
        }
      }
      this.writeParked();
      this.flushing = null;
      if (retry) {
        this.schedule(this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 15_000);
      } else {
        this.retryMs = 500;
        if (this.pending.size) this.schedule(0);
      }
      this.emit();
    })();
    return this.flushing;
  }

  /**
   * Take the server's copy, except for anything changed here since the reload started (its
   * answer may predate those changes) or still waiting to be sent.
   */
  async reload() {
    const startedAt = this.seq;
    try {
      const list = await this.backend.list(this.pieceId);
      const next = new Map(list.map((s) => [s.id, s] as const));
      for (const [id, at] of this.touched) {
        if (at <= startedAt && !this.pending.has(id)) continue;
        const local = this.rows.get(id);
        if (local) next.set(id, local);
        else next.delete(id);
      }
      for (const id of this.pending.keys()) {
        const local = this.rows.get(id);
        if (local) next.set(id, local);
        else next.delete(id);
      }
      this.rows = next;
      this.emit();
    } catch {
      // The next event brings it up to date.
    }
  }

  // ─── parking ──────────────────────────────────────────────────────────────

  private readParked(): [string, Pending][] {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? (JSON.parse(raw) as [string, Pending][]) : [];
    } catch {
      return [];
    }
  }

  private writeParked() {
    try {
      if (this.pending.size) this.storage?.setItem(this.key, JSON.stringify([...this.pending.entries()]));
      else this.storage?.removeItem(this.key);
    } catch {
      // Storage full or blocked.
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

function sameRow(a: Suggestion, b: Suggestion) {
  return (
    a.status === b.status &&
    a.body === b.body &&
    a.quote === b.quote &&
    a.anchor_from === b.anchor_from &&
    a.anchor_to === b.anchor_to &&
    a.kind === b.kind
  );
}
