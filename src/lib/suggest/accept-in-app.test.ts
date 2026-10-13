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
