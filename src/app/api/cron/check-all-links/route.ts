import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recheckOneLink, shouldAttemptRecheck } from "@/lib/recheck";
import { WatchedLink } from "@/lib/types";

/**
 * Hit on a schedule by Supabase Cron (pg_net http_post — see
 * supabase/migrations/0002_cron.sql), not by a Supabase Edge Function.
 * Doing the sweep here instead of in a Deno Edge Function means the
 * extraction/upload/dedupe logic lives in exactly one place, in one
 * runtime, instead of being duplicated between Next.js and Deno.
 *
 * Guarded by a shared secret because this URL is public — anyone who
 * finds it could otherwise trigger a full sweep on demand.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  const { data: links, error } = await db
    .from("watched_links")
    .select("*")
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = ((links ?? []) as WatchedLink[]).filter((link) =>
    shouldAttemptRecheck(link)
  );

  const results = await Promise.allSettled(due.map((link) => recheckOneLink(link)));

  const summary = {
    checked: due.length,
    skippedBackoff: (links?.length ?? 0) - due.length,
    succeeded: results.filter((r) => r.status === "fulfilled" && r.value.ok).length,
    failed: results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length,
  };

  return NextResponse.json(summary);
}
