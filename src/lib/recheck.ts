import { supabaseServer } from "@/lib/supabase/server";
import { extractStoryMedia } from "@/lib/extraction";
import { syncExtractedMedia, SyncOutcome } from "@/lib/storage";
import { getFacebookCookieForUser } from "@/lib/facebook-session";
import { WatchedLink } from "@/lib/types";

export type RecheckResult =
  | ({ ok: true } & SyncOutcome)
  | { ok: false; error: string }
  | { ok: false; error: "backoff"; skipped: true };

/**
 * Backoff for the automated sweep only — a manual "recheck now" click
 * always goes through, since that's an explicit, rate-limited-by-a-human
 * action. This is what keeps a link that's started failing (blocked,
 * markup changed, story deleted) from being hit on every single scheduled
 * pass forever; it stretches the gap the more it fails in a row.
 *
 * Thresholds are set relative to the ~4h base cron interval (see
 * supabase/migrations/0002_cron.sql) — 3-5 failures stretches to roughly
 * every 3rd cycle, 6+ to roughly daily. If you change the cron interval,
 * revisit these too, since they're meant to be multiples of it rather
 * than fixed in isolation.
 */
export function shouldAttemptRecheck(link: WatchedLink, now = new Date()): boolean {
  if (link.consecutive_failures < 3) return true;
  if (!link.last_checked_at) return true;

  const hoursSinceLastCheck =
    (now.getTime() - new Date(link.last_checked_at).getTime()) / 3600000;

  if (link.consecutive_failures < 6) return hoursSinceLastCheck >= 12;
  return hoursSinceLastCheck >= 24;
}

/**
 * Runs extraction + upload/dedupe for one link, and updates its bookkeeping
 * fields (last_checked_at, consecutive_failures). Used by the immediate
 * trigger on link creation, the manual "recheck now" button, and the
 * scheduled all-links sweep — one code path so behavior can't drift
 * between them.
 *
 * Story archiving now always needs the *owning* user's own Facebook
 * session (API-based fetch never worked — see facebook.ts) rather than a
 * single shared cookie, so this looks that up per link before extracting.
 */
export async function recheckOneLink(link: WatchedLink): Promise<RecheckResult> {
  const db = supabaseServer();

  const cookie = await getFacebookCookieForUser(link.user_id);
  if (!cookie) {
    // Don't count this against consecutive_failures — it's not Facebook
    // rejecting anything, it's a missing prerequisite on our side. Bump
    // last_checked_at anyway so the automated sweep doesn't hammer it.
    await db
      .from("watched_links")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", link.id);
    return {
      ok: false,
      error:
        "No connected Facebook session for this link's owner — connect " +
        "Facebook at /connect-facebook first.",
    };
  }

  const result = await extractStoryMedia(link.source_url, link.platform, cookie);

  if (!result.ok) {
    await db
      .from("watched_links")
      .update({
        last_checked_at: new Date().toISOString(),
        consecutive_failures: link.consecutive_failures + 1,
      })
      .eq("id", link.id);
    return { ok: false, error: result.error };
  }

  const outcome = await syncExtractedMedia(link.id, result.items);

  await db
    .from("watched_links")
    .update({
      last_checked_at: new Date().toISOString(),
      consecutive_failures: 0,
    })
    .eq("id", link.id);

  return { ok: true, ...outcome };
}
