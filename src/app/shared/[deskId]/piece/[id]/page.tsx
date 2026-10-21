import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PieceEditor, type PieceMeta } from "@/app/desk/piece/[id]/piece-editor";
import { loadDesk, loadWaiting, todayISO } from "@/lib/data/queries";
import { requireDeskAccess } from "@/lib/supabase/server";
import { railOrder, SHARED } from "@/lib/write/rail";

/** A piece on a shared desk, in the Write workspace: the college rail, its pieces as tabs, and its history. */
export default async function SharedPiece(props: PageProps<"/shared/[deskId]/piece/[id]">) {
  const { deskId, id } = await props.params;
  const { supabase, userId, role, name } = await requireDeskAccess(deskId);
  if (role === "owner") redirect(`/desk/piece/${id}`);
  const { data: piece } = await supabase
    .from("pieces")
    .select("id, desk_id, college_id, title, prompt, limit_kind, limit_value, status, notes, due")
    .eq("id", id)
    .eq("desk_id", deskId)
    .maybeSingle<PieceMeta & { desk_id: string }>();
  if (!piece) notFound();
  const [{ data: college }, { colleges, pieces }] = await Promise.all([
    piece.college_id
      ? supabase.from("colleges").select("id, name").eq("id", piece.college_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadDesk(supabase, deskId),
  ]);
  const groups = railOrder(colleges, pieces, todayISO());
  const waiting = await loadWaiting(supabase, pieces.map((p) => p.id));
  const tabs = groups.find((g) => g.key === (piece.college_id ?? SHARED))?.pieces ?? [];

  return (
    <main className="w-full px-0">
      <nav className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm text-muted">
        <Link href={`/shared/${deskId}`}>Board</Link>
        <span>/</span>
        <span>{college?.name ?? "Independent piece"}</span>
      </nav>
      <PieceEditor
        deskId={deskId}
        key={piece.id}
        piece={piece}
        userId={userId}
        author={name || "Guest"}
        collegeName={college?.name ?? null}
        role={role}
        workspace={{ groups, tabs, base: `/shared/${deskId}`, waiting }}
      />
    </main>
  );
}
