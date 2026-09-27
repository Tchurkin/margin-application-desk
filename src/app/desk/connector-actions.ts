"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { CounselorSpeed } from "@/lib/bridge/watchers";
import { isEffort, isModel, type EffortId, type ModelId } from "@/lib/counselor/models";
import { asEssayAccess, type EssayAccess } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";

export interface ConnectorState {
  token?: string;
  label?: string;
  error?: string;
}

type Supabase = Awaited<ReturnType<typeof requireDesk>>["supabase"];

const SPEEDS: CounselorSpeed[] = ["fast", "balanced", "thorough"];
const asSpeed = (v: unknown): CounselorSpeed => (SPEEDS.includes(v as CounselorSpeed) ? (v as CounselorSpeed) : "balanced");

const missingColumn = (code?: string) => code === "42703" || code === "PGRST204";

function revalidate() {
  revalidatePath("/desk/settings", "layout");
  revalidatePath("/desk/counselor");
}

/** The settings each migration added, newest first; a database a migration behind lacks the first ones. */
const NEWER_FIELDS = ["counselor_model", "counselor_effort", "replaces", "counselor_speed"];

/**
 * Set what a new link may do (and, for a counselor, how fast it runs and what it replaces). A
 * database a migration behind has fewer of these columns: whatever it has is set. Returns
 * whether every field was set.
 */
async function applySettings(supabase: Supabase, id: string, fields: Record<string, unknown>): Promise<boolean> {
  let rest = fields;
  for (let dropped = 0; ; dropped++) {
    const { error } = await supabase.from("connector_links").update(rest).eq("id", id);
    if (!error) return dropped === 0;
    if (!missingColumn(error.code) || dropped >= NEWER_FIELDS.length) throw new Error(error.message);
    const drop = NEWER_FIELDS[dropped];
    rest = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== drop));
  }
}

async function makeLink(label: string, fields: Record<string, unknown>): Promise<ConnectorState & { id?: string; complete?: boolean }> {
  const { supabase, desk } = await requireDesk();
  const { data, error } = await supabase.rpc("create_connector_link", { d: desk.id, link_label: label });
  if (error) return { error: error.message };
  const token = data as string;
  // The database keeps only the token's hash.
  const { data: made } = await supabase
    .from("connector_links")
    .select("id")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .single();
  let complete = false;
  try {
    if (made) complete = await applySettings(supabase, made.id, fields);
  } catch (e) {
    return { error: `The link was made, but its permissions couldn't be set: ${(e as Error).message}` };
  }
  revalidate();
  return { token, label, id: made?.id, complete };
}

export async function createConnectorLink(_prev: ConnectorState, f: FormData): Promise<ConnectorState> {
  const label = f.get("assistant") === "ChatGPT" ? "ChatGPT" : "Claude";
  const { token, error } = await makeLink(label, { essay_access: asEssayAccess(f.get("essays")), can_manage: f.get("manage") === "on" });
  return error ? { error } : { token, label };
}

/** A link for the counselor on this computer (its installer carries the token). */
export async function createCounselorLink(essays: EssayAccess, manage: boolean, speed: CounselorSpeed = "balanced"): Promise<ConnectorState> {
  const { supabase, desk } = await requireDesk();
  // Another computer: the same model and effort as the counselor already on the desk (a database
  // before migration 20261004 has none to copy).
  const { data: other } = await supabase
    .from("connector_links")
    .select("counselor_model, counselor_effort, counselor_speed")
    .eq("desk_id", desk.id)
    .is("revoked_at", null)
    .not("counselor_at", "is", null)
    .order("counselor_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { token, label, error } = await makeLink("Claude", {
    essay_access: asEssayAccess(essays),
    can_manage: !!manage,
    counselor_speed: asSpeed(other?.counselor_speed ?? speed),
    ...(isModel(other?.counselor_model) ? { counselor_model: other.counselor_model } : {}),
    ...(isEffort(other?.counselor_effort) ? { counselor_effort: other.counselor_effort } : {}),
  });
  return error ? { error } : { token, label };
}

/**
 * A new counselor to replace an older one: a fresh link with the same permissions and speed.
 * The old counselor keeps answering until the new one first checks in, which revokes the old
 * link (migration 20261003); the new setup file keeps the conversation. An earlier update that
 * was never run is dropped.
 */
export async function updateCounselorLink(oldId: string): Promise<ConnectorState> {
  const { supabase } = await requireDesk();
  const { data: old, error } = await supabase
    .from("connector_links")
    .select("*")
    .eq("id", oldId)
    .is("revoked_at", null)
    .single();
  if (error || !old) return { error: error?.message ?? "That counselor isn't on this desk any more." };
  const now = new Date().toISOString();
  // Missing on a database before migration 20261003; nothing to drop then.
  await supabase.from("connector_links").update({ revoked_at: now }).eq("replaces", oldId).is("counselor_at", null).is("revoked_at", null);
  const made = await makeLink(old.label, {
    essay_access: asEssayAccess(old.essay_access),
    can_manage: old.can_manage !== false,
    counselor_speed: asSpeed(old.counselor_speed),
    ...(isModel(old.counselor_model) ? { counselor_model: old.counselor_model } : {}),
    ...(isEffort(old.counselor_effort) ? { counselor_effort: old.counselor_effort } : {}),
    replaces: oldId,
  });
  if (made.error) return { error: made.error };
  // Without migration 20261003 the new link can't say what it replaces: turn the old one off now.
  if (!made.complete) await supabase.from("connector_links").update({ revoked_at: now }).eq("id", oldId);
  revalidate();
  return { token: made.token, label: made.label };
}

export async function setConnectorPermissions(id: string, essays: EssayAccess, manage: boolean) {
  const { supabase } = await requireDesk();
  const { error } = await supabase
    .from("connector_links")
    .update({ essay_access: asEssayAccess(essays), can_manage: !!manage })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** The nearest of the three speeds an older counselor (version 2) understands. */
const speedFor = (model: ModelId, effort: EffortId): CounselorSpeed =>
  model === "opus" || model === "fable" ? "thorough" : effort === "low" ? "fast" : "balanced";

/**
 * The counselor's default model and how hard it thinks; they take effect from the next request.
 * The same on every computer it runs on (and on an update not yet run), whichever one is chosen.
 */
export async function setCounselorModel(id: string, model: ModelId, effort: EffortId) {
  const { supabase, desk } = await requireDesk();
  if (!isModel(model) || !isEffort(effort)) throw new Error("Unknown model.");
  const { error } = await supabase
    .from("connector_links")
    .update({ counselor_model: model, counselor_effort: effort, counselor_speed: speedFor(model, effort) })
    .eq("desk_id", desk.id)
    .is("revoked_at", null)
    .or(`id.eq.${id},counselor_at.not.is.null,replaces.not.is.null`);
  if (error) throw new Error(error.message);
  revalidate();
}

/** A paused counselor keeps running but picks nothing up until it is resumed. */
export async function setCounselorPaused(id: string, paused: boolean) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("connector_links").update({ counselor_paused: !!paused }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/**
 * Ask the counselor to remove itself from the student's computer. It does so the next time it
 * checks in (within seconds if that computer is on), then revokes its own link. `undo` takes the
 * request back while it hasn't happened yet.
 */
export async function setCounselorRemove(id: string, remove: boolean) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("connector_links").update({ counselor_remove: !!remove }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function revokeConnectorLink(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("connector_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}
