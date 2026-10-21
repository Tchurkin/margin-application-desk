"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { LocalDay } from "@/components/local-day";
import { DueTag } from "@/components/progress/due-cell";
import { StageSlider } from "@/components/progress/stage-slider";
import { BAR_TONE, CARD_EDGE } from "@/components/progress/tones";
import { ConfirmDialog } from "@/components/write/confirm-dialog";
import { ChevronIcon } from "@/components/write/icons";
import { WaitingBadges } from "@/components/waiting-badges";
import { NO_WAITING, waitingLabel, type Waiting } from "@/lib/data/waiting";
import { APP_SYSTEMS, labelOf, ROUNDS, type PieceStatus } from "@/lib/domain/colleges";
import {
  countLabel,
  countPhrase,
  finalCount,
  isFiled,
  stageSummary,
  type Lane,
  type ProgressCollege,
  type ProgressPiece,
} from "@/lib/progress/lanes";
import { stageIndex, stageLabel, STAGES } from "@/lib/progress/stages";
import { LetterRow, type LetterActions } from "./letters";

/*
 * The master board: one swimlane per college, most urgent first, each with its application
 * details and letters under its name and its pieces as cards in four stage columns, and one per
 * piece of its own (a personal statement). Drag a card to another column, or focus it and use
 * the arrow keys; click it to open the piece. A college folds up to one line.
 *
 * A college's application is marked done all at once, with its Mark as done button. A submitted college
 * folds up at the bottom of the board, and after a few days it's filed under Submitted.
 */

export type BoardMove = (piece: ProgressPiece, to: PieceStatus, focusToken: string | null) => void;

export interface LaneContext {
  today: string;
  base: string;
  canWrite: boolean;
  /** Link college names to their details page (the owner's desk has one). */
  collegeLinks: boolean;
  onMove: BoardMove;
  /** Mark a college's application submitted, or take that back. */
  onSubmit: (college: ProgressCollege, submitted: boolean) => Promise<void>;
  letters: LetterActions;
  /** Suggestions and comments waiting on each piece. */
  waiting: Record<string, Waiting>;
}

const ROUND_SHORT: Record<string, string> = { rolling: "Rolling", priority: "Priority" };
const PORTAL_SHORT: Record<string, string> = {
  coalition: "Coalition",
  uc: "UC App",
  own_portal: "Own portal",
  other: "Other portal",
};

/** The cards' columns (the header and each lane line up on it). */
const COLUMNS = "grid grid-cols-1 gap-2 sm:grid-cols-4";

/** "Submitted Nov 1", on the student's own calendar. */
function SubmittedOn({ at }: { at: string | null }) {
  return at ? (
    <>
      Submitted <LocalDay at={at} />
    </>
  ) : (
    <>Submitted</>
  );
}

export function Swimlanes({
  lanes,
  folded,
  onFold,
  ctx,
}: {
  lanes: Lane[];
  folded: ReadonlySet<string>;
  onFold: (key: string) => void;
  ctx: LaneContext;
}) {
  // Submitted colleges stay folded unless opened here.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const isFolded = (l: Lane) => (l.submitted ? !opened.has(l.key) : folded.has(l.key));
  const toggle = (l: Lane) => {
    if (!l.submitted) return onFold(l.key);
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(l.key)) next.delete(l.key);
      else next.add(l.key);
      return next;
    });
  };
  const shown = lanes.filter((l) => !isFiled(l, ctx.today));
  const filed = lanes.filter((l) => isFiled(l, ctx.today));
  const lane = (l: Lane) => <Swimlane key={l.key} lane={l} folded={isFolded(l)} onFold={() => toggle(l)} ctx={ctx} />;

  return (
    <div>
      <div
        aria-hidden
        className={`${COLUMNS} sticky top-0 z-20 hidden bg-bg px-2.5 py-2 text-xs font-medium tracking-wide text-muted uppercase sm:grid`}
      >
        {STAGES.map((s) => (
          <span key={s} className="px-1">
            {stageLabel(s)}
          </span>
        ))}
      </div>
      <ol aria-label="Colleges" className="flex flex-col gap-3">
        {shown.map(lane)}
      </ol>
      {filed.length > 0 && (
        <details className="mt-6" data-testid="submitted-colleges">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">Submitted ({filed.length})</summary>
          <ol aria-label="Submitted" className="mt-3 flex flex-col gap-3">
            {filed.map(lane)}
          </ol>
        </details>
      )}
    </div>
  );
}

function Swimlane({ lane, folded, onFold, ctx }: { lane: Lane; folded: boolean; onFold: () => void; ctx: LaneContext }) {
  const track = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const college = lane.college;
  const own = college ? null : lane.pieces[0];
  const nameHref = college ? (ctx.collegeLinks ? `${ctx.base}/college/${college.id}` : null) : own ? `${ctx.base}/piece/${own.id}` : null;
  const finals = finalCount(lane.pieces);
  const open = lane.pieces.length - finals;
  const bodyId = `lane-${lane.key}`;

  return (
    <li aria-label={lane.name} data-lane={lane.key} className={`card ${lane.submitted ? "opacity-80" : ""}`}>
      <div className="flex items-start gap-1.5 px-2.5 py-2">
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={folded ? undefined : bodyId}
          aria-label={`Pieces of ${lane.name}`}
          title={folded ? "Unfold" : "Fold"}
          onClick={onFold}
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-bg hover:text-ink"
        >
          <span aria-hidden className={`transition-transform ${folded ? "" : "rotate-90"}`}>
            <ChevronIcon />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {nameHref ? (
              <Link href={nameHref} title={college ? "Deadline, details and new pieces" : "Open"} className="font-medium hover:underline">
                {lane.name}
              </Link>
            ) : (
              <span className="font-medium">{lane.name}</span>
            )}
            {college ? (
              <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                {college.round && (
                  <abbr title={labelOf(ROUNDS, college.round)} className="rounded bg-bg px-1.5 py-px font-mono text-[11px] text-ink no-underline">
                    {ROUND_SHORT[college.round] ?? college.round}
                  </abbr>
                )}
                {college.app_system && (
                  <span title={labelOf(APP_SYSTEMS, college.app_system)}>
                    {PORTAL_SHORT[college.app_system] ?? labelOf(APP_SYSTEMS, college.app_system)}
                  </span>
                )}
                {lane.submitted ? (
                  <span className="rounded bg-accent px-1.5 py-px font-medium text-accent-ink" data-testid="submitted-tag">
                    <SubmittedOn at={lane.submittedAt} />
                  </span>
                ) : college.deadline ? (
                  <DueTag date={college.deadline} today={ctx.today} />
                ) : (
                  <span>no deadline</span>
                )}
                {college.ai_policy === "no_drafting" && <span className="text-warn">no AI drafting</span>}
              </span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                <span>Independent piece</span>
                {lane.due && <DueTag date={lane.due} today={ctx.today} />}
              </span>
            )}
            {college && lane.pieces.length > 0 && (
              <span className="text-xs text-muted">
                {finals}/{lane.pieces.length} final
              </span>
            )}
          </div>
          {college && <LetterRow collegeId={college.id} collegeName={lane.name} needsLetters={college.needs_letters} actions={ctx.letters} />}
          {folded && <StatusStrip pieces={lane.pieces} />}
        </div>
        {college && ctx.canWrite && (
          <button
            type="button"
            className={`btn shrink-0 ${lane.submitted ? "" : "border-accent text-accent"}`}
            onClick={() => (lane.submitted ? void ctx.onSubmit(college, false) : setAsking(true))}
          >
            {lane.submitted ? "Undo" : "Mark as done"}
          </button>
        )}
      </div>

      {!folded &&
        (lane.pieces.length === 0 ? (
          <p id={bodyId} className="border-t border-line px-10 py-2 text-xs text-muted">
            No pieces yet
            {college && ctx.collegeLinks && (
              <>
                {" · "}
                <Link href={`${ctx.base}/college/${college.id}`} className="underline hover:text-ink">
                  add one
                </Link>
              </>
            )}
          </p>
        ) : (
          <div id={bodyId} ref={track} role="group" aria-label={`${lane.name} stages`} className={`${COLUMNS} border-t border-line p-2`}>
            {STAGES.map((stage, i) => {
              const cards = lane.pieces.filter((p) => stageIndex(p.status) === i);
              return (
                <div
                  key={stage}
                  data-stage-cell={stage}
                  className={`min-h-14 rounded-md border border-dashed p-1 transition-colors ${cards.length ? "" : "hidden sm:block"} ${
                    zone === i ? "border-accent bg-accent-soft" : "border-transparent"
                  }`}
                >
                  <p className="mb-1 px-1 text-[11px] font-medium tracking-wide text-muted uppercase sm:hidden">{stageLabel(stage)}</p>
                  <ul aria-label={stageLabel(stage)} className="flex flex-col gap-1.5">
                    {cards.map((p) => (
                      <li key={p.id}>
                        <Card piece={p} lane={lane} track={track} onZone={setZone} ctx={ctx} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}

      {asking && college && (
        <ConfirmDialog
          question={`Mark ${lane.name} as done?`}
          detail={
            (lane.pieces.length
              ? `For when you've submitted the application. Its ${lane.pieces.length === 1 ? "piece is" : `${lane.pieces.length} pieces are`} marked submitted, and it moves to the bottom of the board.`
              : "For when you've submitted the application. It moves to the bottom of the board.") +
            (open > 0
              ? ` ${open} ${open === 1 ? "piece isn't" : "pieces aren't"} final yet; undoing this later puts every piece at Final.`
              : " You can undo this.")
          }
          confirmLabel="Mark as done"
          tone="primary"
          onCancel={() => setAsking(false)}
          onConfirm={async () => {
            await ctx.onSubmit(college, true);
            setAsking(false);
          }}
        />
      )}
    </li>
  );
}

function Card({
  piece,
  lane,
  track,
  onZone,
  ctx,
}: {
  piece: ProgressPiece;
  lane: Lane;
  track: React.RefObject<HTMLDivElement | null>;
  onZone: (z: number | null) => void;
  ctx: LaneContext;
}) {
  // A college's pieces show their own date when it differs from the deadline (an independent piece's is on its lane).
  const own = lane.college && piece.due && piece.due !== lane.college.deadline ? piece.due : null;
  const w = ctx.waiting[piece.id] ?? NO_WAITING;
  return (
    <StageSlider
      stage={piece.status}
      href={`${ctx.base}/piece/${piece.id}`}
      name={`${piece.title}${waitingLabel(w)}`}
      tooltip={`${piece.title}: ${countPhrase(piece)}${waitingLabel(w)}${ctx.canWrite && !lane.submitted ? " · drag to another column" : ""}`}
      movable={ctx.canWrite && !lane.submitted}
      track={track}
      focusToken={`c:${piece.id}`}
      onMove={(to, token) => ctx.onMove(piece, to, token)}
      onZone={onZone}
      className={`relative block rounded-md border border-l-[3px] border-line bg-panel px-2 py-1.5 text-sm hover:border-muted ${CARD_EDGE[piece.status]}`}
      dragClassName="z-10 shadow-lg"
      dragStyle={(d) => ({ transform: `translate(${d.dx}px, ${d.dy}px)` })}
    >
      <span className="line-clamp-2 leading-snug">{piece.title}</span>
      <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs">
        <span className="text-muted tabular-nums">{countLabel(piece)}</span>
        <WaitingBadges w={w} />
        {own && <DueTag date={own} today={ctx.today} />}
      </span>
    </StageSlider>
  );
}

/** One small bar per piece, colored by stage: a folded college's progress at a glance. */
function StatusStrip({ pieces }: { pieces: ProgressPiece[] }) {
  if (!pieces.length) return null;
  return (
    <span role="img" aria-label={stageSummary(pieces)} className="mt-1.5 flex h-1.5 max-w-full gap-0.5">
      {pieces.map((p) => (
        <span key={p.id} title={`${p.title}: ${stageLabel(p.status)}`} className={`max-w-6 min-w-1 flex-1 rounded-sm ${BAR_TONE[p.status]}`} />
      ))}
    </span>
  );
}
