import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recheckOneLink, shouldAttemptRecheck } from "@/lib/recheck";
import { checkServerFacebookSessionHealth } from "@/lib/server-fb-session";
import { WatchedLink } from "@/lib/types";

export const maxDuration = 300;

/**
 * The 8-hour sweep. Hit by Supabase Cron (pg_net http_post — see
 * supabase/migrations/0005_cron_every_8h.sql for the cron expression),
 * not by a Supabase Edge Function, so the
 * extraction/compression/archive logic lives in exactly one place.
 *
 * v2 behaviour:
 *  - Every sweep writes a `crawl_runs` row (running → success/partial/
 *    error) so the admin page can show what happened, including
 *    fb_session_expired when the optional session fallback is
 *    configured and dead. A session is NOT required — session-free
 *    extraction runs first for every folder (spec §5 revised).
 *  - Folders are processed SEQUENTIALLY with a short delay between
 *    them (spec §4 step 7): gentler on Facebook, and one folder's
 *    failure never blocks the others.
 *  - Backoff (shouldAttemptRecheck) still applies per folder.
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

  const { data: run, error: runError } = await db
    .from("crawl_runs")
    .insert({ status: "running" })
    .select()
    .single();
  if (runError || !run) {
    return NextResponse.json(
      { error: runError?.message ?? "Failed to open crawl run" },
      { status: 500 }
    );
  }

  const errors: string[] = [];

  // Optional-fallback health note only — never a gate. If no server
  // session is configured this returns not_configured and we move on.
  const health = await checkServerFacebookSessionHealth();
  if (health.configured && health.status === "fb_session_expired") {
    errors.push(
      "fb_session_expired: the optional server session cookie is dead; " +
        "session-free extraction still ran for every folder."
    );
  }

  const { data: links, error } = await db
    .from("watched_links")
    .select("*")
    .eq("is_active", true);

  if (error) {
    await db
      .from("crawl_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_summary: error.message,
      })
      .eq("id", run.id);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = (links ?? []) as WatchedLink[];
  const due = all.filter((link) => shouldAttemptRecheck(link));

  let newStories = 0;
  let succeeded = 0;
  let failed = 0;

  for (const link of due) {
    try {
      const result = await recheckOneLink(link, run.id);
      if (result.ok) {
        succeeded++;
        newStories += result.newStories;
        if (result.failed > 0) {
          errors.push(
            `${link.label || link.friend_name}: ${result.failed} item(s) failed to archive`
          );
        }
      } else {
        failed++;
        if ("error" in result) errors.push(`${link.label || link.friend_name}: ${result.error}`);
      }
    } catch (err) {
      failed++;
      errors.push(
        `${link.label || link.friend_name}: ${(err as Error).message}`
      );
    }
    // Short pause between folders — sequential, not a stampede.
    await new Promise((r) => setTimeout(r, 250));
  }

  const status =
    failed === 0 && errors.length === 0
      ? "success"
      : succeeded > 0 || newStories > 0
        ? "partial"
        : due.length === 0
          ? "success"
          : "partial";

  await db
    .from("crawl_runs")
    .update({
      finished_at: new Date().toISOString(),
      status,
      folders_checked: due.length,
      new_stories: newStories,
      error_summary: errors.length > 0 ? errors.join("\n") : null,
    })
    .eq("id", run.id);

  return NextResponse.json({
    crawl_run_id: run.id,
    checked: due.length,
    skippedBackoff: all.length - due.length,
    succeeded,
    failed,
    newStories,
    errors,
  });
}
