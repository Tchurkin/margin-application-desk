"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { addPiece } from "@/app/desk/actions";
import { countLabel, tabLabel, type RailPiece } from "@/lib/write/rail";
import { useKeptScroll } from "./hooks";
import { CloseIcon, PlusIcon } from "./icons";

/** The drag type a piece tab carries, for "open beside". */
export const PIECE_DRAG = "application/x-desk-piece";

/**
 * One tab per piece of the open college, versions included, each with its count. Owners get a
 * ✕ on each tab (asks first) and a + to add a piece. Tabs can be dragged onto the writing area
 * to open that piece beside it.
 */
export function PieceTabs({
  college,
  collegeId,
  pieces,
  currentId,
  currentCount,
  besideId,
  pieceHref,
  owner,
  onDelete,
}: {
  college: string;
  collegeId: string | null;
  pieces: RailPiece[];
  currentId: string;
  currentCount: string;
  besideId: string | null;
  pieceHref: (id: string) => string;
  owner: boolean;
  onDelete: (piece: RailPiece) => void;
}) {
  // Opening another of this college's pieces loads a new page: the tabs keep their place.
  const strip = useRef<HTMLDivElement>(null);
  useKeptScroll(strip, `desk:tabs-scroll:${collegeId ?? "independent"}`, "x", "[aria-selected='true']");
  return (
    <div className="flex items-end gap-1 border-b border-line">
      <div ref={strip} role="tablist" aria-label="Pieces" className="-mb-px flex min-w-0 overflow-x-auto">
        {pieces.map((p) => {
          const selected = p.id === currentId;
          const count = selected ? currentCount : countLabel({ words: p.word_count, kind: p.limit_kind, limit: p.limit_value });
          return (
            <div key={p.id} role="presentation" className="group relative flex shrink-0 items-center">
              <Link
                role="tab"
                aria-selected={selected}
                href={pieceHref(p.id)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PIECE_DRAG, p.id);
                  e.dataTransfer.setData("text/plain", p.title);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onKeyDown={(e) => {
                  if (owner && e.key === "Delete") {
                    e.preventDefault();
                    onDelete(p);
                  }
                }}
                title={`${p.title} · ${college}`}
                className={`flex max-w-64 items-center gap-2 rounded-t-md border px-3 py-1.5 text-sm ${owner ? "pr-7" : ""} ${
                  selected ? "border-line border-b-bg bg-bg font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                } ${p.id === besideId ? "shadow-[inset_0_-2px_0_var(--accent)]" : ""}`}
              >
                <span className="truncate">{tabLabel(p.title)}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{count}</span>
              </Link>
              {owner && (
                <button
                  type="button"
                  aria-label={`Delete “${p.title}”`}
                  title="Delete this piece"
                  onClick={() => onDelete(p)}
                  className={`absolute right-1.5 rounded p-0.5 text-muted hover:bg-danger-soft hover:text-danger focus:opacity-100 ${
                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {owner && <AddPiece college={college} collegeId={collegeId} />}
    </div>
  );
}

/** "+": a small form for a new piece in this college (or a new independent piece). */
function AddPiece({ college, collegeId }: { college: string; collegeId: string | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector("input")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="relative mb-1 shrink-0">
      <button
        ref={button}
        type="button"
        aria-label={`Add a piece to ${college}`}
        title="Add a piece"
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => setOpen(!open)}
        className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink"
      >
        <PlusIcon />
      </button>
      {open && (
        <div
          ref={box}
          id={`${id}-form`}
          className="card absolute right-0 z-30 mt-1 w-72 p-3 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          <form action={addPiece.bind(null, collegeId)} className="flex flex-col gap-2">
            <div>
              <label className="label" htmlFor={`${id}-title`}>Title of the new piece</label>
              <input className="field" id={`${id}-title`} name="title" required placeholder="e.g. Why this college?" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor={`${id}-limit`}>Its limit</label>
                <input className="field" id={`${id}-limit`} name="limit_value" type="number" min={1} placeholder="250" />
              </div>
              <div>
                <label className="label" htmlFor={`${id}-kind`}>Unit</label>
                <select className="field" id={`${id}-kind`} name="limit_kind" defaultValue="words">
                  <option value="words">Words</option>
                  <option value="chars">Characters</option>
                  <option value="none">No limit</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" type="submit">Add this piece</button>
          </form>
        </div>
      )}
    </div>
  );
}
