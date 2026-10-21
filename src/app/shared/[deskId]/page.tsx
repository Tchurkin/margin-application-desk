import { redirect } from "next/navigation";
import { MasterBoard } from "@/components/board/master-board";
import { todayISO } from "@/lib/data/queries";
import { loadWaiting } from "@/lib/data/waiting";
import { loadProgress } from "@/lib/progress/load";
import { requireDeskAccess } from "@/lib/supabase/server";

export default async function SharedBoard(props: PageProps<"/shared/[deskId]">) {
  const { deskId } = await props.params;
  const { supabase, role } = await requireDeskAccess(deskId);
  if (role === "owner") redirect("/desk");
  const board = await loadProgress(supabase, deskId);
  const waiting = await loadWaiting(supabase, board.pieces.map((p) => p.id));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl">Board</h1>
      <MasterBoard
        deskId={deskId}
        initial={{
          colleges: board.colleges,
          pieces: board.pieces,
          recommenders: board.recommenders,
          letters: board.letters,
          lettersReady: board.lettersReady,
        }}
        waiting={waiting}
        serverToday={todayISO()}
        base={`/shared/${deskId}`}
        canWrite={false}
        collegeLinks={false}
      />
    </main>
  );
}
