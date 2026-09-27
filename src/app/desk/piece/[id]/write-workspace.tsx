"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AskPanel } from "@/components/ask/ask-panel";
import { SharedAskPanel } from "@/components/ask/shared-ask-panel";
import { CollegeRail } from "@/components/write/college-rail";
import { ConfirmDialog } from "@/components/write/confirm-dialog";
import { AskIcon, FilesIcon, HistoryIcon } from "@/components/write/icons";
import { PieceTabs } from "@/components/write/piece-tabs";
import { Workspace, type ToolDef } from "@/components/write/workspace";
import type { PieceStatus } from "@/lib/domain/colleges";
import { supabaseBrowser } from "@/lib/supabase/client";
import { byPiece, deskPresence, type Here } from "@/lib/sync/desk-presence";
import type { RailGroup, RailPiece } from "@/lib/write/rail";
import { deletePiece } from "../../actions";

const FILES: ToolDef = { id: "files", label: "Files", hint: "Colleges and pieces", icon: <FilesIcon /> };
const ASK: ToolDef = { id: "ask", label: "Ask", hint: "Ask Claude or ChatGPT about this piece", icon: <AskIcon /> };
const HISTORY: ToolDef = { id: "history", label: "History", hint: "Earlier versions of this piece", icon: <HistoryIcon /> };
// People the desk is shared with move around it, read the history, and follow the essay's Ask
// chat (asking in it too, if they can suggest or edit); adding and deleting pieces are the student's.
const TOOLS = [FILES, ASK, HISTORY];

/**
 * The Write page around the editor: the tool strip and side panel (the college rail, Ask,
 * History), and this college's pieces as tabs. `workspace.base` is "/desk" for the student and
 * "/shared/<id>" for the people they share with.
 */
export function WriteWorkspace({
  workspace,
  owner,
  canAsk,
  me,
  pieceId,
  deskId,
  title,
  countNow,
  status,
  editor,
  history,
  onDeleteCurrent,
  children,
}: {
  workspace: { groups: RailGroup[]; tabs: RailPiece[]; base: string };
  owner: boolean;
  /** Someone the desk is shared with who may ask in the essay's Ask chat (they can suggest or edit). */
  canAsk: boolean;
  /** Who is at this screen, as the people on the desk see them. */
  me: { id: string; name: string; color: string };
  pieceId: string;
  deskId: string;
  title: string;
  countNow: string;
  status: PieceStatus;
  editor: Editor | null;
  history: ReactNode;
  /** Before the open piece is deleted: save what was typed (so it's in the Trash), then stop. */
  onDeleteCurrent: () => Promise<void> | void;
  children: ReactNode;
}) {
  const [deleting, setDeleting] = useState<RailPiece | null>(null);
  const group = workspace.groups.find((g) => g.pieces.some((p) => p.id === pieceId));

  // Where everyone else working on the desk is, shown in the rail; and where we are, for them.
  const supabase = supabaseBrowser();
  const here = useMemo<Here>(() => ({ user: me.id, name: me.name, color: me.color, piece: pieceId }), [me.id, me.name, me.color, pieceId]);
  const [others, setOthers] = useState<Here[]>([]);
  useEffect(() => (deskId ? deskPresence(supabase, deskId).attach(here, setOthers) : undefined), [supabase, deskId, here]);
  const people = useMemo(() => byPiece(others), [others]);
  const pieceHref = (id: string) => `${workspace.base}/piece/${id}`;
  // A college with no pieces yet opens its page, which only the student has.
  const collegeHref = owner ? (id: string) => `/desk/college/${id}` : undefined;

  return (
    <Workspace
      tools={TOOLS}
      title={(t) => (t === "files" ? "Colleges" : t === "ask" ? `Asking about ${title}` : "History")}
      renderPanel={(t) =>
        t === "files" ? (
          <CollegeRail
            groups={workspace.groups}
            currentId={pieceId}
            pieceHref={pieceHref}
            collegeHref={collegeHref}
            live={{ count: countNow, status }}
            people={people}
          />
        ) : t === "ask" && !owner ? (
          <div className="p-3">
            <SharedAskPanel deskId={deskId} pieceId={pieceId} pieceTitle={title} canAsk={canAsk} />
          </div>
        ) : t === "ask" ? (
          <div className="p-3">
            <AskPanel
              deskId={deskId}
              pieceId={pieceId}
              pieceTitle={title}
              getSelection={() => {
                if (!editor) return "";
                const { from, to } = editor.state.selection;
                return editor.state.doc.textBetween(from, to, "\n");
              }}
            />
          </div>
        ) : (
          history
        )
      }
    >
      {workspace.tabs.length > 0 && (
        <div className="px-4 pt-2">
          <PieceTabs
            college={group?.name ?? ""}
            collegeId={group?.college?.id ?? null}
            pieces={workspace.tabs}
            currentId={pieceId}
            currentCount={countNow}
            besideId={null}
            pieceHref={pieceHref}
            owner={owner}
            onDelete={setDeleting}
          />
        </div>
      )}
      {children}
      {owner && deleting && (
        <ConfirmDialog
          question={`Delete "${deleting.title}"?`}
          detail="It goes to the Trash (Settings → Trash) with its history, notes and suggestions, and you can restore it for 30 days."
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.id === pieceId) await onDeleteCurrent();
            await deletePiece(deleting.id);
          }}
        />
      )}
    </Workspace>
  );
}
