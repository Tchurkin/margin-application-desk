// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HeldSelection } from "@/lib/editor/held-selection";
import { Rewrites } from "@/lib/editor/rewrites";
import { UndoCaret } from "@/lib/editor/undo-caret";
import { anchorEdit, flatten } from "./anchor-text";
import { acceptInto, suggestPlugin, suggestText, type SuggestMode } from "./plugin";
import { SuggestionStore, type Suggestion, type SuggestionBackend } from "./store";

/*
 * Accepting in the editor as the app builds it: the suggestion plugin and its store, with the
 * other plugins the essay has, in Editing and in Suggesting mode. The text must change.
 */

const backend: SuggestionBackend = { list: async () => [], put: async () => "ok", remove: async () => "ok", resolve: async () => "ok" };

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function essayDoc(...paragraphs: string[]) {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment("default");
  frag.insert(
    0,
    paragraphs.map((p) => {
      const el = new Y.XmlElement("paragraph");
      el.insert(0, [new Y.XmlText(p)]);
      return el;
    }),
  );
  return ydoc;
}

function open(ydoc: Y.Doc, mode: SuggestMode, me = { id: "student", name: "Testy" }) {
  const store = new SuggestionStore("p1", backend, null, `c-${editors.length}`, { flushDelayMs: 60_000 });
  const opts = { store, mode, me, pieceId: "p1" };
  const ed = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      UndoCaret,
      HeldSelection,
      Rewrites("p1"),
      Extension.create({ name: "suggestions", addProseMirrorPlugins: () => [suggestPlugin(opts)] }),
    ],
  });
  editors.push(ed);
  return { ed, store, opts };
}

/** An AI suggestion, anchored on the document the way the connector does it. */
function fromAI(ydoc: Y.Doc, find: string, change: { replace_with?: string; insert_after?: string }): Suggestion {
  const r = anchorEdit(flatten(ydoc), { find, ...change, reason: "" });
  if (!r.ok) throw new Error(r.reason);
  return {
    id: crypto.randomUUID(),
    piece_id: "p1",
    author_id: "student",
    author_name: "Claude",
    source: "ai",
    ...r.row,
    status: "open",
    version: 1,
    created_at: new Date().toISOString(),
  };
}

/** Accept the way the margin's button does: apply it, then mark it accepted. */
function accept(ed: Editor, store: SuggestionStore, s: Suggestion) {
  const ok = acceptInto(ed.view, s);
  if (ok) store.resolve(s.id, "accepted");
  return ok;
}

describe.each(["owner", "suggest"] as const)("accepting in %s mode", (mode) => {
  it("an AI replacement, deletion and insertion across paragraphs all change the text", () => {
    const ydoc = essayDoc("The cat sat on the mat.", "It was a quiet afternoon.", "Nothing happened.");
    const { ed, store } = open(ydoc, mode);
    const rows = [
      fromAI(ydoc, "cat", { replace_with: "dog" }),
      fromAI(ydoc, " quiet", { replace_with: "" }),
      fromAI(ydoc, "Nothing happened.", { insert_after: " Then the phone rang." }),
    ];
    rows.forEach((r) => store.applyRemote(r));
    for (const r of rows) expect(accept(ed, store, store.get(r.id)!)).toBe(true);
    expect(ed.getText({ blockSeparator: "\n" })).toBe("The dog sat on the mat.\nIt was a afternoon.\nNothing happened. Then the phone rang.");
    expect(ydoc.getXmlFragment("default").toString()).toContain("dog");
  });

  it("a parent's suggestion, made in their own editor on the same document, changes the text", () => {
    const ydoc = essayDoc("The cat sat.");
    const parentDoc = new Y.Doc();
    Y.applyUpdate(parentDoc, Y.encodeStateAsUpdate(ydoc));
    const parent = open(parentDoc, "suggest", { id: "mom", name: "Mom" });
    const end = parent.ed.state.doc.content.size - 1;
    suggestText(parent.ed.view, parent.opts, end, end, " Quietly.");
    const row = parent.store.open()[0];

    const { ed, store } = open(ydoc, mode);
    store.applyRemote(row);
    expect(accept(ed, store, store.get(row.id)!)).toBe(true);
    expect(ed.getText()).toBe("The cat sat. Quietly.");
  });

  it("words typed at the start of a paragraph go in, after another suggestion before them is accepted", () => {
    const ydoc = essayDoc("First paragraph here.", "Second paragraph here.", "Third one.");
    const parentDoc = new Y.Doc();
    Y.applyUpdate(parentDoc, Y.encodeStateAsUpdate(ydoc));
    const dad = open(parentDoc, "suggest", { id: "dad", name: "Dad" });
    const startOf2 = 1 + "First paragraph here.".length + 2;
    suggestText(dad.ed.view, dad.opts, startOf2, startOf2, "Also, ");
    const endOf1 = 1 + "First paragraph here.".length;
    suggestText(dad.ed.view, dad.opts, endOf1, endOf1, "\nA new one.");
    const [also, newOne] = ["Also, ", "\nA new one."].map((b) => dad.store.open().find((x) => x.body === b)!);

    const { ed, store } = open(ydoc, mode);
    store.applyRemote(also);
    store.applyRemote(newOne);
    expect(accept(ed, store, store.get(newOne.id)!)).toBe(true);
    const before = ed.getText({ blockSeparator: "\n" });
    expect(accept(ed, store, store.get(also.id)!)).toBe(true);
    expect(ed.getText({ blockSeparator: "\n" })).not.toBe(before);
    expect(ed.getText({ blockSeparator: "\n" })).toBe("First paragraph here.\nA new one.\nAlso, Second paragraph here.\nThird one.");
  });

  it("dense suggestions: accepting one leaves the ones touching it acceptable", () => {
    const ydoc = essayDoc("The cat sat on the mat.");
    const { ed, store } = open(ydoc, mode);
    const rows = [
      fromAI(ydoc, "The cat", { replace_with: "A cat" }),
      fromAI(ydoc, "The cat", { insert_after: ", quietly," }),
      fromAI(ydoc, "sat on", { replace_with: "sat upon" }),
    ];
    rows.forEach((r) => store.applyRemote(r));
    for (const r of rows) expect(accept(ed, store, store.get(r.id)!), r.body).toBe(true);
    expect(ed.getText()).toBe("A cat, quietly, sat upon the mat.");
  });

  it("dense suggestions: a word replaced outright keeps the one right after it", () => {
    const ydoc = essayDoc("The cat sat on the mat.");
    const { ed, store } = open(ydoc, mode);
    const rows = [fromAI(ydoc, "cat", { replace_with: "dog" }), fromAI(ydoc, "The cat", { insert_after: ", quietly," })];
    rows.forEach((r) => store.applyRemote(r));
    for (const r of rows) expect(accept(ed, store, store.get(r.id)!), r.body).toBe(true);
    expect(ed.getText()).toBe("The dog, quietly, sat on the mat.");
  });

  it("two additions at the same spot come out in their order, whichever is accepted first", () => {
    for (const order of [[0, 1], [1, 0]]) {
      const ydoc = essayDoc("The cat sat.");
      const { ed, store } = open(ydoc, mode);
      const rows = [fromAI(ydoc, "cat", { insert_after: ", quietly," }), fromAI(ydoc, "cat", { insert_after: " (Mo)" })];
      rows[0].created_at = "2026-10-01T00:00:00.000Z";
      rows[1].created_at = "2026-10-01T00:00:01.000Z";
      rows.forEach((r) => store.applyRemote(r));
      for (const i of order) expect(accept(ed, store, store.get(rows[i].id)!)).toBe(true);
      expect(ed.getText(), `accepted ${order.join(" then ")}`).toBe("The cat, quietly, (Mo) sat.");
      ed.destroy();
    }
  });

  it("dense suggestions, accepted from the last to the first", () => {
    const ydoc = essayDoc("The cat sat on the mat.");
    const { ed, store } = open(ydoc, mode);
    const rows = [
      fromAI(ydoc, "The cat", { replace_with: "A cat" }),
      fromAI(ydoc, "The cat", { insert_after: ", quietly," }),
      fromAI(ydoc, "sat on", { replace_with: "sat upon" }),
    ];
    rows.forEach((r) => store.applyRemote(r));
    for (const r of [...rows].reverse()) expect(accept(ed, store, store.get(r.id)!), r.body).toBe(true);
    expect(ed.getText()).toBe("A cat, quietly, sat upon the mat.");
  });

  it("after the student has typed elsewhere since it was suggested", () => {
    const ydoc = essayDoc("The cat sat.", "Second line.");
    const row = fromAI(ydoc, "Second", { replace_with: "Next" });
    const { ed, store } = open(ydoc, "owner");
    ed.commands.insertContentAt(1, "Yes. ");
    ed.destroy();
    const again = open(ydoc, mode);
    again.store.applyRemote(row);
    expect(accept(again.ed, again.store, again.store.get(row.id)!)).toBe(true);
    expect(again.ed.getText({ blockSeparator: "\n" })).toBe("Yes. The cat sat.\nNext line.");
    void store;
  });
});
