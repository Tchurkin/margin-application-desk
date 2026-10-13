// @vitest-environment jsdom
import { Editor, Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { editOwn, startEditing, suggestKey, suggestPlugin, suggestText, type SuggestOptions } from "./plugin";
import { SuggestionStore, type SuggestionBackend } from "./store";

/*
 * Someone suggesting changes their own suggested text in place: the caret goes inside it, and
 * typing, Backspace, Delete and the arrows act there. The essay itself never changes.
 */

const backend: SuggestionBackend = {
  list: async () => [],
  put: async () => "ok",
  remove: async () => "ok",
  resolve: async () => "ok",
};

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function suggesting(text: string) {
  const store = new SuggestionStore("p1", backend, null, "c1", { flushDelayMs: 60_000 });
  const opts: SuggestOptions = { store, mode: "suggest", me: { id: "u1", name: "Mom" }, pieceId: "p1" };
  const ydoc = new Y.Doc();
  ydoc.getXmlFragment("default").insert(0, [Object.assign(new Y.XmlElement("paragraph"), {})]);
  (ydoc.getXmlFragment("default").get(0) as Y.XmlElement).insert(0, [new Y.XmlText(text)]);
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc, field: "default" }),
      Extension.create({ name: "suggestions", addProseMirrorPlugins: () => [suggestPlugin(opts)] }),
    ],
  });
  return { ed: editor, view: editor.view, store, opts };
}

const mine = (store: SuggestionStore) => store.open()[0];
const caret = (ed: Editor) => suggestKey.getState(ed.state)?.editing ?? null;

describe("changing your own suggestion", () => {
  it("removes something in the middle, and adds something in the middle", () => {
    const { ed, view, store, opts } = suggesting("The cat sat.");
    const end = ed.state.doc.content.size - 1;
    suggestText(view, opts, end, end, " It was quiet then.");
    expect(mine(store).body).toBe(" It was quiet then.");

    // The caret goes in after "quiet", Backspace takes out " quiet"; then "very " goes in.
    expect(startEditing(view, opts, mine(store).id, " It was quiet".length)).toBe(true);
    for (let i = 0; i < " quiet".length; i++) editOwn(view, opts, { type: "backspace" });
    expect(mine(store).body).toBe(" It was then.");
    editOwn(view, opts, { type: "text", text: " still" });
    expect(mine(store).body).toBe(" It was still then.");
    expect(caret(ed)?.offset).toBe(" It was still".length);

    // Delete takes out what's after the caret.
    editOwn(view, opts, { type: "move", by: 1 });
    for (let i = 0; i < "then".length; i++) editOwn(view, opts, { type: "delete" });
    expect(mine(store).body).toBe(" It was still .");
    expect(ed.getText()).toBe("The cat sat.");
  });

  it("goes back to the essay off either end, and Home/End jump within it", () => {
    const { ed, view, store, opts } = suggesting("One.");
    suggestText(view, opts, 1, 1, "Ab");
    startEditing(view, opts, mine(store).id, 1);
    editOwn(view, opts, { type: "to", at: "end" });
    expect(caret(ed)?.offset).toBe(2);
    editOwn(view, opts, { type: "move", by: 1 });
    expect(caret(ed)).toBeNull();
    startEditing(view, opts, mine(store).id, 1);
    editOwn(view, opts, { type: "to", at: "start" });
    editOwn(view, opts, { type: "move", by: -1 });
    expect(caret(ed)).toBeNull();
  });

  it("emptied, an insertion is withdrawn and a replacement becomes a deletion", () => {
    const { view, store, opts } = suggesting("The cat sat.");
    suggestText(view, opts, 5, 8, "dog");
    expect(mine(store)).toMatchObject({ kind: "replace", quote: "cat", body: "dog" });
    startEditing(view, opts, mine(store).id, 3);
    for (let i = 0; i < 3; i++) editOwn(view, opts, { type: "backspace" });
    expect(mine(store)).toMatchObject({ kind: "delete", quote: "cat", body: "" });

    suggestText(view, opts, 1, 1, "Hi");
    const ins = store.open().find((s) => s.kind === "insert")!;
    startEditing(view, opts, ins.id, 2);
    editOwn(view, opts, { type: "backspace" });
    editOwn(view, opts, { type: "backspace" });
    expect(store.open().some((s) => s.kind === "insert")).toBe(false);
  });

  it("only your own", () => {
    const { view, store, opts } = suggesting("One.");
    suggestText(view, opts, 1, 1, "Ab");
    const theirs = { ...opts, me: { id: "u2", name: "Dad" } };
    expect(startEditing(view, theirs, mine(store).id, 1)).toBe(false);
  });
});
