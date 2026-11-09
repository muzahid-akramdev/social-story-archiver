import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { checkServerFacebookSessionHealth } from "@/lib/server-fb-session";
import { checkDedicatedFacebookSessionHealth } from "@/lib/dedicated-fb-session";
import { CrawlRun } from "@/lib/types";

/**
 * Admin status: extraction mode + session health + recent crawl runs.
 *
 * Auth-gated (any logged-in user of this personal-scale deployment —
 * tighten to an owner allowlist before opening sign-ups publicly).
 * Two sessions are reported, both as STATUS ONLY — this endpoint
 * never returns cookie values or account ids:
 *   - `dedicated_session`: the FB_SESSION_COOKIE dedicated account
 *     that powers strategy 2 (session-ssr, owner decision 2026-11-10).
 *     `not_configured` is a supported state — the anonymous strategies
 *     still run; full coverage (pure stories, Pages) needs it.
 *   - `server_session_fallback`: the legacy optional FB_SESSION_COOKIES
 *     experiment fallback (server-fb-session.ts).
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [health, dedicated] = await Promise.all([
    checkServerFacebookSessionHealth(),
    checkDedicatedFacebookSessionHealth(),
  ]);

  const db = supabaseServer();
  const { data: runs } = await db
    .from("crawl_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    extraction: {
      mode: process.env.MOCK_EXTRACTION === "true" ? "mock" : "live",
      strategy_order: [
        "storyphp-og (anonymous, opportunistic)",
        "session-ssr (dedicated account, query-only — no view-logging)",
        "session-free",
        "media-endpoint fetch (no view-logging)",
      ],
      dedicated_session: dedicated,
      server_session_fallback: health,
    },
    recent_crawl_runs: (runs ?? []) as CrawlRun[],
  });
}
