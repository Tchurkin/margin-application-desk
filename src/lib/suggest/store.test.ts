import { describe, expect, it } from "vitest";
import { SuggestionStore, type BackendResult, type Suggestion, type SuggestionBackend, type SuggestionStatus } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** The server, with the same rules as the database: authors edit open rows, owners resolve. */
class FakeBackend implements SuggestionBackend {
  rows = new Map<string, Suggestion>();
  latency = 0;
  offline = false;
  onChange: ((s: Suggestion) => void) | null = null;
  private async wait() {
    if (this.latency) await sleep(this.latency);
    if (this.offline) throw new Error("offline");
  }
  async list() {
    await this.wait();
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
  async put(s: Suggestion): Promise<BackendResult> {
    await this.wait();
    const cur = this.rows.get(s.id);
    if (cur && cur.status !== "open") return "rejected";
    this.rows.set(s.id, { ...s });
    this.onChange?.({ ...s });
    return "ok";
  }
  async remove(id: string): Promise<BackendResult> {
    await this.wait();
    const cur = this.rows.get(id);
    if (cur && cur.status !== "open") return "rejected";
    this.rows.delete(id);
    return "ok";
  }
  async resolve(id: string, status: SuggestionStatus): Promise<BackendResult> {
    await this.wait();
    const cur = this.rows.get(id);
    if (!cur) return "rejected";
    this.rows.set(id, { ...cur, status });
    return "ok";
  }
}

let n = 0;
function sugg(over: Partial<Suggestion> = {}): Suggestion {
  n++;
  return {
    id: `s${n}`,
    piece_id: "p",
    author_id: "parent",
    author_name: "Mom",
    source: "person",
    kind: "insert",
    anchor_from: "AA==",
    anchor_to: null,
    quote: "",
    body: "",
    status: "open",
    version: 0,
    created_at: new Date(2026, 0, 1, 0, 0, n).toISOString(),
    ...over,
  };
}

describe("SuggestionStore", () => {
  it("draws a suggestion at once and sends it", async () => {
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 1 });
    await st.start();
    const s = sugg({ body: "hi" });
    st.put(s);
    expect(st.open().map((x) => x.body)).toEqual(["hi"]);
    await st.flush();
    expect(be.rows.get(s.id)?.body).toBe("hi");
  });

  it("an echo of an earlier save never overwrites newer typing", async () => {
    const be = new FakeBackend();
    be.latency = 5;
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 0 });
    const echoes: Suggestion[] = [];
    be.onChange = (s) => echoes.push(s);
    await st.start();
    let s = sugg({ body: "h" });
    st.put(s);
    for (const ch of "ello") {
      s = { ...st.get(s.id)!, body: st.get(s.id)!.body + ch };
      st.put(s);
      await sleep(2);
    }
    // Replay every echo, oldest first, as the realtime feed would.
    for (const e of echoes) st.applyRemote(e);
    expect(st.get(s.id)?.body).toBe("hello");
    await st.flush();
    for (const e of echoes) st.applyRemote(e);
    expect(st.get(s.id)?.body).toBe("hello");
    expect(be.rows.get(s.id)?.body).toBe("hello");
  });

  it("leaving right after suggesting keeps the suggestion (parked, replayed on load)", async () => {
    const be = new FakeBackend();
    be.offline = true;
    const storage = new MemoryStorage();
    const a = new SuggestionStore("p", be, storage, "tab", { flushDelayMs: 0 });
    be.offline = false;
    await a.start();
    be.offline = true;
    const s = sugg({ body: "keep me" });
    a.put(s);
    await sleep(5);
    a.stop();
    be.offline = false;
    const b = new SuggestionStore("p", be, storage, "tab", { flushDelayMs: 0 });
    await b.start();
    expect(b.open().map((x) => x.body)).toEqual(["keep me"]);
    await b.flush();
    expect(be.rows.get(s.id)?.body).toBe("keep me");
    expect(storage.length).toBe(0);
  });

  it("undo steps back through bursts, and the server follows", async () => {
    let t = 0;
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 0, now: () => t });
    await st.start();
    const a = sugg({ body: "a" });
    st.put(a);
    t += 100;
    st.put({ ...st.get(a.id)!, body: "ab" }); // same burst
    t += 5000;
    const b = sugg({ body: "second" });
    st.put(b); // new burst
    await st.flush();

    expect(st.undo()).toBe(true);
    await st.flush();
    expect(st.get(b.id)).toBeUndefined();
    expect(be.rows.has(b.id)).toBe(false);
    expect(st.get(a.id)?.body).toBe("ab");

    expect(st.undo()).toBe(true);
    await st.flush();
    expect(st.open()).toHaveLength(0);
    expect(be.rows.size).toBe(0);

    expect(st.redo()).toBe(true);
    await st.flush();
    expect(be.rows.get(a.id)?.body).toBe("ab");
  });

  it("the margin's delete stays out of the suggester's undo, and bringBack puts it back on the server", async () => {
    let t = 0;
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 0, now: () => t });
    await st.start();
    const c = sugg({ kind: "comment", quote: "cat", body: "Which cat?" });
    st.put(c);
    await st.flush();
    t += 5000;
    const madeAt = st.lastUndoAt();
    st.remove(c.id, { record: false });
    await st.flush();
    expect(be.rows.has(c.id)).toBe(false);
    expect(st.lastUndoAt()).toBe(madeAt);
    expect(st.clock()).toBeGreaterThan(madeAt);

    st.bringBack(c);
    await st.flush();
    expect(st.open().map((x) => x.body)).toEqual(["Which cat?"]);
    expect(be.rows.get(c.id)?.body).toBe("Which cat?");
    // Its own undo still holds only the comment's making.
    expect(st.undo()).toBe(true);
    expect(st.undo()).toBe(false);
  });

  it("a suggestion the student resolved can't be edited, and the store takes the server's word", async () => {
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 0 });
    await st.start();
    const s = sugg({ body: "x" });
    st.put(s);
    await st.flush();
    be.rows.set(s.id, { ...be.rows.get(s.id)!, status: "accepted" });
    st.put({ ...st.get(s.id)!, body: "xy" });
    await st.flush();
    await st.flush();
    expect(st.get(s.id)?.status).toBe("accepted");
    expect(st.open()).toHaveLength(0);
  });

  it("the student's resolve survives echoes of the old open row", async () => {
    const be = new FakeBackend();
    const s = sugg({ body: "x", version: 1 });
    be.rows.set(s.id, s);
    const st = new SuggestionStore("p", be, new MemoryStorage(), "owner", { flushDelayMs: 0 });
    await st.start();
    st.resolve(s.id, "declined");
    st.applyRemote({ ...s }); // late echo of the open row
    expect(st.open()).toHaveLength(0);
    await st.flush();
    expect(be.rows.get(s.id)?.status).toBe("declined");
  });

  it("a reload whose answer predates my latest typing never drops it", async () => {
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "tab", { flushDelayMs: 0 });
    await st.start();
    // The server answers the reload with a snapshot taken now, delivered later.
    const snapshot = [...be.rows.values()];
    let release: () => void = () => {};
    be.list = () => new Promise((r) => (release = () => r(snapshot)));
    const reloading = st.reload();
    const s = sugg({ body: " " });
    st.put(s);
    await st.flush(); // saved and no longer pending
    release();
    await reloading;
    expect(st.get(s.id)?.body).toBe(" ");
    st.put({ ...st.get(s.id)!, body: " W" });
    await st.flush();
    expect(be.rows.get(s.id)?.body).toBe(" W");
    expect(be.rows.size).toBe(1);
  });

  it("someone else's new suggestion appears; their withdrawal removes it", async () => {
    const be = new FakeBackend();
    const st = new SuggestionStore("p", be, new MemoryStorage(), "owner", { flushDelayMs: 0 });
    await st.start();
    let events = 0;
    st.subscribe(() => events++);
    const s = sugg({ body: "from mom", version: 1 });
    st.applyRemote(s);
    expect(st.open().map((x) => x.body)).toEqual(["from mom"]);
    st.applyRemoteDelete(s.id);
    expect(st.open()).toHaveLength(0);
    expect(events).toBe(2);
  });
});
