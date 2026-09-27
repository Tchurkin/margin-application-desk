import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Who is answering the desk right now: a Claude or ChatGPT chat running watch_desk, or the
 * counselor on the student's computer (see src/lib/counselor/installer.ts). Both check in on the
 * desk's connector link; the website reads when they last did, and what they last did.
 */

export type CounselorSpeed = "fast" | "balanced" | "thorough";

export interface Activity {
  tool: string;
  piece?: string | null;
  /** The request the counselor is working on, if it said. */
  request?: string | null;
}

export interface Connector {
  id?: string;
  label: string;
  last_used_at: string | null;
  /** When a chat (watch_desk) or the counselor last checked the desk (migration 20260929). */
  watched_at?: string | null;
  /** When the counselor on the student's computer last checked in (migration 20261001). */
  counselor_at?: string | null;
  /** Migration 20261002. */
  counselor_speed?: CounselorSpeed;
  counselor_paused?: boolean;
  counselor_version?: string;
  /** Asked to remove itself from the student's computer. */
  counselor_remove?: boolean;
  /** A new counselor's link, waiting to replace this one (migration 20261003). */
  replaces?: string | null;
  /** Its default model and how hard it thinks (migration 20261004). */
  counselor_model?: string;
  counselor_effort?: string;
  /** The computer it runs on, as that computer names itself (migration 20261017). */
  counselor_computer?: string;
  activity?: Activity | null;
  activity_at?: string | null;
  /** Migration 20261001. */
  essay_access?: string;
  can_manage?: boolean;
}

/** What the student says once in their open Claude/ChatGPT chat. */
export const WATCH_PHRASE = "Watch my Average App";
/** Watchers check in at least every ~45s; allow for a slow answer in between. */
export const WATCH_FRESH_MS = 120_000;
/** Something the assistant did this recently is "now". */
export const ACTIVITY_FRESH_MS = 90_000;

const fresh = (ts: string | null | undefined, now: number, within = WATCH_FRESH_MS) => !!ts && now - Date.parse(ts) < within;

/** The counselor or chat watching the desk right now, if any; a counselor first. */
export function watcher(connectors: Connector[] | null, now: number): Connector | null {
  if (!connectors) return null;
  return connectors.find((c) => fresh(c.counselor_at, now)) ?? connectors.find((c) => fresh(c.watched_at, now)) ?? null;
}

export function isCounselor(c: Connector | null, now: number): boolean {
  return !!c && fresh(c.counselor_at, now);
}

/**
 * The desk's counselor links (ever installed). With `now`, running ones come first in a stable
 * order (each refreshes its check-in at its own moment, so ordering them by it would flip them
 * back and forth); otherwise, and after those, the most recently seen first.
 */
export function counselors(connectors: Connector[] | null, now?: number): Connector[] {
  const on = (c: Connector) => (now === undefined ? false : isCounselor(c, now));
  return (connectors ?? [])
    .filter((c) => !!c.counselor_at)
    .sort(
      (a, b) =>
        Number(on(b)) - Number(on(a)) ||
        (on(a) && on(b) ? (a.id ?? "").localeCompare(b.id ?? "") : Date.parse(b.counselor_at!) - Date.parse(a.counselor_at!)),
    );
}

/** A new counselor downloaded to replace this one and not yet started, if any. */
export function pendingReplacement(connectors: Connector[] | null, id: string): Connector | null {
  return (connectors ?? []).find((c) => c.replaces === id && !c.counselor_at) ?? null;
}

const DOING: Record<string, (piece: string) => string> = {
  thinking: () => "thinking",
  list_my_desk: () => "looking over your desk",
  read_piece: (p) => (p ? `reading “${p}”` : "reading your essay"),
  suggest_edits: (p) => (p ? `suggesting edits to “${p}”` : "suggesting edits"),
  write_piece: (p) => (p ? `writing “${p}”` : "writing"),
  edit_piece: (p) => (p ? `editing “${p}”` : "editing"),
  create_piece: () => "adding a piece",
  update_piece: (p) => (p ? `updating “${p}”` : "updating a piece"),
  delete_piece: () => "removing a piece",
  set_up_colleges: () => "setting up your colleges",
  update_college: () => "updating a college",
  delete_college: () => "removing a college",
  read_strategy: () => "reading your college list",
  set_college_strategy: () => "setting your odds",
  update_academics: () => "updating your academics",
  read_profile: () => "reading your profile",
  save_profile_section: () => "updating your profile",
  order_profile_sections: () => "organizing your profile",
  delete_profile_section: () => "organizing your profile",
  update_my_profile: () => "updating your profile",
  save_recommender: () => "updating your recommenders",
  set_letter: () => "updating your letters",
  delete_recommender: () => "updating your recommenders",
  writing: () => "writing",
};

/** What the assistant is doing right now ("reading “Why us”"), or null when it's idle. */
export function activityText(c: Connector | null, now: number): string | null {
  if (!c?.activity || !fresh(c.activity_at, now, ACTIVITY_FRESH_MS)) return null;
  const f = DOING[c.activity.tool];
  return f ? f(c.activity.piece ?? "") : null;
}

/** What a counselor is doing on this request, if it is working on it right now. */
export function activityOn(connectors: Connector[] | null, requestId: string, now: number): string | null {
  const c = (connectors ?? []).find((x) => x.activity?.request === requestId);
  return c ? activityText(c, now) : null;
}

/** Newest schema first; each fallback is a database one migration further behind. */
const COLUMNS = [
  "id, label, last_used_at, watched_at, counselor_at, counselor_speed, counselor_paused, counselor_version, counselor_remove, activity, activity_at, essay_access, can_manage, replaces, counselor_model, counselor_effort, counselor_computer",
  "id, label, last_used_at, watched_at, counselor_at, counselor_speed, counselor_paused, counselor_version, counselor_remove, activity, activity_at, essay_access, can_manage, replaces, counselor_model, counselor_effort",
  "id, label, last_used_at, watched_at, counselor_at, counselor_speed, counselor_paused, counselor_version, counselor_remove, activity, activity_at, essay_access, can_manage, replaces",
  "id, label, last_used_at, watched_at, counselor_at, counselor_speed, counselor_paused, counselor_version, counselor_remove, activity, activity_at, essay_access, can_manage",
  "id, label, last_used_at, watched_at, counselor_at, essay_access, can_manage",
  "id, label, last_used_at, watched_at, counselor_at",
  "id, label, last_used_at, watched_at",
  "id, label, last_used_at",
];

/** The desk's live connector links; null when they can't be read (then nothing is assumed). */
export async function fetchConnectors(supabase: SupabaseClient, deskId: string): Promise<Connector[] | null> {
  for (const cols of COLUMNS) {
    const { data, error } = await supabase.from("connector_links").select(cols).eq("desk_id", deskId).is("revoked_at", null);
    if (!error) return (data ?? []) as unknown as Connector[];
    // A database a migration behind has fewer columns: ask for fewer.
    if (error.code !== "42703" && error.code !== "PGRST204") return null;
  }
  return null;
}
