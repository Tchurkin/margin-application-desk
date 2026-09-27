import { bridgeMissing } from "@/lib/bridge/requests";
import type { PendingRequest } from "@/lib/bridge/listing";
import { counselorMessages } from "@/lib/connector/context";
import { db, validToken } from "@/lib/connector/tools";

/*
 * The counselor on the student's computer (src/lib/counselor/installer.ts) fetches its work here:
 * the requests given to it (a desk can have a counselor on several computers, and each request
 * goes to one), each as one message with the context it needs (the piece, the college list, the
 * profile), so Claude can answer without reading first.
 */

export const maxDuration = 30;

/** How many requests one fetch returns; the rest come on the next. */
const BATCH = 10;

/**
 * JSON with every non-ASCII character escaped, so Windows PowerShell 5.1 reads it right whatever
 * encoding it assumes for the response.
 */
function asciiJson(data: unknown, status = 200) {
  const body = JSON.stringify(data).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/counselor/[token]">) {
  const { token } = await ctx.params;
  if (!validToken(token)) return asciiJson({ error: "Not found." }, 404);
  const sb = db();
  let { data, error } = await sb.rpc("connector_counselor_requests", { token });
  // A database before migration 20261017: every waiting request, as before.
  if (error && bridgeMissing(error)) ({ data, error } = await sb.rpc("connector_requests", { token }));
  if (error) return asciiJson({ error: error.message }, /not valid/i.test(error.message) ? 403 : 500);
  const rows = ((data as PendingRequest[] | null) ?? []).slice(0, BATCH);
  return asciiJson({ requests: await counselorMessages(sb, token, rows) });
}
