import Link from "next/link";
import { MasterBoard } from "@/components/board/master-board";
import { StatTiles } from "@/components/board/stat-tiles";
import { boardStats } from "@/components/board/summary";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { checkCommonApp, COMMON_APP_MAX } from "@/lib/domain/colleges";
import { loadProgress } from "@/lib/progress/load";
import { loadWaiting } from "@/lib/data/waiting";
import { requireDesk } from "@/lib/supabase/server";

export default async function BoardPage() {
  const { supabase, userId, desk } = await requireDesk();
  const [{ colleges, pieces }, board, { data: profile }] = await Promise.all([
    loadDesk(supabase, desk.id),
    loadProgress(supabase, desk.id),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
  ]);
  const today = todayISO();
  const waiting = await loadWaiting(supabase, board.pieces.map((p) => p.id));
  const ca = checkCommonApp(colleges);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl">
          {profile?.display_name ? `${profile.display_name}'s board` : "Your board"}
        </h1>
        <nav aria-label="Board actions" className="flex flex-wrap gap-2">
          <Link href="/desk/add/college" className="btn btn-primary">
            Add a college
          </Link>
          <Link href="/desk/add/piece" className="btn">
            Add an independent piece
          </Link>
          <Link href="/desk/import" className="btn">
            Import essays
          </Link>
        </nav>
      </div>

      {ca.over && (
        <div role="alert" className="mb-6 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm">
          <p className="font-medium text-warn">
            {ca.count} colleges use the Common App, and it allows only {COMMON_APP_MAX}.
          </p>
          <p className="mt-1">
            Move {ca.count - COMMON_APP_MAX} to their own application or another system.
            {ca.movable.length > 0 && (
              <> The easiest to move are the ones that don&apos;t need letters: {ca.movable.map((c) => c.name).join(", ")}.</>
            )}
          </p>
        </div>
      )}

      {(colleges.length > 0 || pieces.length > 0) && <StatTiles stats={boardStats(colleges, pieces, today)} today={today} />}

      <MasterBoard
        deskId={desk.id}
        initial={{
          colleges: board.colleges,
          pieces: board.pieces,
          recommenders: board.recommenders,
          letters: board.letters,
          lettersReady: board.lettersReady,
        }}
        waiting={waiting}
        serverToday={today}
        base="/desk"
        canWrite
        collegeLinks
        behind={board.behind}
      />
    </main>
  );
}
