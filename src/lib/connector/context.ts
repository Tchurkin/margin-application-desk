import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { head, renderGuestQuestion, renderRequest, renderRequestList, type ListingOptions, type PendingRequest } from "@/lib/bridge/listing";
import type { RequestKind } from "@/lib/bridge/requests";
import { profileInContext, type ProfileInfo } from "@/lib/profile/render";
import { catalogCandidates, matchCollege } from "@/lib/strategy/catalog";
import { renderStrategy, type StrategyInfo } from "@/lib/strategy/render";
import { loadDeskInfo, loadPiece, renderDesk, renderPiece } from "./tools";

/*
 * Requests from the desk together with what answering them needs: the piece a question is about
 * (with the student's whole profile and an overview of their desk, so the answer knows who they
 * are and what else they're writing), the college list for odds, the profile for an interview. Sending it along saves the
 * assistant a round of reading tools before it can answer, which is most of the wait on a
 * quick question.
 */

/** Each piece of context is cut at this many characters. */
const CONTEXT_MAX = 40_000;
/** How much of the profile comes along: whole sections from the top, then a pointer to read_profile for the rest. */
const PROFILE_WITH_PIECE = 16_000;
const PROFILE_ALONE = 30_000;

const clip = (s: string) => (s.length <= CONTEXT_MAX ? s : `${head(s, CONTEXT_MAX)}\n[…cut here; the tools have the rest]`);

/** Loads each kind of context at most once per call; anything that fails is simply left out. */
class Context {
  private pieces = new Map<string, Promise<string | null>>();
  private profile: Promise<ProfileInfo | null> | null = null;
  private strategy: Promise<string | null> | null = null;
  private desk: Promise<string | null> | null = null;

  constructor(
    private sb: SupabaseClient,
    private token: string,
  ) {}

  loadProfile(): Promise<ProfileInfo | null> {
    this.profile ??= Promise.resolve(this.sb.rpc("connector_profile", { token: this.token })).then(
      ({ data, error }) => (error ? null : (data as ProfileInfo)),
      () => null,
    );
    return this.profile;
  }

  piece(id: string): Promise<string | null> {
    let p = this.pieces.get(id);
    if (!p) {
      p = (async () => {
        try {
          const [{ p: info, doc, flat }, profile, desk] = await Promise.all([
            loadPiece(this.sb, this.token, id),
            this.profileText(PROFILE_WITH_PIECE),
            this.deskText(),
          ]);
          doc.destroy();
          // The piece first: past the size limit, the overview is what gets cut.
          return clip([renderPiece(info, flat.text), profile, desk].filter(Boolean).join("\n\n"));
        } catch {
          return null;
        }
      })();
      this.pieces.set(id, p);
    }
    return p;
  }

  /** The piece alone, as someone the student shares their desk with can read it: nothing from the profile. */
  async pieceForGuest(id: string): Promise<string | null> {
    try {
      const { p: info, doc, flat } = await loadPiece(this.sb, this.token, id);
      doc.destroy();
      return clip(renderPiece({ ...info, student: info.student ? { ...info.student, about: "" } : info.student }, flat.text));
    } catch {
      return null;
    }
  }

  strategyText(): Promise<string | null> {
    this.strategy ??= Promise.resolve(this.sb.rpc("connector_strategy", { token: this.token })).then(
      ({ data, error }) =>
        error ? null : clip(renderStrategy(data as StrategyInfo, { match: matchCollege, candidates: catalogCandidates })),
      () => null,
    );
    return this.strategy;
  }

  /** The desk at a glance: every college, deadline and piece. */
  deskText(): Promise<string | null> {
    this.desk ??= loadDeskInfo(this.sb, this.token).then(
      (d) => `# Their whole desk, for context\n${renderDesk(d)}`,
      () => null,
    );
    return this.desk;
  }

  async profileText(max = PROFILE_ALONE): Promise<string | null> {
    const p = await this.loadProfile();
    return p ? profileInContext(p, max) : null;
  }

  /** The context one request needs, or null. */
  async forRequest(r: PendingRequest): Promise<{ key: string; text: string } | null> {
    const needs: Partial<Record<RequestKind, () => Promise<{ key: string; text: string | null }>>> = {
      ask: async () => ({ key: `piece:${r.piece_id}`, text: r.piece_id ? await this.piece(r.piece_id) : null }),
      polish: async () => ({ key: `piece:${r.piece_id}`, text: r.piece_id ? await this.piece(r.piece_id) : null }),
      odds: async () => ({ key: "strategy", text: await this.strategyText() }),
      interview: async () => ({ key: "profile", text: await this.profileText() }),
      transcript: async () => ({ key: "profile", text: await this.profileText() }),
      chat: async () => ({
        key: "overview",
        text: [await this.profileText(), await this.deskText()].filter(Boolean).join("\n\n") || null,
      }),
    };
    const got = await needs[r.kind]?.();
    return got?.text ? { key: got.key, text: got.text } : null;
  }
}

/** What was included, in the form the listing understands. */
function includedFrom(keys: Iterable<string>): NonNullable<ListingOptions["included"]> {
  const pieces = new Set<string>();
  let strategy = false;
  let profile = false;
  for (const k of keys) {
    if (k.startsWith("piece:")) pieces.add(k.slice("piece:".length));
    else if (k === "strategy") strategy = true;
    else if (k === "profile") profile = true;
  }
  return { pieces, strategy, profile };
}

const REPLY_RULES =
  "Your final reply is posted to the student as the answer, so write only that: no preamble before your tool calls, no commentary between them, " +
  "and don't call answer_request. Paragraphs, **bold** and simple \"- \" lists show as formatting.";

/** In every request, so a counselor installed before this was said still hears it. */
export const PROFILE_RULE =
  "The student's profile (read_profile) is the ground truth about them: where a draft, a note or what you remember disagrees with it, " +
  "the profile wins, above all any section of facts they ask you to get right.";

/**
 * One message per request for the counselor, each with its context. A question from someone the
 * student shares their desk with is marked `guest`: the counselor answers it on its own, apart
 * from its conversation and with no tools, from just the essay.
 */
export async function counselorMessages(
  sb: SupabaseClient,
  token: string,
  rows: PendingRequest[],
): Promise<{ id: string; kind: RequestKind; text: string; model: string; guest?: boolean }[]> {
  const ctx = new Context(sb, token);
  return Promise.all(
    rows.map(async (r) => {
      if (r.asked_by?.trim()) {
        const essay = r.piece_id ? await ctx.pieceForGuest(r.piece_id) : null;
        return { id: r.id, kind: r.kind, model: r.model ?? "", guest: true, text: renderGuestQuestion(r, essay) };
      }
      const c = await ctx.forRequest(r);
      const body = renderRequest(r, { answer: "reply", included: includedFrom(c ? [c.key] : []) });
      return {
        id: r.id,
        kind: r.kind,
        model: r.model ?? "",
        text: [`# A request from the student's desk`, body, "", REPLY_RULES, PROFILE_RULE, ...(c ? ["", "---", "", c.text] : [])].join("\n"),
      };
    }),
  );
}

/** The whole list for a chat (watch_desk), with each piece of context once, after the list. */
export async function listWithContext(sb: SupabaseClient, token: string, rows: PendingRequest[]): Promise<string> {
  const ctx = new Context(sb, token);
  const found = new Map<string, string>();
  for (const c of await Promise.all(rows.slice(0, 5).map((r) => ctx.forRequest(r)))) {
    if (c && !found.has(c.key)) found.set(c.key, c.text);
  }
  const list = renderRequestList(rows, { answer: "tool", included: includedFrom(found.keys()) });
  if (!found.size) return list;
  return [list, "", "# Included so you needn't read them first", ...[...found.values()].flatMap((t) => ["", "---", "", t])].join("\n");
}
