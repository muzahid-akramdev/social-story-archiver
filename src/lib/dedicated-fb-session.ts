import "server-only";

/**
 * The DEDICATED Facebook account session — the full-coverage
 * extraction path (owner decision 2026-11-10, spec §5 strategy 2
 * "session-ssr").
 *
 * The owner chose BraveDown's own method for the stories the
 * anonymous strategies can't reach (pure stories, Page stories): ONE
 * dedicated Facebook account, created only for this tool, whose
 * session the server uses QUERY-ONLY — plain GET page loads whose
 * SSR payload already contains the story media URLs. The strategy
 * never calls any seen/view-logging operation
 * (storiesUpdateSeenStateMutation / StoriesReaderUpdateSeenStateMutation
 * / CometStoriesSeenMutation family) and never automates a story
 * player, so the dedicated account never appears in any poster's
 * viewers list. See the NEVER-SEEN guard note in
 * src/lib/extraction/facebook.ts where the strategy is defined.
 *
 * Configuration is a single server-only env var:
 *
 *   FB_SESSION_COOKIE="c_user=…; xs=…; datr=…; sb=…; fr=…"
 *
 * the full Cookie header for .facebook.com from the dedicated
 * account's logged-in browser. It is NEVER exposed to the client,
 * NEVER written to the database, and NEVER logged — error paths that
 * could embed request details pass through redactCookieValues()
 * below, and the health check returns only a status enum.
 *
 * (The older FB_SESSION_COOKIES env in src/lib/server-fb-session.ts is
 * a separate legacy experiment fallback for the generic cookie fetch;
 * the dedicated session is this module and this var.)
 */

const DEDICATED_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The dedicated account's cookie header, or null when unconfigured. */
export function getDedicatedFacebookCookie(): string | null {
  const v = process.env.FB_SESSION_COOKIE?.trim();
  return v ? v : null;
}

export function isDedicatedSessionConfigured(): boolean {
  return getDedicatedFacebookCookie() !== null;
}

/** Cookie names expected in a complete .facebook.com session header. */
export const EXPECTED_SESSION_COOKIES = [
  "c_user",
  "xs",
  "datr",
  "sb",
  "fr",
] as const;

/**
 * Parse a Cookie header into a name → value map. Internal use only —
 * callers must never serialise the values anywhere (logs, responses,
 * errors). Returns an empty map for a malformed header.
 */
function parseCookieHeader(cookie: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) out.set(name, value);
  }
  return out;
}

/** Names of expected cookies missing from the header (names only). */
export function missingSessionCookies(cookie: string): string[] {
  const present = parseCookieHeader(cookie);
  return EXPECTED_SESSION_COOKIES.filter((n) => !present.has(n));
}

/** The dedicated account's own uid (the c_user value), internal only. */
function dedicatedAccountId(cookie: string): string | null {
  return parseCookieHeader(cookie).get("c_user") ?? null;
}

/**
 * Scrub cookie values out of arbitrary text (error messages, upstream
 * response snippets) before it can reach a log or a crawl_runs row.
 * Replaces every value from the configured session headers (dedicated
 * + legacy) and, defensively, any `name=value` pair for the known
 * Facebook cookie names wherever it appears.
 */
export function redactCookieValues(text: string): string {
  let out = text;
  const headers = [
    process.env.FB_SESSION_COOKIE,
    process.env.FB_SESSION_COOKIES,
  ];
  for (const header of headers) {
    if (!header) continue;
    for (const value of parseCookieHeader(header).values()) {
      if (value.length >= 4) out = out.split(value).join("[redacted]");
    }
  }
  out = out.replace(
    /\b(c_user|xs|datr|sb|fr|presence|wd|dpr)=([^;\s&"']+)/g,
    "$1=[redacted]"
  );
  return out;
}

export type DedicatedSessionHealth =
  | { configured: false; status: "not_configured" }
  | {
      configured: true;
      status: "ok" | "fb_session_expired" | "unknown";
      /** Expected cookie names absent from the header, if any. */
      missingCookies: string[];
      checkedAt: string;
    };

let cache: { at: number; value: DedicatedSessionHealth } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Lightweight liveness check for the dedicated session: one GET of
 * the Facebook home page with the cookie. The session is alive when
 * the response is NOT a login/checkpoint redirect (and carries no
 * login page) and the page embeds the account's own c_user id (the
 * logged-in home page always carries CurrentUserInitialData with it).
 * Returns status only — never cookie values, never the account id.
 */
export async function checkDedicatedFacebookSessionHealth(): Promise<DedicatedSessionHealth> {
  const cookie = getDedicatedFacebookCookie();
  if (!cookie) return { configured: false, status: "not_configured" };

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const missingCookies = missingSessionCookies(cookie);
  let value: DedicatedSessionHealth;
  try {
    const res = await fetch("https://www.facebook.com/", {
      headers: { "User-Agent": DEDICATED_UA, Cookie: cookie },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    const accountId = dedicatedAccountId(cookie);
    const bounced =
      res.url.includes("/login") ||
      res.url.includes("checkpoint") ||
      html.includes("Log into Facebook");
    const seesSelf = accountId !== null && html.includes(accountId);
    value = {
      configured: true,
      status: bounced
        ? "fb_session_expired"
        : seesSelf
          ? "ok"
          : "unknown",
      missingCookies,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    value = {
      configured: true,
      status: "unknown",
      missingCookies,
      checkedAt: new Date().toISOString(),
    };
  }

  cache = { at: Date.now(), value };
  return value;
}
