import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * The AI bridge, client side. The website can't start or read a Claude or ChatGPT
 * conversation, so it queues a request on the desk and opens the student's assistant with a
 * message asking it to handle the desk's requests through the connector. The answer comes
 * back through the connector (answer_request, suggest_edits, set_college_strategy) and shows up
 * live.
 */

export type Assistant = "claude" | "chatgpt";
export type RequestKind = "ask" | "polish" | "odds" | "interview" | "chat" | "transcript";

export interface DeskRequest {
  id: string;
  desk_id: string;
  piece_id: string | null;
  kind: RequestKind;
  prompt: string;
  selection: string;
  status: "pending" | "answered" | "dismissed";
  answer: string;
  answered_by: string;
  created_at: string;
  answered_at: string | null;
  /** When the counselor on the student's computer picked it up (migration 20261001). */
  counselor_at?: string | null;
  /** The Claude model asked for, or "" for the counselor's default (migration 20261004). */
  model?: string;
  /** Who asked, when it wasn't the student: someone they share the desk with (migration 20261019). */
  asked_by?: string;
}

/** Who asked, on a database with migration 20261019 (else read without it). */
export const ASKED_COLS = ", asked_by";

export const REQUEST_COLS =
  "id, desk_id, piece_id, kind, prompt, selection, status, answer, answered_by, created_at, answered_at, counselor_at";

/** The message that sends the assistant to the desk's queue. */
export function handoffMessage(kind: RequestKind): string {
  if (kind === "odds") {
    return "Use my Average App connector: handle my pending desk requests. For the odds request, estimate my admission chances for each college on my desk from my profile and set them with set_college_strategy.";
  }
  return "Use my Average App connector: handle my pending desk requests (list_desk_requests), then answer each one.";
}

/** A link that opens the assistant with the message filled in. */
export function assistantUrl(assistant: Assistant, message: string): string {
  const q = encodeURIComponent(message);
  return assistant === "chatgpt" ? `https://chatgpt.com/?q=${q}` : `https://claude.ai/new?q=${q}`;
}

/** Queue a request on the desk. */
export async function queueRequest(
  supabase: SupabaseClient,
  r: { deskId: string; pieceId?: string | null; kind: RequestKind; prompt: string; selection?: string; model?: string },
): Promise<DeskRequest> {
  const { data, error } = await supabase
    .from("desk_requests")
    .insert({
      desk_id: r.deskId,
      piece_id: r.pieceId ?? null,
      kind: r.kind,
      prompt: r.prompt,
      selection: r.selection ?? "",
      // Only when one was picked, so a database without the column still takes requests.
      ...(r.model ? { model: r.model } : {}),
    })
    .select(REQUEST_COLS)
    .single();
  if (error) throw error;
  return data as DeskRequest;
}

/** How each assistant is named on buttons ("Ask Claude") and in "Waiting for Claude…". */
export function assistantLabel(a: Assistant): string {
  return a === "chatgpt" ? "ChatGPT" : "Claude";
}

const ASSISTANT_KEY = "desk:assistant";
const assistantListeners = new Set<() => void>();

/** The assistant this browser picked, or null if it never picked one. */
export function storedAssistant(): Assistant | null {
  try {
    const v = localStorage.getItem(ASSISTANT_KEY);
    return v === "chatgpt" || v === "claude" ? v : null;
  } catch {
    return null;
  }
}

/** Which assistant this student uses, remembered per browser. */
export function preferredAssistant(): Assistant {
  return storedAssistant() ?? "claude";
}

export function setPreferredAssistant(a: Assistant) {
  try {
    localStorage.setItem(ASSISTANT_KEY, a);
  } catch {
    // Private mode: just don't remember.
  }
  // Every Ask button on the page (and on Strategy) follows the choice at once.
  for (const l of assistantListeners) l();
}

/** Follow changes to the choice, in this tab and in others. Returns the unsubscribe. */
export function subscribeAssistant(onChange: () => void): () => void {
  assistantListeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === ASSISTANT_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    assistantListeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** PostgREST's "no such table/function": the database is a migration behind the code. */
export function bridgeMissing(e: { code?: string } | null | undefined): boolean {
  return ["42P01", "PGRST205", "42883", "PGRST202"].includes(e?.code ?? "");
}
