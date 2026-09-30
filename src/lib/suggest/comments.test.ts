// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { acceptInto, commentOn, resolveSuggestion } from "./plugin";

/*
 * A comment covers the words it was made on, stays on them as the text changes around them, and
 * never changes the text.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function typed(text: string) {
  const ydoc = new Y.Doc();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: ydoc, field: "default" })],
  });
  editor.commands.focus("end");
  for (const ch of text) editor.commands.insertContent(ch);
  return editor;
}

const who = { id: "u1", name: "Mom Testy" };
const words = (ed: Editor, s: NonNullable<ReturnType<typeof commentOn>>) => {
  const r = resolveSuggestion(ed.state, s);
  return r.from !== null && r.to !== null ? ed.state.doc.textBetween(r.from, r.to) : null;
};

describe("comments", () => {
  it("cover the highlighted words, and keep them when text is added before", () => {
    const ed = typed("The robot arm finally moved.");
    const c = commentOn(ed.state, 5, 14, who, "p1")!;
    expect(c).toMatchObject({ kind: "comment", quote: "robot arm", author_name: "Mom Testy", status: "open", body: "" });
    expect(words(ed, c)).toBe("robot arm");
    ed.commands.insertContentAt(1, "At last, ");
    expect(words(ed, c)).toBe("robot arm");
  });

  it("need words: an empty or blank highlight makes none", () => {
    const ed = typed("One two.");
    expect(commentOn(ed.state, 3, 3, who, "p1")).toBeNull();
    expect(commentOn(ed.state, 4, 5, who, "p1")).toBeNull();
  });

  it("are never applied to the text", () => {
    const ed = typed("Keep this.");
    const c = { ...commentOn(ed.state, 1, 5, who, "p1")!, body: "Delete this?" };
    expect(acceptInto(ed.view, c)).toBe(false);
    expect(ed.getText()).toBe("Keep this.");
  });
});
