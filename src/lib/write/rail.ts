/*
 * The Write workspace's map of the desk: colleges in the order they need attention, each with
 * its pieces, plus the small labels the rail, tabs and quick switcher share.
 */

import { collegeSubmitted, type PieceStatus } from "@/lib/domain/colleges";

export interface RailCollege {
  id: string;
  name: string;
  deadline: string | null;
  /** When its application was submitted (migration 20261007). */
  submitted_at?: string | null;
}

export interface RailPiece {
  id: string;
  college_id: string | null;
  title: string;
  status: PieceStatus;
  word_count: number;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  /** Its own due date, if it has one (migration 20260928). */
  due?: string | null;
  /** The piece this is a version of (migration 20260928). */
  variant_of?: string | null;
  /** The counselor's rating (migration 20261025). */
  rating?: number | null;
  rating_stale?: boolean;
  rating_ai?: string;
}

export interface RailGroup {
  /** The college's id, or SHARED for the independent pieces (not tied to a college). */
  key: string;
  college: RailCollege | null;
  name: string;
  /** In desk order, each piece's versions right after it. */
  pieces: RailPiece[];
  /** Pieces that are final or submitted. */
  done: number;
  total: number;
  /** The date that decides its place: the soonest due date of the work still left. */
  due: string | null;
  /** Every piece submitted (and there is at least one). These sink to the bottom. */
  finished: boolean;
}

export const SHARED = "shared";
export const SHARED_NAME = "Independent pieces";

export function isDone(status: PieceStatus): boolean {
  return status === "final" || status === "submitted";
}

/** Versions right after the piece they are a version of; everything else keeps its order. */
export function withVersionsAfter<T extends { id: string; variant_of?: string | null }>(pieces: T[]): T[] {
  const ids = new Set(pieces.map((p) => p.id));
  const isRoot = (p: T) => !p.variant_of || !ids.has(p.variant_of);
  const out: T[] = [];
  const placed = new Set<string>();
  for (const p of pieces) {
    if (!isRoot(p) || placed.has(p.id)) continue;
    out.push(p);
    placed.add(p.id);
    for (const v of pieces) {
      if (v.variant_of === p.id && !placed.has(v.id)) {
        out.push(v);
        placed.add(v.id);
      }
    }
  }
  // A version of a version (not made here, but possible through the database) goes last.
  for (const p of pieces) if (!placed.has(p.id)) out.push(p);
  return out;
}

/** When a group is due: the soonest date among its unfinished pieces (all pieces if none are left). */
function groupDue(pieces: RailPiece[], fallback: string | null, today: string): string | null {
  const left = pieces.filter((p) => !isDone(p.status));
  const dates = (left.length ? left : pieces).map((p) => p.due ?? fallback).filter((d): d is string => !!d);
  if (!pieces.length && fallback) dates.push(fallback);
  if (!dates.length) return null;
  const upcoming = dates.filter((d) => d >= today).sort();
  return upcoming[0] ?? dates.sort()[0];
}

/** 0: something due today or later; 1: only passed dates; 2: no date at all. */
function bucket(due: string | null, today: string): number {
  if (!due) return 2;
  return due >= today ? 0 : 1;
}

/**
 * Colleges in the order they need attention: unfinished before fully submitted; upcoming
 * deadlines, then passed ones, then undated; soonest first; then by name. Independent pieces
 * (like a personal statement) come first, because every college reads them, unless they are all
 * submitted. The rail shows them as pieces of their own, not as a folder.
 */
export function railOrder(colleges: RailCollege[], pieces: RailPiece[], today: string): RailGroup[] {
  const byCollege = new Map<string, RailPiece[]>();
  const shared: RailPiece[] = [];
  for (const p of pieces) {
    if (!p.college_id) shared.push(p);
    else byCollege.set(p.college_id, [...(byCollege.get(p.college_id) ?? []), p]);
  }
  const group = (key: string, college: RailCollege | null, name: string, list: RailPiece[]): RailGroup => {
    const done = list.filter((p) => isDone(p.status)).length;
    return {
      key,
      college,
      name,
      pieces: withVersionsAfter(list),
      done,
      total: list.length,
      due: groupDue(list, college?.deadline ?? null, today),
      finished: college ? collegeSubmitted(college, list) : list.length > 0 && list.every((p) => p.status === "submitted"),
    };
  };
  const rows = colleges.map((c) => group(c.id, c, c.name, byCollege.get(c.id) ?? []));
  rows.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? 1 : -1;
    const ba = bucket(a.due, today);
    const bb = bucket(b.due, today);
    if (ba !== bb) return ba - bb;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  if (shared.length) {
    const g = group(SHARED, null, SHARED_NAME, shared);
    if (g.finished) {
      const firstFinished = rows.findIndex((r) => r.finished);
      rows.splice(firstFinished < 0 ? rows.length : firstFinished, 0, g);
    } else rows.unshift(g);
  }
  return rows;
}

/**
 * The piece "Write" opens: the one last open (when it's still there), else the unfinished piece
 * due soonest (its own due date, else its college's deadline; desk order on a tie), else any
 * piece. Null on an empty desk.
 */
export function pieceToWrite(
  colleges: { id: string; deadline: string | null }[],
  pieces: { id: string; college_id: string | null; status: PieceStatus; due?: string | null }[],
  last?: string | null,
): string | null {
  if (last && pieces.some((p) => p.id === last)) return last;
  const deadline = new Map(colleges.map((c) => [c.id, c.deadline]));
  const due = (p: (typeof pieces)[number]) => p.due ?? (p.college_id ? deadline.get(p.college_id) : null) ?? "9999";
  const open = pieces.filter((p) => !isDone(p.status)).sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0));
  return (open[0] ?? pieces[0])?.id ?? null;
}

/** Where opening a college lands: its first piece still being worked on, else its first piece. */
export function pickCollegePiece<T extends { status: PieceStatus }>(pieces: T[]): T | null {
  return pieces.find((p) => !isDone(p.status)) ?? pieces[0] ?? null;
}

/** Every piece in rail order, for "next piece" and "previous piece". */
export function railSequence(groups: RailGroup[]): RailPiece[] {
  return groups.flatMap((g) => g.pieces);
}

/** The piece `step` places away from `currentId` in rail order, or null at either end. */
export function stepPiece(groups: RailGroup[], currentId: string, step: 1 | -1): RailPiece | null {
  const all = railSequence(groups);
  const i = all.findIndex((p) => p.id === currentId);
  if (i < 0) return all[0] ?? null;
  return all[i + step] ?? null;
}

/** A tab's label: the title without a leading "1 · " or "2." numbering. */
export function tabLabel(title: string): string {
  return title.replace(/^\s*\d+\s*[·.):-]\s*/, "").trim() || title;
}

/**
 * A piece's count for the rail and tabs: "212/250" against a word limit, "900/1000c" against
 * a character limit when the characters are known, otherwise "340w".
 */
export function countLabel(p: { words: number; chars?: number | null; kind: RailPiece["limit_kind"]; limit: number | null }): string {
  if (p.kind === "words" && p.limit) return `${p.words}/${p.limit}`;
  if (p.kind === "chars" && p.limit && p.chars !== undefined && p.chars !== null) return `${p.chars}/${p.limit}c`;
  return `${p.words}w`;
}

/** A piece and its versions: the original first, then its versions in desk order. */
export function versionFamily<T extends { id: string; variant_of?: string | null }>(pieces: T[], current: T): T[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const root = current.variant_of && byId.has(current.variant_of) ? current.variant_of : current.id;
  return withVersionsAfter(pieces.filter((p) => p.id === root || p.variant_of === root));
}

/** The title for the next version of a piece: "Why us? (version 3)". */
export function nextVersionTitle(rootTitle: string, familySize: number): string {
  const base = rootTitle.replace(/\s*\(version \d+\)\s*$/i, "").trim() || "Untitled";
  return `${base} (version ${familySize + 1})`.slice(0, 300);
}

/** "Nov 1" for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A group's line under its name: "3 pieces · 1 done · Nov 1". */
export function groupMeta(g: Pick<RailGroup, "total" | "done" | "due">): string {
  const parts = [g.total === 0 ? "No pieces yet" : `${g.total} piece${g.total === 1 ? "" : "s"}`];
  if (g.total) parts.push(`${g.done} done`);
  if (g.due) parts.push(shortDate(g.due));
  return parts.join(" · ");
}
