import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { loadWaiting } from "@/lib/data/waiting";
import { requireDesk } from "@/lib/supabase/server";
import { railOrder, SHARED } from "@/lib/write/rail";
import { PieceEditor, type PieceMeta } from "./piece-editor";

export default async function PiecePage(props: PageProps<"/desk/piece/[id]">) {
  const { id } = await props.params;
  const { supabase, userId, desk } = await requireDesk();
  const { data: piece } = await supabase
    .from("pieces")
    .select("id, college_id, title, prompt, limit_kind, limit_value, status, notes, due")
    .eq("id", id)
    .maybeSingle<PieceMeta>();
  if (!piece) notFound();

  const [{ data: college }, { data: profile }, { colleges, pieces }] = await Promise.all([
    piece.college_id
      ? supabase.from("colleges").select("id, name").eq("id", piece.college_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
    loadDesk(supabase, desk.id),
  ]);
  const groups = railOrder(colleges, pieces, todayISO());
  const waiting = await loadWaiting(supabase, pieces.map((p) => p.id));
  const tabs = groups.find((g) => g.key === (piece.college_id ?? SHARED))?.pieces ?? [];

  return (
    <main className="w-full px-0">
      <nav className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm text-muted">
        <Link href="/desk">Board</Link>
        <span>/</span>
        {college ? <Link href={`/desk/college/${college.id}`}>{college.name}</Link> : <span>Independent piece</span>}
      </nav>
      <PieceEditor
        deskId={desk.id}
        key={piece.id}
        piece={piece}
        userId={userId}
        author={profile?.display_name || "Student"}
        collegeName={college?.name ?? null}
        workspace={{ groups, tabs, base: "/desk", waiting }}
      />
    </main>
  );
}
