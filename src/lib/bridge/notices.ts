import type { DeskRequest } from "./requests";

/*
 * When Claude (or ChatGPT) answers something on the desk while the student is on another page,
 * the page it belongs to gets a dot in the tabs and a short note says where to find it. Pure, so
 * it is tested without a browser.
 */

/** The desk tabs an answer can light up (DeskNav's labels). */
export type NoticeTab = "Write" | "Strategy" | "Profile" | "Counselor";

export interface Notice {
  id: string;
  tab: NoticeTab;
  href: string;
  text: string;
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

/**
 * The note for a request that was just answered, or null when the student is already looking at
 * where it shows (then the answer appears in front of them).
 */
export function noticeFor(
  r: Pick<DeskRequest, "id" | "kind" | "piece_id" | "answered_by" | "asked_by">,
  path: string,
  pieceTitle?: string | null,
): Notice | null {
  const who = r.answered_by || "Claude";
  const on = (href: string) => path === href || path.startsWith(`${href}/`);
  switch (r.kind) {
    case "ask":
    case "polish": {
      if (!r.piece_id) return null;
      const href = `/desk/piece/${r.piece_id}`;
      if (on(href)) return null;
      const what = pieceTitle ? ` about ${quote(pieceTitle)}` : "";
      return {
        id: r.id,
        tab: "Write",
        href,
        text:
          r.kind === "polish"
            ? `${who}'s rewrites${what} are ready.`
            : // A question from someone the desk is shared with, in the essay's shared chat.
              `${who} answered ${r.asked_by?.trim() ? `${r.asked_by.trim()}'s` : "your"} question${what}.`,
      };
    }
    case "odds":
      return on("/desk/strategy") ? null : { id: r.id, tab: "Strategy", href: "/desk/strategy", text: `${who} estimated your odds.` };
    case "transcript":
      // The Counselor page shows it too, in the conversation.
      return on("/desk/profile") || on("/desk/counselor")
        ? null
        : { id: r.id, tab: "Profile", href: "/desk/profile#academics", text: `${who} read your transcript.` };
    case "chat":
    case "interview":
      return on("/desk/counselor") ? null : { id: r.id, tab: "Counselor", href: "/desk/counselor", text: `${who} replied on the Counselor page.` };
    default:
      return null;
  }
}

/** Whether a tab's page is open (its dot clears): Write covers every piece. */
export function onTab(tab: NoticeTab, path: string): boolean {
  switch (tab) {
    case "Write":
      return path.startsWith("/desk/write") || path.startsWith("/desk/piece/");
    case "Strategy":
      return path.startsWith("/desk/strategy");
    case "Profile":
      return path.startsWith("/desk/profile");
    case "Counselor":
      return path.startsWith("/desk/counselor");
  }
}

/** Whether the student is looking at what the note points to: for Write, that piece itself. */
export function showing(n: Notice, path: string): boolean {
  return n.tab === "Write" ? path === n.href || path.startsWith(`${n.href}/`) : onTab(n.tab, path);
}
