import { validToken } from "@/lib/connector/tools";
import { macInstaller } from "@/lib/counselor/mac-installer";
import { supabaseEnv } from "@/lib/supabase/env";

/*
 * The Mac counselor's setup, for the one line Settings → Counselor shows to paste into Terminal:
 *   /bin/bash -c "$(curl -fsSL '<site>/api/counselor/<token>/setup')"
 * Braxton's call (9/27/26): a file downloaded in a browser is held back by macOS until it's
 * allowed in System Settings; what Terminal fetches isn't. The script checks for itself whether
 * its link is still on (an older line says so and changes nothing).
 */

export async function GET(request: Request, ctx: RouteContext<"/api/counselor/[token]/setup">) {
  const { token } = await ctx.params;
  // A script that says so: curl -f would drop the body of an error response, and bash would run nothing.
  if (!validToken(token))
    return new Response("echo 'This setup line is not valid. Copy it again from Settings > Counselor.'; exit 1\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  const { url, key } = supabaseEnv();
  const script = macInstaller({ site: new URL(request.url).origin, supabaseUrl: url, supabaseKey: key, token });
  return new Response(script, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
