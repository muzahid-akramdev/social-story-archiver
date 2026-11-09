import "server-only";

/**
 * LEGACY optional server-side Facebook session — a hidden fallback
 * for the generic cookie fetch (extraction strategy 4), NOT a setup
 * requirement. This is NOT the dedicated-account session: that is
 * FB_SESSION_COOKIE in src/lib/dedicated-fb-session.ts, the designed
 * full-coverage path (strategy 2, session-ssr, owner decision
 * 2026-11-10). Keep the two separate — different vars, different
 * strategies.
 *
 * Design goal (spec §5, revised 2026-11-10): extraction must retrieve
 * media WITHOUT registering a "seen" on anyone's account. The primary
 * strategies are session-free (see extraction/facebook.ts strategies
 * 1–2); strategy 3 is a plain HTTP media/page fetch with a cookie,
 * which never loads the story player and never calls Facebook's
 * view-logging mutation — fetching a file and registering a view are
 * separate actions.
 *
 * If an operator ever sets FB_SESSION_COOKIES in the server env, that
 * cookie is passed to strategy 3 as an experiment aid (e.g. reaching a
 * page that login-walls anonymous fetches). Nothing in the UI, setup
 * docs, or checklists asks for it; the app is fully functional in
 * structure without it, and no user's own Facebook account is ever
 * requested for this purpose.
 */

export function getServerFacebookCookie(): string | null {
  const v = process.env.FB_SESSION_COOKIES?.trim();
  return v ? v : null;
}

export type SessionHealth =
  | { configured: false; status: "not_configured" }
  | {
      configured: true;
      status: "ok" | "fb_session_expired" | "unknown";
      checkedAt: string;
    };

let cache: { at: number; value: SessionHealth } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function checkServerFacebookSessionHealth(): Promise<SessionHealth> {
  const cookie = getServerFacebookCookie();
  if (!cookie) return { configured: false, status: "not_configured" };

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value: SessionHealth;
  try {
    const res = await fetch("https://www.facebook.com/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Cookie: cookie,
      },
      redirect: "follow",
    });
    const expired =
      res.url.includes("/login") || res.url.includes("checkpoint");
    value = {
      configured: true,
      status: expired ? "fb_session_expired" : "ok",
      checkedAt: new Date().toISOString(),
    };
  } catch {
    value = {
      configured: true,
      status: "unknown",
      checkedAt: new Date().toISOString(),
    };
  }

  cache = { at: Date.now(), value };
  return value;
}
