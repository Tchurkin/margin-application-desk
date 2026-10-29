// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { essayStarterKit } from "./kit";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const links = (e: Editor) => {
  const found: string[] = [];
  e.state.doc.descendants((n) => {
    if (n.marks.some((m) => m.type.name === "link")) found.push(n.text ?? "");
  });
  return found;
};

describe("the essay editor's links", () => {
  it("never turns typed words into links (a stock kit does, which is how \"to.be\" became one)", () => {
    for (const [kit, expectLink] of [
      [StarterKit, true],
      [essayStarterKit(), false],
    ] as const) {
      editor = new Editor({ element: document.createElement("div"), extensions: [kit] });
      editor.commands.focus("end");
      for (const ch of "I am going to.be honest ") editor.commands.insertContent(ch);
      expect(editor.getText()).toContain("going to.be honest");
      expect(links(editor).length > 0, `stock kit: ${!expectLink ? "no " : ""}link`).toBe(expectLink);
      editor.destroy();
      editor = null;
    }
  });

  it("doesn't open a link already in an essay when it's clicked", () => {
    editor = new Editor({ element: document.createElement("div"), extensions: [essayStarterKit()] });
    const link = editor.extensionManager.extensions.find((e) => e.name === "link");
    expect(link?.options).toMatchObject({ autolink: false, linkOnPaste: false, openOnClick: false });
    // An old document with a link still loads.
    editor.commands.setContent('<p>See <a href="https://to.be">to.be</a> here.</p>');
    expect(editor.getText()).toBe("See to.be here.");
  });
});
