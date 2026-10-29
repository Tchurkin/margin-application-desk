import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

/**
 * The essay editor's building blocks, shared by the browser editor and the server (which edits
 * documents for the Claude/ChatGPT connector). Both must build the same schema, or a document
 * written on one side won't read back on the other.
 */
export const ESSAY_KIT = {
  undoRedo: false,
  heading: false,
  codeBlock: false,
  code: false,
  horizontalRule: false,
  // Essays have no links. The kind stays in the schema (a document that has one still loads), but
  // nothing typed or pasted becomes one, and clicking one does nothing: "going to.be" was turning
  // into a link to the site to.be, and a click in the essay opened it.
  link: { autolink: false, linkOnPaste: false, openOnClick: false },
} as const;

export const essayStarterKit = () => StarterKit.configure(ESSAY_KIT);

let schema: ReturnType<typeof getSchema> | null = null;
export function essaySchema() {
  return (schema ??= getSchema([essayStarterKit()]));
}
