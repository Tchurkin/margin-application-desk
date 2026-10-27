import type { PieceStatus } from "@/lib/domain/colleges";
import type { DueTone } from "@/lib/progress/due";

/*
 * Stage colors, from quiet to done: gray for not started, ink for drafting, amber for review,
 * green for final, solid green for submitted (the same scale as StatusPill). "Done" is green on
 * every theme, not the theme's accent.
 */

export const CHIP_TONE: Record<PieceStatus, string> = {
  not_started: "border-line bg-panel text-muted",
  drafting: "border-muted bg-panel text-ink",
  needs_review: "border-warn bg-warn-soft text-warn",
  final: "border-done bg-done-soft text-done",
  submitted: "border-done bg-done text-done-ink",
};

/** The mini status strip next to a college's name: one bar per piece. */
export const BAR_TONE: Record<PieceStatus, string> = {
  not_started: "bg-line",
  drafting: "bg-muted",
  needs_review: "bg-warn",
  final: "bg-done/50",
  submitted: "bg-done",
};

/** A card's left edge on the board, by stage. */
export const CARD_EDGE: Record<PieceStatus, string> = {
  not_started: "border-l-line",
  drafting: "border-l-muted",
  needs_review: "border-l-warn",
  final: "border-l-done/60",
  submitted: "border-l-done",
};

export const DUE_TONE: Record<DueTone, string> = {
  passed: "text-muted line-through",
  soon: "font-medium text-danger",
  near: "text-warn",
  far: "text-ink",
};
