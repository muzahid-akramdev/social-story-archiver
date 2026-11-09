import { supabaseServer } from "@/lib/supabase/server";
import { extractStoryMedia } from "@/lib/extraction";
import { syncExtractedMedia, SyncOutcome } from "@/lib/storage";
import { getFacebookCookieForUser } from "@/lib/facebook-session";
import { getServerFacebookCookie } from "@/lib/server-fb-session";
import { getDedicatedFacebookCookie } from "@/lib/dedicated-fb-session";
import { resolveFolderIdentity } from "@/lib/resolve-link";
import { StoryFetchContext, WatchedLink } from "@/lib/types";

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
 * Thresholds are relative to the 8h cron interval (v2, migration 0005):
 * 3–5 consecutive failures stretches to ~24h, 6+ to ~48h. (In v1 these
 * were tuned to the 4h interval — 12h/24h — and scaled up with it.)
 */
export function shouldAttemptRecheck(link: WatchedLink, now = new Date()): boolean {
  if (link.consecutive_failures < 3) return true;
  if (!link.last_checked_at) return true;

  const hoursSinceLastCheck =
    (now.getTime() - new Date(link.last_checked_at).getTime()) / 3600000;

  if (link.consecutive_failures < 6) return hoursSinceLastCheck >= 24;
  return hoursSinceLastCheck >= 48;
}

/**
 * Runs extraction + compress/archive for one folder, and updates its
 * bookkeeping fields. One code path for link creation, the manual
 * "recheck now" button, and the scheduled sweep.
 *
 * Strategy order (spec §5): storyphp-og (anonymous, opportunistic) →
 * session-ssr (dedicated account, query-only) → session-free fetch →
 * cookie media-endpoint fetch.
 *
 * Two different cookies ride along, for two different strategies:
 *   - The DEDICATED account session (FB_SESSION_COOKIE, see
 *     src/lib/dedicated-fb-session.ts) powers strategy 2 (session-ssr)
 *     — the full-coverage path for pure stories and Page stories,
 *     chosen by the owner on 2026-11-10 (BraveDown's own method). It
 *     is used query-only and never registers a seen. Unset → the
 *     strategy is skipped with the diagnostic "session strategy not
 *     configured (FB_SESSION_COOKIE unset)".
 *   - A generic cookie is passed only as the strategy-4 fallback, in
 *     this precedence:
 *       1. the optional hidden server env session (FB_SESSION_COOKIES),
 *          else
 *       2. the folder owner's own connected session (v1 feature), else
 *       3. null — no cookie fetch.
 * No session is a prerequisite for the anonymous strategies: with none
 * configured, recheck simply runs them and reports honestly.
 *
 * Story context for strategies 1–2: the story id is decoded from the
 * folder's own source_url when it's a story link; the owner identity
 * is the folder's stored fb_profile_id (migration 0004 — a uid from
 * profile.php links), falling back to the vanity username when the
 * folder was created from a vanity profile link; the bucket id comes
 * from the story link / fb_bucket_id column so session-ssr can build
 * the /stories/ page URL. A folder created from a bare story link has
 * NO owner identity (a bucket id is not an owner id) — extraction then
 * reports the storyphp-og skip reason in its error instead of failing
 * silently.
 * The folder type (migration 0006) rides along too: extraction
 * branches on it — personal_profile → storyphp-og first, then
 * session-ssr; page → storyphp-og best-effort, then session-ssr is
 * the page path when a session is configured; only with NO session
 * does a page crawl end at the "page story: anonymous route
 * unavailable" diagnostic. Rows predating 0006 read as
 * personal_profile.
 */
export async function recheckOneLink(
  link: WatchedLink,
  crawlId?: string
): Promise<RecheckResult> {
  const db = supabaseServer();

  const cookie =
    getServerFacebookCookie() ?? (await getFacebookCookieForUser(link.user_id));

  const identity = resolveFolderIdentity(link.source_url);
  const storyContext: StoryFetchContext = {
    storyId: identity.fbStoryId,
    ownerId:
      link.fb_profile_id ??
      (identity.kind === "profile" ? identity.labelGuess : null),
    bucketId: link.fb_bucket_id ?? identity.fbBucketId,
    folderType: link.folder_type ?? "personal_profile",
  };

  const result = await extractStoryMedia(
    link.source_url,
    link.platform,
    cookie,
    storyContext,
    getDedicatedFacebookCookie()
  );

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

  const outcome = await syncExtractedMedia(link, result.items, {
    crawlId: crawlId ?? crypto.randomUUID(),
  });

  await db
    .from("watched_links")
    .update({
      last_checked_at: new Date().toISOString(),
      consecutive_failures: 0,
    })
    .eq("id", link.id);

  return { ok: true, ...outcome };
}
