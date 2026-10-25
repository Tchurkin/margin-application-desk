/*
 * Anchoring suggestions from plain text, with no editor in the loop.
 *
 * Claude and ChatGPT see a piece as plain text and propose edits by quoting the words to
 * change. This finds those words in the piece's Yjs document and turns them into the same
 * relative positions the editor uses, so a suggestion made through a connector is drawn,
 * tracked and accepted exactly like one typed by a parent.
 */

import * as Y from "yjs";
import { fromBase64, toBase64 } from "@/lib/sync/base64";
import { findText } from "./loose";

/**
 * One run of the document: a Y.XmlText and where its characters sit in `text`, or an empty
 * textblock (len 0) so a position inside a blank line can be anchored too.
 */
interface Segment {
  t: Y.XmlText | Y.XmlElement;
  start: number;
  len: number;
}

export interface FlatDoc {
  /** The document's text: textblocks separated by "\n", hard breaks as "\n". */
  text: string;
  segments: Segment[];
}

/** Nodes that hold a line of text (the rest, like lists and quotes, only hold other nodes). */
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

export function docFromRows(state: string, updates: string[]): Y.Doc {
  const doc = new Y.Doc();
  Y.transact(doc, () => {
    if (state) Y.applyUpdate(doc, fromBase64(state));
    for (const u of updates) Y.applyUpdate(doc, fromBase64(u));
  });
  return doc;
}

/** The text of a TipTap document stored in Yjs (field "default"), as the editor shows it. */
export function flatten(doc: Y.Doc, field = "default"): FlatDoc {
  const segments: Segment[] = [];
  let text = "";
  let blocks = 0;

  const visit = (el: Y.XmlElement | Y.XmlFragment) => {
    const isBlock = el instanceof Y.XmlElement && (TEXTBLOCKS.has(el.nodeName) || el.toArray().some((k) => k instanceof Y.XmlText));
    if (!isBlock) {
      for (const k of el.toArray()) if (k instanceof Y.XmlElement) visit(k);
      return;
    }
    if (blocks++ > 0) text += "\n";
    let hadText = false;
    for (const k of el.toArray()) {
      if (k instanceof Y.XmlText) {
        const s = plain(k);
        segments.push({ t: k, start: text.length, len: s.length });
        text += s;
        hadText = true;
      } else if (k instanceof Y.XmlElement && k.nodeName === "hardBreak") {
        text += "\n";
      }
    }
    if (!hadText) segments.push({ t: el as Y.XmlElement, start: text.length, len: 0 });
  };
  visit(doc.getXmlFragment(field));
  return { text, segments };
}

/** Text of an XmlText without the formatting markup toString() adds. */
function plain(t: Y.XmlText): string {
  return t
    .toDelta()
    .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

/** Paragraph breaks as the essay editor makes them: one or more newlines end a paragraph. */
export function normalizeBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n");
}

export type FindResult = { ok: true; start: number; end: number } | { ok: false; reason: string };

/**
 * Where `quote` occurs in the document: exactly, or allowing for curly quotes, extra spaces
 * and blank lines. It must occur exactly once.
 */
export function findQuote(flat: FlatDoc, quote: string): FindResult {
  if (!quote) return { ok: false, reason: "The quoted text is empty." };
  const f = findText(flat.text, quote);
  if ("start" in f) return { ok: true, start: f.start, end: f.end };
  if (f.error === "ambiguous") {
    return { ok: false, reason: `"${quote}" appears ${f.count} times. Quote a few more words so it is unique.` };
  }
  return { ok: false, reason: `"${quote}" isn't in the piece. Quote the text exactly as it is now.` };
}

/**
 * A relative position at text offset `off`. assoc 0 sticks to the character after the
 * offset (a range's start); assoc -1 sticks to the character before it (a range's end or an
 * insertion point). Inside a blank line, it sticks to that line.
 */
export function anchorAtOffset(flat: FlatDoc, off: number, assoc: -1 | 0): string {
  const { segments } = flat;
  if (!segments.length) throw new Error("The piece is empty.");
  const blank = segments.find((s) => s.len === 0 && s.start === off);
  let seg: Segment | undefined;
  if (assoc === 0) {
    seg = segments.find((s) => s.len > 0 && off >= s.start && off < s.start + s.len) ?? blank;
    // At a paragraph break or the very end: stick to the end of the run before it.
    seg ??= [...segments].reverse().find((s) => s.start + s.len <= off) ?? segments[0];
  } else {
    seg = segments.find((s) => s.len > 0 && off > s.start && off <= s.start + s.len) ?? blank;
    // Right after a paragraph break: the start of the run that follows it.
    seg ??= segments.find((s) => s.start >= off) ?? segments[segments.length - 1];
  }
  const index = seg.t instanceof Y.XmlText ? Math.max(0, Math.min(seg.len, off - seg.start)) : 0;
  return toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(seg.t, index, assoc)));
}

export interface Edit {
  find: string;
  replace_with?: string;
  insert_after?: string;
  reason: string;
}

export interface AnchoredRow {
  kind: "insert" | "delete" | "replace" | "comment";
  anchor_from: string;
  anchor_to: string | null;
  quote: string;
  body: string;
  note: string;
  /** For an insertion: the text just before it, to find the spot again if the anchor comes loose. */
  context: string;
}

export type EditOutcome = { ok: true; row: AnchoredRow } | { ok: false; reason: string };

/** A comment on quoted words, anchored to them as a replacement would be: its text is its body. */
export function anchorComment(flat: FlatDoc, find: string, comment: string): EditOutcome {
  const f = findQuote(flat, find);
  if (!f.ok) return f;
  if (!comment.trim()) return { ok: false, reason: "The comment is empty." };
  return {
    ok: true,
    row: {
      kind: "comment",
      anchor_from: anchorAtOffset(flat, f.start, 0),
      anchor_to: anchorAtOffset(flat, f.end, -1),
      quote: flat.text.slice(f.start, f.end),
      body: comment.trim(),
      note: "",
      context: "",
    },
  };
}

/** How much of the text before an insertion point to keep as its context. */
export const CONTEXT_CHARS = 120;

/** Turn a proposed edit into an anchored suggestion row, or explain why it can't be. */
export function anchorEdit(flat: FlatDoc, e: Edit): EditOutcome {
  const f = findQuote(flat, e.find);
  if (!f.ok) return f;
  const quote = flat.text.slice(f.start, f.end);
  if (e.insert_after !== undefined && e.replace_with !== undefined) {
    return { ok: false, reason: "Use either replace_with or insert_after, not both." };
  }
  if (e.insert_after !== undefined) {
    if (!e.insert_after) return { ok: false, reason: "insert_after is empty." };
    return {
      ok: true,
      row: {
        kind: "insert",
        anchor_from: anchorAtOffset(flat, f.end, -1),
        anchor_to: null,
        quote: "",
        body: normalizeBreaks(e.insert_after),
        note: e.reason,
        context: flat.text.slice(Math.max(0, f.end - CONTEXT_CHARS), f.end),
      },
    };
  }
  const body = normalizeBreaks(e.replace_with ?? "");
  if (body === quote) return { ok: false, reason: "The replacement is the same as the original." };
  return {
    ok: true,
    row: {
      kind: body ? "replace" : "delete",
      anchor_from: anchorAtOffset(flat, f.start, 0),
      anchor_to: anchorAtOffset(flat, f.end, -1),
      quote,
      body,
      note: e.reason,
      context: "",
    },
  };
}
