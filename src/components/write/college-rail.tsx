"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { labelOf, PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";
import { PREF } from "@/lib/write/layout";
import { countLabel, groupMeta, pickCollegePiece, SHARED, type RailGroup, type RailPiece } from "@/lib/write/rail";
import type { Waiting } from "@/lib/data/queries";
import { usePref, writePref } from "./hooks";
import { ChevronIcon, FilesIcon } from "./icons";

const DOT: Record<PieceStatus, string> = {
  not_started: "border border-muted bg-transparent",
  drafting: "bg-muted",
  needs_review: "bg-warn",
  final: "bg-accent",
  submitted: "bg-accent",
};

export function StatusDot({ status }: { status: PieceStatus }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />;
}

type Face = { user: string; name: string; color: string };

const nameOf = (name: string) => name.trim() || "Someone";

/** "Mom is here", "Mom and Dad are here", "Mom, Dad and Claude are here". */
export function hereLabel(people: Face[]): string {
  const names = people.map((p) => nameOf(p.name));
  const list = names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} ${names.length === 1 ? "is" : "are"} here`;
}

/** The people who have a piece open: a colored initial each (three at most, then a count). */
function Faces({ people }: { people: Face[] }) {
  if (!people.length) return null;
  return (
    <span aria-hidden title={hereLabel(people)} className="flex shrink-0 -space-x-1" data-testid="rail-faces">
      {people.slice(0, 3).map((p, i) => (
        <span
          key={i}
          className="grid size-4 place-items-center rounded-full text-[9px] leading-none font-semibold text-white ring-1 ring-panel"
          style={{ backgroundColor: p.color }}
        >
          {nameOf(p.name).charAt(0).toUpperCase()}
        </span>
      ))}
      {people.length > 3 && (
        <span className="grid size-4 place-items-center rounded-full bg-muted text-[8px] leading-none font-semibold text-white ring-1 ring-panel">
          +{people.length - 3}
        </span>
      )}
    </span>
  );
}

/** The piece this page opened with has had its college expanded (once, so it can be folded again). */
let expandedFor: string | null = null;

type Item = { kind: "group"; key: string; group: RailGroup } | { kind: "piece"; key: string; group: RailGroup; id: string };

/**
 * The Files tool: every college in the order it needs attention, each with its pieces. Clicking
 * a college opens its first unfinished piece; the caret (or the arrow keys) shows and hides its
 * pieces. Which colleges are expanded is remembered per browser. Independent pieces (not tied to
 * a college, like a personal statement) are listed on their own, not inside a folder.
 */
export function CollegeRail({
  groups,
  currentId,
  pieceHref,
  collegeHref,
  live,
  people,
  waiting,
}: {
  groups: RailGroup[];
  currentId: string;
  pieceHref: (id: string) => string;
  /** Where a college with no pieces yet opens (owners only). */
  collegeHref?: (id: string) => string;
  /** The open piece's count and status as the editor has them right now. */
  live: { count: string; status: PieceStatus; waiting?: Waiting | null };
  /** Everyone else working on the desk, by the piece they have open. */
  people?: Map<string, Face[]>;
  /** Suggestions and comments waiting on each piece, as the page loaded. */
  waiting?: Record<string, Waiting>;
}) {
  // The open piece's come from the editor, live; the others' from when the page loaded.
  const waitingOn = (id: string): Waiting => (id === currentId && live.waiting ? live.waiting : (waiting?.[id] ?? NONE));
  const router = useRouter();
  const stored = usePref(PREF.railOpen);
  const expanded = useMemo(() => {
    try {
      const v = JSON.parse(stored ?? "[]");
      return new Set<string>(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [stored]);
  const currentKey = groups.find((g) => g.pieces.some((p) => p.id === currentId))?.key ?? null;
  const [focusKey, setFocusKey] = useState<string>(currentId);
  const refs = useRef(new Map<string, HTMLElement>());

  const setOpen = (key: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    writePref(PREF.railOpen, JSON.stringify([...next]));
  };

  // Opening a piece shows it in the rail: its college expands, once.
  useEffect(() => {
    if (!currentKey || expandedFor === currentId) return;
    expandedFor = currentId;
    if (!expanded.has(currentKey)) setOpen(currentKey, true);
    // Only when the open piece changes; later folding is the student's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, currentKey]);

  const isOpen = (g: RailGroup) => g.total > 0 && expanded.has(g.key);

  const loose = (g: RailGroup) => g.key === SHARED;
  const items: Item[] = groups.flatMap((g) =>
    loose(g)
      ? g.pieces.map((p) => ({ kind: "piece" as const, key: p.id, group: g, id: p.id }))
      : [
          { kind: "group" as const, key: g.key, group: g },
          ...(isOpen(g) ? g.pieces.map((p) => ({ kind: "piece" as const, key: p.id, group: g, id: p.id })) : []),
        ],
  );
  const focusable = items.some((i) => i.key === focusKey) ? focusKey : (items[0]?.key ?? "");

  const openGroup = (g: RailGroup) => {
    const target = pickCollegePiece(g.pieces);
    if (!target) {
      if (g.college && collegeHref) router.push(collegeHref(g.college.id));
      return;
    }
    // Already on it: the click folds or unfolds instead.
    if (target.id === currentId) setOpen(g.key, !isOpen(g));
    else {
      // Unfold at once; the piece follows as soon as it has loaded.
      if (!isOpen(g)) setOpen(g.key, true);
      router.push(pieceHref(target.id));
    }
  };

  /** Start loading a piece the pointer is over, so clicking it opens it sooner. */
  const warm = (id: string | undefined) => {
    if (id && id !== currentId) router.prefetch(pieceHref(id));
  };

  const activate = (item: Item) => {
    if (item.kind === "group") openGroup(item.group);
    else router.push(pieceHref(item.id));
  };

  const focus = (key: string) => {
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = (document.activeElement as HTMLElement | null)?.dataset.railKey;
    const i = items.findIndex((x) => x.key === key);
    if (i < 0) return;
    const item = items[i];
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        handled();
        if (items[i + 1]) focus(items[i + 1].key);
        break;
      case "ArrowUp":
        handled();
        if (items[i - 1]) focus(items[i - 1].key);
        break;
      case "Home":
        handled();
        focus(items[0].key);
        break;
      case "End":
        handled();
        focus(items[items.length - 1].key);
        break;
      case "ArrowRight":
        handled();
        if (item.kind === "group" && item.group.total) {
          if (!isOpen(item.group)) setOpen(item.group.key, true);
          else if (items[i + 1]?.kind === "piece") focus(items[i + 1].key);
        }
        break;
      case "ArrowLeft":
        handled();
        if (item.kind === "piece") {
          if (!loose(item.group)) focus(item.group.key);
        }
        else if (isOpen(item.group)) setOpen(item.group.key, false);
        break;
      case "Enter":
      case " ":
        handled();
        activate(item);
        break;
    }
  };

  if (!groups.length) {
    return (
      <p className="px-3 py-4 text-sm text-muted">
        No colleges yet.{" "}
        {collegeHref && (
          <Link href="/desk/add/college" className="underline">
            Add one
          </Link>
        )}
      </p>
    );
  }

  /** One piece's row: inside its college (level 2), or on its own (level 1). */
  const pieceRow = (p: RailPiece, g: RailGroup, level: 1 | 2) => {
    const here = p.id === currentId;
    const status = here ? live.status : p.status;
    const count = here ? live.count : countLabel({ words: p.word_count, kind: p.limit_kind, limit: p.limit_value });
    const isVersion = !!p.variant_of && g.pieces.some((o) => o.id === p.variant_of);
    const indent = level === 1 ? (isVersion ? "pl-8" : "pl-3") : isVersion ? "pl-10" : "pl-7";
    const on = people?.get(p.id) ?? [];
    const w = waitingOn(p.id);
    return (
      <li
        key={p.id}
        role="treeitem"
        aria-level={level}
        aria-label={`${p.title}, ${labelOf(PIECE_STATUSES, status)}, ${count}${waitingLabel(w)}${on.length ? `, ${hereLabel(on)}` : ""}`}
        aria-current={here ? "page" : undefined}
        data-rail-key={p.id}
        tabIndex={focusable === p.id ? 0 : -1}
        ref={(el) => {
          if (el) refs.current.set(p.id, el);
          else refs.current.delete(p.id);
        }}
        onFocus={(e) => {
          e.stopPropagation();
          setFocusKey(p.id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!here) router.push(pieceHref(p.id));
        }}
        onMouseEnter={() => warm(p.id)}
        title={p.title}
        className={`flex cursor-pointer items-center gap-2 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${indent} ${
          level === 1 ? `rounded-md border py-2 ${here ? "border-accent/60" : "border-transparent"}` : "py-1"
        } ${here ? "bg-accent-soft text-ink" : "text-ink/85 hover:bg-bg"}`}
      >
        <StatusDot status={status} />
        <span className={`min-w-0 flex-1 truncate ${level === 1 ? "font-medium" : ""}`}>{p.title}</span>
        <WaitingBadges w={w} />
        <Faces people={on} />
        <span className="shrink-0 font-mono text-xs text-muted">{count}</span>
      </li>
    );
  };

  return (
    <ul role="tree" aria-label="Colleges and pieces" className="flex flex-col gap-1.5 p-2 text-sm" onKeyDown={onKeyDown}>
      {groups.map((g) => {
        if (loose(g)) return g.pieces.map((p) => pieceRow(p, g, 1));
        const open = isOpen(g);
        const current = g.key === currentKey;
        const meta = groupMeta(g);
        // Folded, a college shows what's waiting on all its pieces.
        const folded = !open ? g.pieces.map((p) => waitingOn(p.id)).reduce((a, b) => ({ suggestions: a.suggestions + b.suggestions, comments: a.comments + b.comments }), NONE) : NONE;
        // Folded, a college shows everyone on its pieces, each person once.
        const inside = open ? [] : [...new Map(g.pieces.flatMap((p) => people?.get(p.id) ?? []).map((f) => [f.user, f] as const)).values()];
        return (
          <li
            key={g.key}
            role="treeitem"
            aria-level={1}
            aria-label={`${g.name}, ${meta}${waitingLabel(folded)}${inside.length ? `, ${hereLabel(inside)}` : ""}`}
            aria-expanded={g.total ? open : undefined}
            data-rail-key={g.key}
            tabIndex={focusable === g.key ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(g.key, el);
              else refs.current.delete(g.key);
            }}
            onFocus={(e) => e.target === e.currentTarget && setFocusKey(g.key)}
            className={`group/college overflow-hidden rounded-md border outline-none ${current ? "border-accent/60" : "border-line"}`}
          >
            <div
              className={`flex cursor-pointer items-start gap-1.5 bg-bg py-2 pr-3 pl-1.5 hover:bg-line/60 group-focus-visible/college:ring-2 group-focus-visible/college:ring-accent group-focus-visible/college:ring-inset ${
                g.finished ? "opacity-60" : ""
              }`}
              onClick={() => openGroup(g)}
              onMouseEnter={() => warm(pickCollegePiece(g.pieces)?.id)}
              title={g.total ? "Open the first piece still being worked on" : undefined}
            >
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-muted transition-transform hover:bg-line ${
                  open ? "rotate-90" : ""
                } ${g.total ? "" : "invisible"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(g.key, !open);
                }}
              >
                <ChevronIcon />
              </span>
              <span aria-hidden className="mt-0.5 shrink-0 text-muted [&_svg]:size-4">
                <FilesIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{g.name}</span>
                  <WaitingBadges w={folded} />
                  <Faces people={inside} />
                </span>
                <span className="block truncate text-xs text-muted">{meta}</span>
                {g.total > 0 && (
                  <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(g.done / g.total) * 100}%` }} />
                  </span>
                )}
              </span>
            </div>
            {open && (
              <ul role="group" className="border-t border-line bg-panel py-1">
                {g.pieces.map((p) => pieceRow(p, g, 2))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const NONE: Waiting = { suggestions: 0, comments: 0 };

/** ", 2 suggestions, 1 comment" for a screen reader, or nothing. */
function waitingLabel(w: Waiting): string {
  const parts = [
    w.suggestions ? `${w.suggestions} suggestion${w.suggestions === 1 ? "" : "s"}` : "",
    w.comments ? `${w.comments} comment${w.comments === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? `, ${parts.join(", ")} waiting` : "";
}

/** Small counts beside a piece (or a folded college): suggestions in green, comments in amber. */
function WaitingBadges({ w }: { w: Waiting }) {
  if (!w.suggestions && !w.comments) return null;
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1" data-testid="rail-waiting">
      {w.suggestions > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-add-soft px-1.5 text-[11px] leading-4 font-semibold text-add"
          title={`${w.suggestions} suggestion${w.suggestions === 1 ? "" : "s"} waiting`}
          data-testid="rail-suggestions"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13l1-3.5L10.5 3l2.5 2.5L6.5 12z" />
          </svg>
          {w.suggestions}
        </span>
      )}
      {w.comments > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full bg-warn-soft px-1.5 text-[11px] leading-4 font-semibold text-warn"
          title={`${w.comments} comment${w.comments === 1 ? "" : "s"} waiting`}
          data-testid="rail-comments"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          </svg>
          {w.comments}
        </span>
      )}
    </span>
  );
}
