import { createHash } from "crypto";
import { ExtractionResult, MediaItem, StoryFetchContext } from "@/lib/types";
import { resolveFolderIdentity } from "@/lib/resolve-link";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Facebook's own link-crawler UA. Public posts/videos serve their OG
// tags to it without a session (that's how link previews work), so it's
// worth one attempt for story links too.
const CRAWLER_USER_AGENT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

// iPhone Safari UA — REQUIRED by the storyphp-og strategy below: the
// story.php link-preview page is served to mobile UAs, while a desktop
// UA gets HTTP 400 (verified live 2026-11-10).
const IPHONE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 " +
  "Mobile/15E148 Safari/604.1";

/* ------------------------------------------------------------------ */
/* Egress routing for dedicated-session fetches (added 2026-11-10).    */
/*                                                                     */
/* From Vercel's datacenter IPs, the dedicated session's GraphQL POST  */
/* draws Facebook's generic gateway refusal (error 1357004, 249        */
/* bytes) despite a valid session, a fresh fb_dtsg and the full        */
/* Comet boot field set — while page GETs from the same IPs are        */
/* served. When FB_EGRESS_PROXY_URL + FB_EGRESS_PROXY_SECRET are       */
/* set, every dedicated-session fetch below (dtsg bootstrap, bucket    */
/* discovery, stories SSR legs, the GraphQL POST) is tunnelled         */
/* through the fb-egress Cloudflare Worker (worker/fb-egress-          */
/* worker.js), so the facebook.com request leaves from Cloudflare's    */
/* network instead. The Worker is a secret-gated, host-allowlisted     */
/* pipe: same method/headers/body out, raw body + upstream status +    */
/* final URL back. Nothing about the never-seen guard changes — the    */
/* requests themselves are identical, only their egress differs.       */
/* When the env vars are unset, sessionFetch is a plain direct         */
/* fetch and behaviour is exactly as before.                           */
/* ------------------------------------------------------------------ */

type SessionFetchInit = {
  method?: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

type SessionFetchResult = {
  ok: boolean;
  status: number;
  url: string;
  text: () => Promise<string>;
};

function egressProxyConfig(): { url: string; secret: string } | null {
  const url = process.env.FB_EGRESS_PROXY_URL?.trim();
  const secret = process.env.FB_EGRESS_PROXY_SECRET?.trim();
  return url && secret ? { url, secret } : null;
}

async function sessionFetch(
  url: string,
  init: SessionFetchInit
): Promise<SessionFetchResult> {
  const proxy = egressProxyConfig();
  if (!proxy) {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "follow",
      signal: init.signal,
    });
    const bodyText = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url: res.url,
      text: async () => bodyText,
    };
  }
  const proxyRes = await fetch(proxy.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Egress-Secret": proxy.secret,
    },
    body: JSON.stringify({
      url,
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body ?? null,
    }),
    signal: init.signal,
  });
  const bodyText = await proxyRes.text();
  if (!proxyRes.ok) {
    throw new Error(`egress proxy answered HTTP ${proxyRes.status}`);
  }
  const upstreamStatus = Number(
    proxyRes.headers.get("x-egress-upstream-status") ?? proxyRes.status
  );
  return {
    ok: upstreamStatus >= 200 && upstreamStatus < 300,
    status: upstreamStatus,
    url: proxyRes.headers.get("x-egress-final-url") ?? url,
    text: async () => bodyText,
  };
}

/**
 * Facebook media extraction — strategy order (spec §5, revised
 * 2026-11-10). The design goal is to retrieve media WITHOUT registering
 * a "seen": fetching a file and registering a view are separate actions,
 * and nothing here ever loads the story player or calls a view-logging
 * endpoint.
 *
 * Strategy 1 — STORYPHP-OG (OPPORTUNISTIC; verified live 2026-11-10
 *   for post-backed stories; needs a StoryFetchContext with storyId +
 *   ownerId):
 *   A plain anonymous GET of
 *     https://{host}/story.php?story_fbid={storyId}&id={ownerId}
 *   with an iPhone Safari UA. For SOME public personal-profile
 *   stories, Facebook serves the small (~3.5 KB) link-preview page —
 *   og:title = owner name, og:url = .../posts/{storyId}/, og:image /
 *   og:video = the story's own fbcdn media URL. No cookies, no
 *   session, no player — so no "seen" can register. Verified
 *   end-to-end against the app owner's own public story (story
 *   2120893768532144): the og:image downloaded as a 600×600 JPEG,
 *   28 KB, content-checked as the story itself.
 *   OPPORTUNISTIC, NOT GENERAL (verified 2026-11-10 ~01:37): a second
 *   public personal-profile story (1011567334924150, owner
 *   61574630401507) returned the login wall on web/touch/www across
 *   4 attempts, while a control fetch of the first story at the same
 *   moment still returned the OG page. Interpretation: the route
 *   works only when the story resolves to a publicly previewable
 *   POST-LIKE object (the first story's og:url was /posts/{id}/);
 *   a pure story with no post behind it gives a login wall. When
 *   every host login-walls, the strategy reports exactly that —
 *   "story.php preview unavailable for this story (login wall) —
 *   not a post-backed story" — never treat it as a guaranteed route.
 *   Exact recipe and limits:
 *   - Hosts: web.facebook.com and touch.facebook.com work; www/m
 *     return the ~175 KB login page instead. Desktop UA → HTTP 400.
 *   - id= accepts the owner's numeric uid OR vanity username. id=
 *     {bucketId} does NOT work (login wall) — a bucket id is not an
 *     owner id, and a bare story link alone doesn't reveal the owner.
 *   - The media served is the OG PREVIEW rendition: a ≤600×600 square
 *     center-crop for photos, not the full-size 9:16 original. Items
 *     carry a `note` saying so.
 *   - Folder type branches here (migration 0006): personal_profile
 *     folders run this strategy first; page folders get a best-effort
 *     attempt only — Page stories are not publicly previewable
 *     anonymously (research; not yet tested live). For page folders
 *     the full-coverage path is strategy 2 (session-ssr); only when
 *     no dedicated session is configured does a walled attempt end
 *     the crawl at the "page story: anonymous route unavailable"
 *     diagnostic.
 *   If the context is missing the story id or the owner identity, the
 *   strategy is skipped and the reason is folded into the final error
 *   so crawl_runs show exactly what's missing.
 *
 * Strategy 2 — SESSION-SSR (the full-coverage path; owner decision
 *   2026-11-10 — BraveDown's own method): ONE dedicated Facebook
 *   account, created only for this tool, whose session cookie arrives
 *   via the FB_SESSION_COOKIE server env (src/lib/dedicated-fb-
 *   session.ts) and is used QUERY-ONLY: a plain GET of the
 *   authenticated /stories/{bucket}/{token}/ page (desktop UA), whose
 *   SSR payload already embeds every card's media URLs — photo
 *   image.uri (full-size t39.30808-6) and video playable_url_* — which
 *   parseStoryBucketMedia filters to the requested story id. If the
 *   stories page yields nothing, the strategy falls back to
 *   story.php?story_fbid={id}&id={owner} WITH the session and parses
 *   the same way. This is the ONLY strategy that reaches pure stories
 *   (the storyphp-og counterexample) and Page stories, and it is the
 *   page folder's primary path when configured. NEVER-SEEN is a hard
 *   requirement here — see the guard note on fetchViaSessionSsr. A
 *   login/checkpoint answer is reported distinctly as "dedicated
 *   session invalid/expired or checkpointed", never as "no media".
 *   When FB_SESSION_COOKIE is unset the strategy is skipped with the
 *   diagnostic "session strategy not configured (FB_SESSION_COOKIE
 *   unset)". Live verification is PENDING the owner's dedicated
 *   account + cookies (parser verified on synthetic fixtures).
 *
 * Strategy 3 — SESSION-FREE URL FETCH:
 *   Plain GETs of the supplied URL with (a) a browser UA and (b) the
 *   facebookexternalhit crawler UA, parsing Open Graph tags + fbcdn
 *   URLs out of whatever HTML comes back.
 *   Research notes (what's plausible, what the login wall blocks):
 *   - OG tags: reliable for ordinary public POSTS and VIDEOS — the
 *     /download/video route already depends on this and public video
 *     pages do serve og:video anonymously.
 *   - oEmbed (facebook.com/plugins/post/oembed.json): needs an app
 *     access token since the 2020 Graph API lockdown, and never
 *     supported stories. Not usable.
 *   - Graph API story/media nodes: need a user/page access token with
 *     permissions Facebook doesn't grant for other people's stories.
 *     Not usable.
 *   - Stories specifically: the /stories/{bucket}/{token} URL fetched
 *     anonymously redirects to a login wall on every host (verified
 *     live 2026-11-10: browser UA → HTTP 400 / login redirect; crawler
 *     UA → the login page HTML, no story media). Note this login-wall
 *     conclusion is about the /stories/ path — strategy 1 above is the
 *     anonymous route that works for post-backed profile stories. This
 *     strategy stays because it's free, anonymous, works for public
 *     post/video links, and Facebook's anonymous surface changes over
 *     time.
 *
 * Strategy 4 — MEDIA-ENDPOINT FETCH (only if a cookie is available):
 *   The same plain HTTP fetch, with a Cookie header. The cookie can be
 *   a per-user session the app user connected for themselves
 *   (src/lib/facebook-session.ts) or the optional hidden server-side
 *   FB_SESSION_COOKIES env fallback (src/lib/server-fb-session.ts —
 *   a legacy experiment aid, distinct from strategy 2's designed
 *   FB_SESSION_COOKIE). Crucially this is still just a GET of page
 *   HTML/media bytes: it does not execute the story player, does not
 *   paginate a stories tray in a browser, and never calls the GraphQL
 *   mutation the player uses to log a view. A story-PLAYER session
 *   that plays cards and registers views would NOT be acceptable here
 *   and is deliberately not implemented.
 *
 * If all strategies fail, the error says which wall was hit so the
 * next fix is obvious. A login-wall failure on strategy 4 is reported
 * with the `fb_session_expired` prefix so crawl_runs can surface it.
 */
export async function fetchAndParseFacebookMedia(
  url: string,
  cookie?: string | null,
  storyContext?: StoryFetchContext,
  sessionCookie?: string | null
): Promise<ExtractionResult> {
  if (process.env.MOCK_EXTRACTION === "true") {
    return mockResult(url);
  }

  // Effective story identity: the caller's context wins; a story link
  // itself carries the bucket + story id as a fallback (manual fetch).
  const urlIdentity = resolveFolderIdentity(url);
  const storyId =
    storyContext?.storyId?.trim() || urlIdentity.fbStoryId || null;
  const ownerId = storyContext?.ownerId?.trim() || null;
  const bucketId =
    storyContext?.bucketId?.trim() || urlIdentity.fbBucketId || null;
  const isPage = storyContext?.folderType === "page";

  // Strategy diagnostics accumulate here and are folded into any final
  // failure, so crawl_runs show exactly which routes were tried and
  // why each one didn't produce media.
  const notes: string[] = [];
  const withNotes = (error: string): string =>
    notes.length > 0 ? [...notes, error].join(" | ") : error;

  // ---- Strategy 1: storyphp-og (needs story id + owner identity) ----
  // Attempted first whenever a story context was supplied. When it
  // can't run, the reason is kept and folded into any final failure so
  // crawl_runs show exactly which piece of identity is missing.
  if (storyContext) {
    // Folder type (migration 0006): page folders get a best-effort
    // storyphp-og attempt, but its failure is reported with the
    // dedicated "page story: anonymous route unavailable" diagnostic —
    // Page stories are not publicly previewable anonymously, and a
    // crawl must say that instead of failing silently. (When a
    // dedicated session IS configured, strategy 2 below is the page
    // folder's real path and this note is just the anonymous leg.)
    if (storyId && ownerId) {
      const viaStoryPhp = await fetchViaStoryPhpOg(storyId, ownerId);
      if (viaStoryPhp.ok) return viaStoryPhp;
      notes.push(
        isPage
          ? "page story: anonymous route unavailable — best-effort " +
            `storyphp-og attempt failed (${viaStoryPhp.error}); Page ` +
            "stories are not publicly previewable anonymously"
          : `storyphp-og failed: ${viaStoryPhp.error}`
      );
    } else if (isPage) {
      notes.push(
        "page story: anonymous route unavailable — Page stories are " +
          "not publicly previewable anonymously, and this folder lacks " +
          (storyId
            ? "a stored owner identity (fb_profile_id)"
            : "a known story id") +
          " for even a best-effort story.php attempt"
      );
    } else if (storyId && !ownerId) {
      notes.push(
        "storyphp-og skipped: owner id/vanity required for story.php " +
          "route — this folder knows the story id but has no stored owner " +
          "identity (watched_links.fb_profile_id). A story bucket id is " +
          "not an owner id; the owner comes from a profile link."
      );
    } else if (!storyId && ownerId) {
      notes.push(
        "storyphp-og skipped: no story id known for this folder — the " +
          "story.php route fetches one specific story by id, and this " +
          "folder's link doesn't carry one."
      );
    } else {
      notes.push(
        "storyphp-og skipped: owner id/vanity required for story.php " +
          "route, and no story id is known either — neither identity is " +
          "stored for this folder."
      );
    }
  }

  // ---- Strategy 2: session routes (dedicated account, query-only) ---
  // The full-coverage path for pure stories and Page stories. Skipped
  // with a named diagnostic when FB_SESSION_COOKIE is unset — the
  // caller (recheck) passes the cookie in; it is never read from the
  // client and never logged (see redactCookie below).
  //
  // 2a (primary): session-graphql — the story viewer's own bucket
  // prefetcher query (StoriesViewerBucketPrefetcherMultiBucketsQuery),
  // called query-only with the dedicated session. The /stories/ page's
  // SSR does NOT embed a non-tray bucket's media (verified live
  // 2026-11-10 across www/web/m hosts), so the data query is the real
  // path — the same conclusion BraveDown-class services embody. When
  // the folder knows no bucket (profile-link folders), the bucket is
  // first discovered from the profile page's session SSR
  // (profile_header_renderer story_bucket nodes).
  // 2b (fallback): session-ssr page scrape, as before.
  if (sessionCookie) {
    let sessionInvalid = false;

    let gqlBucketId = bucketId;
    if (!gqlBucketId && ownerId) {
      const disc = await discoverStoryBucketId(ownerId, sessionCookie);
      if (disc.bucketId) {
        gqlBucketId = disc.bucketId;
      } else {
        notes.push(`bucket discovery failed: ${disc.error}`);
        if (disc.sessionInvalid) sessionInvalid = true;
      }
    }
    if (gqlBucketId && !sessionInvalid) {
      const viaGql = await fetchViaSessionGraphql({
        bucketId: gqlBucketId,
        cookie: sessionCookie,
        storyId,
        bootstrapHintUrls: [
          ...(storyId ? [buildStoriesPageUrl(gqlBucketId, storyId)] : []),
          ...(ownerId
            ? [
                /^\d+$/.test(ownerId)
                  ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(ownerId)}`
                  : `https://www.facebook.com/${encodeURIComponent(ownerId)}`,
              ]
            : []),
        ],
      });
      if (viaGql.ok) {
        // Video cards reduced to their poster by the bucket query: try
        // ONE upgrade pass through the stories-page SSR leg (its parser
        // hunts playable_url forms the prefetcher response omits)
        // before settling for the poster image. Photo items and the
        // success path are otherwise untouched.
        const posterItems = viaGql.items.filter((i) => i.posterOfVideo);
        if (posterItems.length > 0 && storyId && gqlBucketId) {
          const upgrade = await fetchViaSessionSsr({
            pageUrl: buildStoriesPageUrl(gqlBucketId, storyId),
            storyId,
            bucketId: gqlBucketId,
            storyPhpUrl:
              storyId && ownerId
                ? `https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(storyId)}&id=${encodeURIComponent(ownerId)}`
                : null,
            cookie: sessionCookie,
          });
          if (upgrade.ok) {
            for (const v of upgrade.items) {
              if (v.mediaType !== "video") continue;
              const idx = viaGql.items.findIndex(
                (i) => i.posterOfVideo && i.sourceId === v.sourceId
              );
              if (idx >= 0) {
                // The replaced item's URL is the poster — keep it
                // alongside the video.
                if (!v.posterUrl) v.posterUrl = viaGql.items[idx].mediaUrl;
                viaGql.items[idx] = v;
              }
            }
          }
        }
        return viaGql;
      }
      notes.push(`session-graphql failed: ${viaGql.error}`);
      if (viaGql.sessionInvalid) sessionInvalid = true;
    } else if (!gqlBucketId && !ownerId) {
      notes.push(
        "session-graphql skipped: no bucket id and no owner identity " +
          "for this folder"
      );
    }

    const pageUrl = url.includes("/stories/")
      ? url
      : bucketId && storyId
        ? buildStoriesPageUrl(bucketId, storyId)
        : null;
    if (sessionInvalid) {
      notes.push(
        "session-ssr skipped: the dedicated session was judged " +
          "invalid/expired by the GraphQL route"
      );
    } else if (pageUrl && storyId) {
      const viaSession = await fetchViaSessionSsr({
        pageUrl,
        storyId,
        bucketId,
        storyPhpUrl:
          storyId && ownerId
            ? `https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(storyId)}&id=${encodeURIComponent(ownerId)}`
            : null,
        cookie: sessionCookie,
      });
      if (viaSession.ok) return viaSession;
      notes.push(`session-ssr failed: ${viaSession.error}`);
    } else {
      notes.push(
        "session-ssr skipped: no story id/bucket known for this " +
          "folder — the session strategy fetches one specific story " +
          "bucket, and this folder's link doesn't carry one."
      );
    }
  } else {
    notes.push("session strategy not configured (FB_SESSION_COOKIE unset)");
  }

  // ---- Strategy 3: session-free fetch of the supplied URL -----------
  // Guard: never run the generic page parser against a PROFILE link.
  // A public profile page's og:image is the profile photo, not a story
  // (verified live 2026-11-10: a profile-link folder "found" exactly
  // one item — the poster's profile picture). Profile folders live or
  // die by strategies 1–2; say so honestly instead of archiving the
  // wrong media.
  if (urlIdentity.kind === "profile") {
    return {
      ok: false,
      error: withNotes(
        "profile link: no story media route for a bare profile folder " +
          "yet — the generic page fetch is disabled for profile links " +
          "because a profile page's public media is the profile photo, " +
          "not a story. Add the same person with a story link so the " +
          "session route has a bucket to fetch."
      ),
    };
  }
  const anon = await fetchAndParse(url, null);
  if (anon.ok) return anon;

  // ---- Strategy 4: plain fetch with a cookie, if one exists ---------
  if (cookie) {
    const withCookie = await fetchAndParse(url, cookie);
    if (withCookie.ok) return withCookie;
    if (withCookie.loginWall) {
      return {
        ok: false,
        error: withNotes(
          "fb_session_expired: Facebook redirected to a login wall even " +
            "with a session cookie — it has likely expired or been logged " +
            "out. Session-free extraction was also blocked (see below). " +
            `Session-free result: ${anon.error}`
        ),
      };
    }
    return {
      ok: false,
      error: withNotes(
        `Session-free extraction failed (${anon.error}); ` +
          `fetch with session cookie also failed (${withCookie.error})`
      ),
    };
  }

  return { ok: false, error: withNotes(anon.error) };
}

type FetchOutcome =
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string; loginWall: boolean };

async function fetchAndParse(
  url: string,
  cookie: string | null
): Promise<FetchOutcome> {
  // Without a cookie, try the browser UA first, then the crawler UA.
  // With a cookie, one attempt is enough — UA isn't the blocker there.
  const uas = cookie ? [USER_AGENT] : [USER_AGENT, CRAWLER_USER_AGENT];
  let lastError = "No media found";
  let loginWall = false;

  for (const ua of uas) {
    let html: string;
    let finalUrl: string;
    try {
      const headers: Record<string, string> = {
        "User-Agent": ua,
        "Accept-Language": "en-US,en;q=0.9",
      };
      if (cookie) headers["Cookie"] = cookie;

      const res = await fetch(url, { headers, redirect: "follow" });
      finalUrl = res.url;

      if (finalUrl.includes("/login") || res.status === 401 || res.status === 403) {
        loginWall = true;
        lastError = cookie
          ? "Facebook redirected to a login wall despite the session cookie."
          : "Facebook redirected to a login wall — this URL is not served " +
            "to anonymous fetches (for story links this is the known " +
            "/stories/ path behaviour; see strategy notes at the top of " +
            "facebook.ts).";
        continue;
      }
      if (!res.ok) {
        lastError = `Facebook returned HTTP ${res.status}`;
        continue;
      }
      html = await res.text();
    } catch (err) {
      lastError = `Request failed: ${(err as Error).message}`;
      continue;
    }

    const items = parseMediaFromHtml(html);
    if (items.length > 0) return { ok: true, items };
    // Stories are client-rendered; an app-shell response with no media
    // is the other known failure shape. Record it and try the next UA.
    lastError =
      "No media found in the response — the page appears client-rendered " +
      "and this fetch only got the app shell.";
  }

  return { ok: false, error: lastError, loginWall };
}

/** Backward-compatible name for the story-archiving call site. */
export const extractFacebookStoryMedia = fetchAndParseFacebookMedia;

// Hosts for the storyphp-og strategy, in order. web/touch serve the OG
// preview page to a mobile UA; www/m answer with the login page (they
// stay in the list last — cheap to try, and Facebook's surface shifts).
const STORYPHP_HOSTS = [
  "web.facebook.com",
  "touch.facebook.com",
  "www.facebook.com",
  "m.facebook.com",
] as const;

const STORYPHP_TIMEOUT_MS = 8_000;

// The story.php OG preview page is ~3.5 KB. Anything north of ~50 KB is
// the login page or the app shell, never the preview page.
const OG_PAGE_MAX_BYTES = 50_000;

/**
 * Strategy 1 — storyphp-og (OPPORTUNISTIC — see header comment). One
 * plain anonymous GET per host of
 * story.php?story_fbid={storyId}&id={ownerId} with an iPhone UA,
 * parsing the Open Graph tags out of the link-preview page. Never
 * loads a player, never sends a cookie, never calls any view-logging
 * endpoint — a "seen" cannot register. See the header comment for the
 * verified recipe, the post-backed-only limit, and the counterexample.
 */
async function fetchViaStoryPhpOg(
  storyId: string,
  ownerId: string
): Promise<ExtractionResult> {
  let lastError = "No host returned the OG preview page";
  let attempts = 0;
  let loginWalls = 0;

  for (const host of STORYPHP_HOSTS) {
    const pageUrl =
      `https://${host}/story.php?story_fbid=${encodeURIComponent(storyId)}` +
      `&id=${encodeURIComponent(ownerId)}`;

    attempts++;
    let html: string;
    let finalUrl: string;
    try {
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": IPHONE_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(STORYPHP_TIMEOUT_MS),
      });
      finalUrl = res.url;
      if (!res.ok) {
        lastError = `${host}: HTTP ${res.status}`;
        continue;
      }
      html = await res.text();
    } catch (err) {
      lastError = `${host}: request failed: ${(err as Error).message}`;
      continue;
    }

    if (isLoginWall(finalUrl, html)) {
      loginWalls++;
      lastError = `${host}: login wall`;
      continue;
    }

    const og = parseOgTags(html);
    const videoUrl = og["og:video:secure_url"] ?? og["og:video:url"] ?? og["og:video"];
    const imageUrl = og["og:image:secure_url"] ?? og["og:image"];
    const mediaUrl = videoUrl ?? imageUrl;
    if (!mediaUrl) {
      lastError = `${host}: preview page had no og:image/og:video`;
      continue;
    }

    return {
      ok: true,
      items: [
        {
          mediaUrl,
          mediaType: videoUrl ? "video" : "image",
          sourceId: storyId,
          note: ogPreviewNote(mediaUrl),
        },
      ],
    };
  }

  // Every host login-walled → the distinct diagnostic for the known
  // failure shape: this story doesn't resolve to a publicly
  // previewable post-like object (verified counterexample 2026-11-10,
  // see header comment). Mixed failures keep the last concrete error.
  if (attempts > 0 && loginWalls === attempts) {
    return {
      ok: false,
      error:
        "story.php preview unavailable for this story (login wall) — " +
        "not a post-backed story",
    };
  }

  return { ok: false, error: lastError };
}

function isLoginWall(finalUrl: string, html: string): boolean {
  return (
    finalUrl.includes("/login") ||
    html.includes("Log into Facebook") ||
    html.length > OG_PAGE_MAX_BYTES
  );
}

const SESSION_SSR_TIMEOUT_MS = 15_000;

/**
 * Rebuild a /stories/{bucket}/{token}/ page URL from its parts. The
 * token is the base64 of `S:_ISC:{storyId}` — the exact inverse of
 * decodeStoryPayload in resolve-link.ts (round-trip verified).
 */
export function buildStoriesPageUrl(bucketId: string, storyId: string): string {
  const token = Buffer.from(`S:_ISC:${storyId}`, "utf-8").toString("base64");
  return `https://www.facebook.com/stories/${bucketId}/${token}/`;
}

/**
 * Is this response Facebook bouncing an authenticated request back to
 * a login/checkpoint page? Deliberately NOT the isLoginWall heuristic
 * used by storyphp-og: authenticated pages are legitimately huge, so
 * size says nothing here — only the redirect target and the login
 * page's own marker count. Exported for verification scripts.
 */
export function classifySessionResponse(
  finalUrl: string,
  html: string
): "invalid" | "ok" {
  if (
    finalUrl.includes("/login") ||
    finalUrl.includes("checkpoint") ||
    html.includes("Log into Facebook")
  ) {
    return "invalid";
  }
  return "ok";
}

/**
 * Strategy 2 — session-ssr (dedicated account, query-only).
 *
 * ┌─ NEVER-SEEN GUARD (hard requirement — do not weaken) ──────────┐
 * │ This strategy issues ONLY plain GET page loads (read queries). │
 * │ It must NEVER call any seen/view-logging operation — the       │
 * │ storiesUpdateSeenStateMutation, StoriesReaderUpdateSeenState-  │
 * │ Mutation and CometStoriesSeenMutation family — and NEVER       │
 * │ automate a story player (no headless playback, no card         │
 * │ advancement). Registering a view is a separate action the      │
 * │ player performs; a server that only GETs the page and parses   │
 * │ its SSR payload performs no such action, so the dedicated      │
 * │ account never appears in a poster's viewers list. If a future   │
 * │ change needs an interactive session, it does not belong here.  │
 * └────────────────────────────────────────────────────────────────┘
 *
 * The authenticated stories page's SSR payload embeds every card's
 * media URLs; parseStoryBucketMedia extracts the requested story's.
 * If the stories page yields nothing, one fallback: story.php WITH
 * the session, parsed the same way (plus its OG tags — that page is
 * story-specific, so its og: media IS this story). Login/checkpoint
 * answers are classified distinctly: "dedicated session invalid/
 * expired or checkpointed", never conflated with "no media found".
 */
async function fetchViaSessionSsr(args: {
  pageUrl: string;
  storyId: string;
  bucketId: string | null;
  storyPhpUrl: string | null;
  cookie: string;
}): Promise<
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string; sessionInvalid: boolean }
> {
  const { pageUrl, storyId, bucketId, storyPhpUrl, cookie } = args;
  const sessionInvalid = (where: string) => ({
    ok: false as const,
    sessionInvalid: true,
    error:
      "dedicated session invalid/expired or checkpointed — Facebook " +
      `answered the ${where} request with a login/checkpoint page. ` +
      "Re-supply FB_SESSION_COOKIE from the dedicated account.",
  });

  // Leg 1: the authenticated /stories/{bucket}/{token}/ page, across
  // host variants. The desktop www host serves a client-rendered shell
  // whose SSR payload may not embed a non-tray bucket's media at all
  // (verified live 2026-11-10: authenticated page, zero media near the
  // story id); web/m hosts have historically carried fuller SSR (the
  // same hosts that made storyphp-og work), so try them all before
  // concluding. Only when EVERY host answers login/checkpoint is the
  // session itself judged invalid.
  const hostVariants = Array.from(
    new Set([
      pageUrl,
      pageUrl.replace("www.facebook.com", "web.facebook.com"),
      pageUrl.replace("www.facebook.com", "m.facebook.com"),
    ])
  );
  let leg1Invalid = 0;
  let leg1FetchError: string | null = null;
  for (const variantUrl of hostVariants) {
    try {
      const res = await sessionFetch(variantUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(SESSION_SSR_TIMEOUT_MS),
      });
      const html = await res.text();
      if (classifySessionResponse(res.url, html) === "invalid") {
        leg1Invalid++;
        continue;
      }
      if (res.ok) {
        const items = parseStoryBucketMedia(html, storyId, bucketId);
        if (items.length > 0) return { ok: true, items };
      }
    } catch (err) {
      leg1FetchError = redactCookie(cookie, (err as Error).message);
    }
  }
  if (leg1Invalid === hostVariants.length) {
    return sessionInvalid("stories page");
  }
  if (leg1FetchError && leg1Invalid === 0) {
    return {
      ok: false,
      sessionInvalid: false,
      error: `stories page request failed: ${leg1FetchError}`,
    };
  }

  // Leg 2: story.php WITH the session, parsed the same way.
  if (storyPhpUrl) {
    try {
      const res = await sessionFetch(storyPhpUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(SESSION_SSR_TIMEOUT_MS),
      });
      const html = await res.text();
      if (classifySessionResponse(res.url, html) === "invalid") {
        return sessionInvalid("story.php");
      }
      if (res.ok) {
        const items = parseStoryBucketMedia(html, storyId, bucketId);
        if (items.length > 0) return { ok: true, items };
        // The story.php page is specific to this one story, so its OG
        // media is this story's — full-size payload permitting.
        const og = parseOgTags(html);
        const ogVideo =
          og["og:video:secure_url"] ?? og["og:video:url"] ?? og["og:video"];
        const ogImage = og["og:image:secure_url"] ?? og["og:image"];
        const mediaUrl = ogVideo ?? ogImage;
        if (mediaUrl) {
          return {
            ok: true,
            items: [
              {
                mediaUrl,
                mediaType: ogVideo ? "video" : "image",
                sourceId: storyId,
                note: "Media from the story.php page fetched with the dedicated session (session-ssr fallback leg).",
              },
            ],
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        sessionInvalid: false,
        error: `story.php request failed: ${redactCookie(cookie, (err as Error).message)}`,
      };
    }
  }

  return {
    ok: false,
    sessionInvalid: false,
    error:
      `no media found for story ${storyId} in the authenticated ` +
      "stories page payload — the story may have expired, or the " +
      "dedicated account cannot see it (check its audience: friends-" +
      "only stories need the dedicated account to be friends with " +
      "the poster; Page stories need it to follow the Page)",
  };
}

/* ------------------------------------------------------------------ */
/* Strategy 2a — session-graphql (dedicated account, query-only).      */
/*                                                                     */
/* ┌─ NEVER-SEEN GUARD (hard requirement — do not weaken) ──────────┐ */
/* │ This is a READ query — the same prefetcher the story viewer     │ */
/* │ itself fires to LOAD bucket data. Registering a view is a       │ */
/* │ separate mutation family (storiesUpdateSeenStateMutation,       │ */
/* │ StoriesReaderUpdateSeenStateMutation, CometStoriesSeenMutation) │ */
/* │ that this code must NEVER call. A query-only caller therefore   │ */
/* │ never appears in a poster's viewers list.                       │ */
/* └─────────────────────────────────────────────────────────────────┘ */
/*                                                                     */
/* Query identity (public-source research, 2026-11-10 — see            */
/* ~/workspace/research_notes/fb-stories-graphql-query.md): the name + */
/* doc_id pair is carried identically by a live userscript caller and  */
/* by facebook-cli (HEAD 2026-11-08), which allowlists exactly this    */
/* query for story traffic. doc_ids rotate every few weeks; a          */
/* document-not-found answer is surfaced distinctly so the id can be   */
/* re-harvested by friendly name.                                      */
/* ------------------------------------------------------------------ */

const GRAPHQL_TIMEOUT_MS = 20_000;
const STORIES_BUCKET_QUERY_NAME =
  "StoriesViewerBucketPrefetcherMultiBucketsQuery";
const STORIES_BUCKET_DOC_ID = "9340191609394579";

function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

type SessionProbe =
  | { ok: true }
  | { ok: false; error: string; sessionInvalid: boolean };

/** Mine an fb_dtsg token out of any authenticated page's payload. */
function extractDtsgToken(html: string): string | null {
  const direct =
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1] ??
    html.match(/"DTSGInitialData"[\s\S]{0,300}?"token":"([^"]+)"/)?.[1] ??
    html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/)?.[1] ??
    html.match(/"dtsg"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/)?.[1] ??
    // Mobile-web boot config form (census-verified live 2026-11-10
    // via the Worker egress: the ~48 KB m/touch pages carry a bare
    // "dtsg" key — plain string value, or an object whose first key
    // is not "token").
    html.match(/"dtsg"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"dtsg"\s*:\s*\{[\s\S]{0,120}?"token"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"dtsg"\s*:\s*\{\s*"value"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"fb_dtsg"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"dtsg_token"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/"async_get_token":"([^"]+)"/)?.[1] ??
    html.match(/name="fb_dtsg"\s+value="([^"]+)"/)?.[1] ??
    html.match(/value="([^"]+)"\s+name="fb_dtsg"/)?.[1] ??
    html.match(/name=\\"fb_dtsg\\"\s+value=\\"([^"\\]+)\\"/)?.[1] ??
    null;
  if (direct) return direct;
  // Window fallback: the first "token" value shortly after any DTSG
  // mention — the mobile (m/touch) boot payloads served from some
  // egress networks carry LSD yet name the dtsg structure differently
  // (verified live 2026-11-10 via the Cloudflare Worker egress:
  // ~48 KB authenticated pages, uid + lsd present, no classic keys).
  const idx = html.search(/DTSG/i);
  if (idx >= 0) {
    const win = html.slice(idx, idx + 600);
    return win.match(/"token"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  }
  return null;
}

/**
 * Key census of a page's boot region: the most frequent JSON key
 * names in the first 64 KB plus any key mentioning dtsg/token/async.
 * Key NAMES only — never values — so it can ride in diagnostics.
 */
function bootKeyCensus(html: string): string {
  const sample = html.slice(0, 65_536);
  const counts = new Map<string, number>();
  for (const m of sample.matchAll(/"([A-Za-z_][A-Za-z0-9_]{2,40})"\s*:/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 36)
    .map(([k, c]) => `${k}:${c}`)
    .join(" ");
  const dtsgKeys =
    [...counts.keys()].filter((k) => /dtsg|token|async/i.test(k)).join("|") ||
    "none";
  return `keys=[${top}] dtsgKeys=${dtsgKeys}`;
}

type CometBootstrap = {
  dtsg: string;
  /** Extra Comet request fields mined from the SAME page (lsd, __rev, …). */
  fields: Record<string, string>;
};

/**
 * Mine the full Comet bootstrap set from one authenticated page.
 * A bare fb_dtsg is NOT enough for api/graphql from a cold server
 * POST: Facebook answers error 1357004 ("Sorry, something went
 * wrong") when the request lacks the page's own boot fields
 * (verified live 2026-11-10 — the minimal userscript field set works
 * inside a real browser page, not from a server). The fields below
 * are the set server-side Comet callers mine from the page HTML.
 */
function extractCometBootstrap(html: string): CometBootstrap | null {
  const norm = normalizeSsrJson(html);
  const dtsg = extractDtsgToken(html) ?? extractDtsgToken(norm);
  if (!dtsg) return null;
  const grab = (re: RegExp): string | null => norm.match(re)?.[1] ?? null;
  const fields: Record<string, string> = {};
  const put = (key: string, value: string | null) => {
    if (value) fields[key] = value;
  };
  put("lsd", grab(/"LSD",\[\],\{"token":"([^"]+)"/) ?? grab(/"lsd":"([^"]+)"/));
  put("__rev", grab(/"client_revision":(\d+)/) ?? grab(/"__rev":(\d+)/));
  put("__spin_r", grab(/"__spin_r":(\d+)/));
  put("__spin_b", grab(/"__spin_b":"([^"]+)"/));
  put("__spin_t", grab(/"__spin_t":(\d+)/));
  put("__hsi", grab(/"hsi":"([^"]+)"/));
  put("__hs", grab(/"haste_session":"([^"]+)"/));
  put("__dyn", grab(/"__dyn":"([^"]+)"/));
  put("__csr", grab(/"__csr":"([^"]+)"/));
  // jazoest is derived from the dtsg itself: "2" + sum of char codes.
  const jazoest =
    "2" +
    dtsg
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
      .toString();
  fields.jazoest = jazoest;
  return { dtsg, fields };
}

/**
 * Bootstrap the Comet token set for the dedicated session. Fetched
 * fresh for every crawl — the tokens are session-bound and rotate.
 * The plain homepage is tried but is NOT trusted alone: from
 * datacenter IPs it can be a stripped variant with no boot payload at
 * all (verified live 2026-11-10 — authenticated, yet no
 * DTSGInitialData). Full Comet app pages (the stories page) and the
 * mobile site (hidden fb_dtsg form inputs) carry tokens far more
 * reliably, so all are tried; the FIRST page yielding a dtsg donates
 * the whole set, so every field comes from one consistent page load.
 */
async function fetchFbDtsg(
  cookie: string,
  hintUrls: string[] = []
): Promise<
  | { token: string; fields: Record<string, string> }
  | { error: string; sessionInvalid: boolean }
> {
  const candidates: Array<{ url: string; ua: string }> = [
    ...hintUrls.map((url) => ({ url, ua: USER_AGENT })),
    { url: "https://www.facebook.com/", ua: USER_AGENT },
    { url: "https://web.facebook.com/", ua: USER_AGENT },
    { url: "https://m.facebook.com/", ua: IPHONE_USER_AGENT },
    // Mobile-UA variants of the big hosts + the touch site + the
    // mobile home feed: from some egress networks (Cloudflare IPs,
    // verified live 2026-11-10) the desktop-UA homepages answer
    // HTTP 400 and the m/mbasic pages arrive authenticated yet
    // tokenless, so the donor net is cast wider.
    { url: "https://www.facebook.com/", ua: IPHONE_USER_AGENT },
    { url: "https://web.facebook.com/", ua: IPHONE_USER_AGENT },
    { url: "https://touch.facebook.com/", ua: IPHONE_USER_AGENT },
    { url: "https://m.facebook.com/home.php", ua: IPHONE_USER_AGENT },
    // mbasic is served to almost anything and its forms carry fb_dtsg
    // as a plain hidden input — the most token-friendly surface FB has.
    { url: "https://mbasic.facebook.com/", ua: USER_AGENT },
    { url: "https://mbasic.facebook.com/", ua: IPHONE_USER_AGENT },
  ];
  const uid = cookieValue(cookie, "c_user");
  let sawInvalid = 0;
  let sawOk = 0;
  let keyCensusDone = false;
  const outcomes: string[] = [];
  for (const candidate of candidates) {
    const host = new URL(candidate.url).hostname;
    let html: string;
    let finalUrl: string;
    try {
      const res = await sessionFetch(candidate.url, {
        headers: {
          "User-Agent": candidate.ua,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
      });
      finalUrl = res.url;
      html = await res.text();
      if (!res.ok) {
        outcomes.push(`${host}${candidate.url.includes("stories") ? "/stories" : ""}: HTTP ${res.status}`);
        continue;
      }
    } catch (err) {
      outcomes.push(`${host}: fetch failed`);
      continue;
    }
    if (classifySessionResponse(finalUrl, html) === "invalid") {
      sawInvalid++;
      outcomes.push(`${host}: login/checkpoint`);
      continue;
    }
    sawOk++;
    const boot = extractCometBootstrap(html);
    if (boot) return { token: boot.dtsg, fields: boot.fields };
    // Marker census for the tokenless page (presence/byte counts
    // only — never values): distinguishes "cookie not honoured"
    // (own uid absent) from "page variant carries no token at all".
    const hasLsd = html.includes('"LSD"') || html.includes('"lsd"');
    const markers = [
      `bytes=${html.length}`,
      `uid=${uid ? html.includes(uid) : false}`,
      `dtsgData=${html.includes("DTSGInitialData")}`,
      `dtsgInput=${html.includes('name="fb_dtsg"')}`,
      `lsd=${hasLsd}`,
    ].join(",");
    let outcome = `${host}: authenticated, no token (${markers})`;
    if (hasLsd && !keyCensusDone) {
      keyCensusDone = true;
      outcome += ` ${bootKeyCensus(html)}`;
    }
    outcomes.push(outcome);
  }
  if (sawOk === 0 && sawInvalid > 0) {
    return {
      error:
        "dedicated session invalid/expired or checkpointed — Facebook " +
        "answered the bootstrap pages with login/checkpoint pages. " +
        "Re-supply FB_SESSION_COOKIE from the dedicated account.",
      sessionInvalid: true,
    };
  }
  return {
    error:
      `fb_dtsg token not found on any bootstrap page ` +
      `(egress=${egressProxyConfig() ? "worker" : "direct"}) — ` +
      outcomes.join("; "),
    sessionInvalid: false,
  };
}

/**
 * Structure census of an authenticated profile page, for diagnosing
 * where (if anywhere) the current story bucket id is embedded. Reports
 * JSON key NAMES containing "bucket"/"stor" with occurrence counts,
 * and up to 3 long numeric ids appearing within 120 chars after such a
 * key. Never reports values, tokens or media URLs.
 */
function profilePageCensus(norm: string, ownerId: string): string {
  const keyCounts = new Map<string, number>();
  for (const m of norm.matchAll(
    /"([A-Za-z0-9_]{0,40}?(?:bucket|stor)[A-Za-z0-9_]{0,40}?)"\s*:/gi
  )) {
    const k = m[1];
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  const keys = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, n]) => `${k}×${n}`)
    .join("+");
  const nearIds: string[] = [];
  for (const m of norm.matchAll(/(?:bucket|stor)[\s\S]{0,120}?"?(\d{12,})"?/gi)) {
    if (!nearIds.includes(m[1])) nearIds.push(m[1]);
    if (nearIds.length >= 3) break;
  }
  return (
    `census{ownerOnPage=${norm.includes(ownerId)}, ` +
    `keys=${keys || "none"}, nearStoryIds=${nearIds.join("+") || "none"}}`
  );
}

/**
 * Discover a profile's CURRENT story bucket id from the profile page's
 * session SSR: profile_header_renderer embeds user.story_bucket.nodes[]
 * (bucket id + first story). Query-only GET; no player, no seen call.
 */
async function discoverStoryBucketId(
  ownerId: string,
  cookie: string
): Promise<{
  bucketId: string | null;
  error: string | null;
  sessionInvalid: boolean;
}> {
  // Host/UA variants: www + desktop UA answers HTTP 400 for profile
  // pages from datacenter IPs (verified live 2026-11-10 — the same
  // pattern the anonymous story.php route showed), while web/m hosts
  // serve the page. Try each until one yields an authenticated page.
  const path = /^\d+$/.test(ownerId)
    ? `profile.php?id=${encodeURIComponent(ownerId)}`
    : encodeURIComponent(ownerId);
  const variants: Array<{ url: string; ua: string }> = [
    { url: `https://www.facebook.com/${path}`, ua: USER_AGENT },
    { url: `https://web.facebook.com/${path}`, ua: USER_AGENT },
    { url: `https://m.facebook.com/${path}`, ua: IPHONE_USER_AGENT },
    { url: `https://www.facebook.com/${path}`, ua: IPHONE_USER_AGENT },
    // Lite hosts appended LAST (2026-11-10): the mweb profile page is a
    // shell with no story/bucket keys at all (census-verified), while
    // mbasic/touch serve plain HTML where an active story shows up as a
    // /stories/{bucket}/ link on the profile. Appending keeps every
    // existing variant's behaviour and order untouched.
    { url: `https://mbasic.facebook.com/${path}`, ua: IPHONE_USER_AGENT },
    { url: `https://touch.facebook.com/${path}`, ua: IPHONE_USER_AGENT },
  ];
  const outcomes: string[] = [];
  for (const variant of variants) {
    const host = new URL(variant.url).hostname;
    let html: string;
    let finalUrl: string;
    try {
      const res = await sessionFetch(variant.url, {
        headers: {
          "User-Agent": variant.ua,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookie,
        },
        signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
      });
      finalUrl = res.url;
      html = await res.text();
      if (!res.ok) {
        outcomes.push(`${host}: HTTP ${res.status}`);
        continue;
      }
    } catch (err) {
      outcomes.push(
        `${host}: request failed (${redactCookie(cookie, (err as Error).message)})`
      );
      continue;
    }
    if (classifySessionResponse(finalUrl, html) === "invalid") {
      return {
        bucketId: null,
        error:
          "dedicated session invalid/expired or checkpointed — the " +
          "profile page answered with a login/checkpoint page",
        sessionInvalid: true,
      };
    }
    const norm = normalizeSsrJson(html);
    const bucketId =
      norm.match(
        /"story_bucket"\s*:\s*\{\s*"nodes"\s*:\s*\[[\s\S]{0,240}?"id"\s*:\s*"(\d{6,})"/
      )?.[1] ??
      norm.match(/"story_bucket_id"\s*:\s*"(\d{6,})"/)?.[1] ??
      // The story ring on a profile links straight at the viewer;
      // any /stories/{bucket}/ URL in the page names the bucket.
      norm.match(/\/stories\/(\d{6,})\//)?.[1] ??
      null;
    if (bucketId) return { bucketId, error: null, sessionInvalid: false };
    // Diagnostic census of the FIRST authenticated profile page (key
    // names + candidate ids near story/bucket keys only — no values,
    // no tokens): shows where a bucket id could hide in this layout.
    if (!outcomes.some((o) => o.includes("census{"))) {
      outcomes.push(
        `${host}: authenticated page, no bucket found, ` +
          profilePageCensus(norm, ownerId)
      );
    } else {
      outcomes.push(`${host}: authenticated page, no bucket found`);
    }
  }
  return {
    bucketId: null,
    error:
      "profile bucket discovery found nothing on any host variant — " +
      outcomes.join("; ") +
      " (the person may have no active story, the story ring is not " +
      "visible to the dedicated account, or the layout changed)",
    sessionInvalid: false,
  };
}

/**
 * One query-only POST of the viewer's bucket prefetcher. Returns EVERY
 * card's media in the bucket (each with its own story id for dedupe),
 * full-size renditions preferred.
 */
async function fetchViaSessionGraphql(args: {
  bucketId: string;
  cookie: string;
  bootstrapHintUrls?: string[];
  /** When known, enables the raw-text fallback scan + shape census. */
  storyId?: string | null;
}): Promise<
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string; sessionInvalid: boolean }
> {
  const { bucketId, cookie } = args;

  const dtsg = await fetchFbDtsg(cookie, args.bootstrapHintUrls ?? []);
  if ("error" in dtsg) {
    return { ok: false, error: dtsg.error, sessionInvalid: dtsg.sessionInvalid };
  }
  const uid = cookieValue(cookie, "c_user");
  if (!uid) {
    return {
      ok: false,
      error: "dedicated cookie carries no c_user — cannot form the query",
      sessionInvalid: true,
    };
  }

  const variables = {
    bucketIDs: [bucketId],
    scale: 2,
    blur: 10,
    shouldEnableArmadilloStoryReply: true,
    shouldEnableLiveInStories: true,
    feedbackSource: 65,
    useDefaultActor: false,
    feedLocation: "COMET_MEDIA_VIEWER",
    focusCommentID: null,
    shouldDeferLoad: false,
    isStoriesArchive: false,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
  };
  const bootFieldNames = Object.keys(dtsg.fields).sort().join("+");
  const body = new URLSearchParams({
    av: uid,
    __aaid: "0",
    __user: uid,
    __a: "1",
    __req: "t",
    __comet_req: "1",
    dpr: "1",
    __ccg: "GOOD",
    fb_dtsg: dtsg.token,
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: STORIES_BUCKET_QUERY_NAME,
    variables: JSON.stringify(variables),
    server_timestamps: "true",
    doc_id: STORIES_BUCKET_DOC_ID,
    // The mined boot fields from the same page the dtsg came from
    // (lsd, jazoest, __rev, __spin_*, __hsi, __hs, __dyn, __csr —
    // whichever were present). Without them the endpoint answers
    // error 1357004 to cold server POSTs.
    ...dtsg.fields,
  });

  let text: string;
  try {
    const res = await sessionFetch("https://www.facebook.com/api/graphql/", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Fb-Friendly-Name": STORIES_BUCKET_QUERY_NAME,
        // Comet sends the LSD as a header as well as a form field.
        ...(dtsg.fields.lsd ? { "X-Fb-Lsd": dtsg.fields.lsd } : {}),
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        Origin: "https://www.facebook.com",
        Referer: "https://www.facebook.com/",
        Cookie: cookie,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
    });
    text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `GraphQL bucket query answered HTTP ${res.status}`,
        sessionInvalid: res.status === 401 || res.status === 403,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `GraphQL bucket query request failed: ${redactCookie(cookie, (err as Error).message)}`,
      sessionInvalid: false,
    };
  }

  if (text.includes("/login") && text.includes("Log into Facebook")) {
    return {
      ok: false,
      error:
        "dedicated session invalid/expired — the GraphQL endpoint " +
        "answered with a login page",
      sessionInvalid: true,
    };
  }

  const items = parseGraphqlBucketMedia(text);
  // Video cards the structured parse could only reduce to their poster:
  // give the raw-text window scan (keyed on each card's story id) a
  // chance to find the playable URL elsewhere in this same response
  // before settling for the poster image.
  for (const item of items) {
    if (!item.posterOfVideo || !item.sourceId) continue;
    const scanned = parseStoryBucketMedia(text, item.sourceId, bucketId);
    const vid =
      scanned.find(
        (s) => s.mediaType === "video" && s.sourceId === item.sourceId
      ) ?? scanned.find((s) => s.mediaType === "video");
    if (vid) {
      // The item's current URL is the poster — keep it as the poster.
      if (!item.posterUrl) item.posterUrl = item.mediaUrl;
      item.mediaUrl = vid.mediaUrl;
      item.mediaType = "video";
      item.posterOfVideo = undefined;
      item.note =
        "Video URL recovered by the raw-text scan of the bucket query response (the structured fields carried only the poster).";
    }
  }
  if (items.length > 0) return { ok: true, items };

  // Fallback: the live response's exact nesting may differ from the
  // documented shapes; scan the raw text around the story/bucket ids
  // with the same window parser the SSR legs use.
  if (args.storyId) {
    const scanned = parseStoryBucketMedia(text, args.storyId, bucketId);
    if (scanned.length > 0) return { ok: true, items: scanned };
  }

  const gqlError = firstGraphqlError(text);
  if (gqlError) {
    const rotated = /not found|PersistedQuery|document/i.test(gqlError)
      ? " (the doc_id may have rotated — re-harvest it by the friendly " +
        `name ${STORIES_BUCKET_QUERY_NAME})`
      : "";
    return {
      ok: false,
      error: `GraphQL bucket query error: ${redactCookie(cookie, gqlError)}${rotated}`,
      sessionInvalid: false,
    };
  }

  // A tiny body is a refusal slip, not data — quote it (sanitised:
  // cookie values scrubbed, whitespace collapsed, capped) so the
  // objection is named exactly instead of guessed at.
  const bodySnippet =
    text.length <= 1200
      ? `: body=${redactCookie(cookie, text).replace(/\s+/g, " ").slice(0, 400)}`
      : "";

  // Shape census (counts and key presence only — never URLs or media
  // content): makes the next diagnosis decisive instead of speculative.
  const census = [
    `egress=${egressProxyConfig() ? "worker" : "direct"}`,
    `bootFields=${bootFieldNames || "none"}`,
    `bytes=${text.length}`,
    `bucketIdInResponse=${text.includes(bucketId)}`,
    args.storyId ? `storyIdInResponse=${text.includes(args.storyId)}` : null,
    `hasUnifiedStories=${text.includes("unified_stories")}`,
    `fullSizePhotoMarkers=${(text.match(/t39\.30808-6/g) ?? []).length}`,
    `playableUrlMarkers=${(text.match(/playable_url/g) ?? []).length}`,
    `nodesNull=${/"nodes"\s*:\s*\[\s*null/.test(text)}`,
    `hasData=${/"data"\s*:/.test(text)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    ok: false,
    error:
      `GraphQL bucket query returned no media for bucket ${bucketId} ` +
      `(shape census: ${census}${bodySnippet}) — bucket empty/expired, ` +
      "its audience is not visible to the dedicated account, or the " +
      "response shape differs from the documented one",
    sessionInvalid: false,
  };
}

/** First GraphQL error message across the NDJSON lines, if any. */
function firstGraphqlError(text: string): string | null {
  for (const obj of parseGraphqlLines(text)) {
    const errs = (obj as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errs) && errs.length > 0 && errs[0]?.message) {
      return errs[0].message;
    }
    const single = (
      obj as { error?: { message?: string; summary?: string } }
    ).error;
    if (single?.message) return single.message;
    if (single?.summary) return single.summary;
  }
  return null;
}

/** Parse an api/graphql response: NDJSON lines (after any for(;;); guard). */
function parseGraphqlLines(text: string): Array<Record<string, unknown>> {
  const cleaned = text.replace(/^for \(;;\);/, "").trim();
  const out: Array<Record<string, unknown>> = [];
  for (const line of cleaned.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed && typeof parsed === "object") {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* not a JSON line — skip */
    }
  }
  if (out.length === 0 && cleaned.startsWith("{")) {
    try {
      out.push(JSON.parse(cleaned) as Record<string, unknown>);
    } catch {
      /* leave empty */
    }
  }
  return out;
}

/** Relay node ids for story cards are base64 of `S:_ISC:{numeric id}`. */
function decodeStoryNodeId(id: unknown): string | null {
  if (typeof id !== "string" || !id) return null;
  if (/^\d+$/.test(id)) return id;
  try {
    const decoded = Buffer.from(id, "base64").toString("utf-8");
    const m = decoded.match(/(\d{6,})\s*$/);
    if (m) return m[1];
  } catch {
    /* not base64 */
  }
  return null;
}

type CardMedia = {
  kind: "image" | "video";
  url: string;
  /** The card is a video but only its poster image could be extracted. */
  videoReducedToPoster?: boolean;
  /** For video cards: the poster image URL, when the response has one. */
  posterUrl?: string;
};

/** True for a URL that points at a video file (video CDN host or .mp4). */
function isVideoFileUrl(u: string): boolean {
  return /^https:\/\/video[^"']*\.fbcdn\.net\//.test(u) || /\.mp4(\?|#|$)/.test(u);
}

/**
 * Last-resort hunt for a video file URL anywhere inside a media object
 * (bounded depth): some response shapes nest the playable URL under
 * keys this parser does not name explicitly.
 */
function findVideoUrlDeep(value: unknown, depth: number): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    return value.startsWith("https://") && isVideoFileUrl(value)
      ? value
      : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findVideoUrlDeep(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findVideoUrlDeep(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** One story card node's best media (video beats photo if both ride along). */
function mediaFromStoryCard(node: Record<string, unknown>): CardMedia | null {
  const attachments = node.attachments as
    | Array<{ media?: Record<string, unknown> }>
    | undefined;
  if (!Array.isArray(attachments)) return null;
  let image: CardMedia | null = null;
  let sawVideoMedia = false;
  for (const att of attachments) {
    const media = att?.media;
    if (!media || typeof media !== "object") continue;

    if (
      media.__typename === "Video" ||
      typeof media.playable_url === "string" ||
      media.videoDeliveryResponseFragment != null
    ) {
      sawVideoMedia = true;
    }

    // This media's poster candidate (also the photo, for photo cards):
    // captured BEFORE the video returns so a found video keeps it.
    const imageObj = media.image as { uri?: string } | undefined;
    const uri = imageObj?.uri;
    const posterHere =
      typeof uri === "string" &&
      uri &&
      !uri.includes("t39.30808-1") &&
      !uri.includes("t39.1997-6")
        ? uri
        : null;
    const posterSoFar = posterHere ?? image?.url ?? undefined;
    const asVideo = (url: string): CardMedia => ({
      kind: "video",
      url,
      posterUrl: posterSoFar,
    });

    const playable = media.playable_url;
    if (typeof playable === "string" && playable) {
      return asVideo(playable);
    }
    const frag = media.videoDeliveryResponseFragment as
      | Record<string, unknown>
      | undefined;
    const result = frag?.videoDeliveryResponseResult as
      | Record<string, unknown>
      | undefined;
    const progressive = result?.progressive_urls as
      | Array<{
          progressive_url?: string;
          metadata?: { quality?: string };
        }>
      | undefined;
    if (Array.isArray(progressive) && progressive.length > 0) {
      const hd =
        progressive.find((p) => p.metadata?.quality === "HD") ??
        progressive[0];
      if (hd?.progressive_url) {
        return asVideo(hd.progressive_url);
      }
    }
    for (const key of ["browser_native_hd_url", "browser_native_sd_url"]) {
      const u = media[key];
      if (typeof u === "string" && u) return asVideo(u);
    }
    const deep = findVideoUrlDeep(media, 0);
    if (deep) return asVideo(deep);

    if (posterHere && !image) {
      image = { kind: "image", url: posterHere };
    }
  }
  if (image && sawVideoMedia) {
    // The bucket prefetcher response carries a video card's poster but
    // no playable URL in any named or nested field — flag it so the
    // caller can try to upgrade this item to the real video (raw-text
    // scan / session-ssr leg) instead of silently archiving the poster.
    return { ...image, videoReducedToPoster: true };
  }
  return image;
}

/**
 * Extract every story card's media from a bucket-query response.
 * Handles both documented connection names (unified_stories in the
 * direct API shape, unified_stories_with_notes in the SSR-embedded
 * shape) at any nesting depth. Exported for fixture verification.
 */
export function parseGraphqlBucketMedia(text: string): MediaItem[] {
  const items: MediaItem[] = [];
  const seenCards = new Set<string>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of ["unified_stories", "unified_stories_with_notes"]) {
      const conn = obj[key] as { edges?: unknown } | undefined;
      if (conn && Array.isArray(conn.edges)) {
        for (const edge of conn.edges as Array<{ node?: unknown }>) {
          const node = edge?.node as Record<string, unknown> | undefined;
          if (!node || typeof node !== "object") continue;
          const cardInfo = node.story_card_info as
            | { story_card_id?: string | number }
            | undefined;
          const cardId =
            (cardInfo?.story_card_id != null
              ? String(cardInfo.story_card_id)
              : null) ?? decodeStoryNodeId(node.id);
          if (!cardId || seenCards.has(cardId)) continue;
          const media = mediaFromStoryCard(node);
          if (!media) continue;
          seenCards.add(cardId);
          items.push({
            mediaUrl: media.url,
            mediaType: media.kind,
            sourceId: cardId,
            posterUrl: media.kind === "video" ? media.posterUrl : undefined,
            posterOfVideo: media.videoReducedToPoster || undefined,
            note: media.videoReducedToPoster
              ? "Video story card: the bucket query response carried only the poster image, no playable URL — upgrade to the real video is attempted by the caller."
              : "Full-size media from the session GraphQL bucket query (dedicated account, query-only; no view-logging call is ever made).",
          });
        }
      }
    }
    for (const v of Object.values(obj)) visit(v);
  };

  for (const obj of parseGraphqlLines(text)) visit(obj);
  return items;
}

type BucketCandidate = {
  kind: "image" | "video";
  url: string;
  /** Distance (chars) from the nearest occurrence of the story id. */
  dist: number;
  /** Rendition quality score; higher is the fuller-size rendition. */
  score: number;
};

/**
 * Extract ONE story's media from an authenticated stories page's SSR
 * payload. The payload is a pile of embedded JSON blobs (escape-
 * encoded inside <script> tags) keyed by story id; rather than depend
 * on one exact schema, this scans windows around every occurrence of
 * the requested story id and picks the media candidate nearest to it:
 *
 *   - video: playable_url_quality_hd / playable_url_quality_sd /
 *     playable_url / browser_native_hd_url / browser_native_sd_url
 *   - photo: "image":{"uri":…} objects — full-size t39.30808-6
 *     preferred, larger declared width wins; avatar-class
 *     t39.30808-1 and sticker-class t39.1997-6 URIs are rejected
 *     outright (they appear in the same payloads as owner/commenter
 *     imagery and are never the story's photo).
 *
 * Returns [] when the story id isn't present or carries no media.
 * Exported for fixture verification (no live session needed).
 */
export function parseStoryBucketMedia(
  html: string,
  storyId: string,
  bucketId?: string | null
): MediaItem[] {
  if (!html || !storyId) return [];
  const norm = normalizeSsrJson(html);

  // Anchors: the story id, its token form, and the bucket id — payload
  // blobs group a bucket's cards under the bucket node, whose media may
  // sit nearer the bucket id than any single card's id.
  const needles = [storyId, `S:_ISC:${storyId}`];
  if (bucketId) needles.push(bucketId);
  const anchors: number[] = [];
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const i = norm.indexOf(needle, from);
      if (i === -1) break;
      anchors.push(i);
      from = i + needle.length;
    }
  }
  if (anchors.length === 0) return [];

  const WINDOW = 9_000;
  const candidates: BucketCandidate[] = [];
  const distToAnchor = (idx: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const a of anchors) best = Math.min(best, Math.abs(a - idx));
    return best;
  };

  const videoPatterns: Array<[RegExp, number]> = [
    [/"playable_url_quality_hd"\s*:\s*"(https:[^"]+)"/g, 3],
    [/\"browser_native_hd_url\"\s*:\s*"(https:[^"]+)"/g, 3],
    [/"playable_url"\s*:\s*"(https:[^"]+)"/g, 2],
    [/"playable_url_quality_sd"\s*:\s*"(https:[^"]+)"/g, 1],
    [/\"browser_native_sd_url\"\s*:\s*"(https:[^"]+)"/g, 1],
  ];
  for (const [pattern, score] of videoPatterns) {
    for (const m of norm.matchAll(pattern)) {
      const dist = distToAnchor(m.index ?? 0);
      if (dist > WINDOW) continue;
      candidates.push({ kind: "video", url: m[1], dist, score });
    }
  }

  const imagePattern =
    /"image"\s*:\s*\{\s*"uri"\s*:\s*"([^"]+)"(?:\s*,\s*"width"\s*:\s*(\d+))?(?:\s*,\s*"height"\s*:\s*(\d+))?/g;
  for (const m of norm.matchAll(imagePattern)) {
    const dist = distToAnchor(m.index ?? 0);
    if (dist > WINDOW) continue;
    const url = m[1];
    // Never the story photo: profile/avatar renditions and stickers
    // ride along in the same payloads.
    if (url.includes("t39.30808-1") || url.includes("t39.1997-6")) continue;
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const score = (url.includes("t39.30808-6") ? 1_000_000 : 0) + width;
    candidates.push({ kind: "image", url, dist, score });
  }

  if (candidates.length === 0) return [];

  // A story card is one medium. The class whose best candidate sits
  // nearest the story id wins (payload neighbours bleed into the
  // window); within the winning class, the fuller rendition wins.
  const bestOf = (kind: BucketCandidate["kind"]) =>
    candidates
      .filter((c) => c.kind === kind)
      .sort((a, b) => a.dist - b.dist || b.score - a.score)[0];
  const bestVideo = bestOf("video");
  const bestImage = bestOf("image");
  const winner =
    bestVideo && bestImage
      ? bestVideo.dist <= bestImage.dist
        ? bestVideo
        : bestImage
      : (bestVideo ?? bestImage);
  if (!winner) return [];

  const sameKind = candidates
    .filter((c) => c.kind === winner.kind)
    .sort((a, b) => b.score - a.score || a.dist - b.dist);
  const fullest = sameKind[0];

  return [
    {
      mediaUrl: fullest.url,
      mediaType: fullest.kind,
      sourceId: storyId,
      note: "Full-size media parsed from the authenticated stories page payload (session-ssr — dedicated account, query-only GET; no view-logging call is ever made).",
    },
  ];
}

/**
 * SSR payloads arrive escape-encoded inside script tags
 * (https:\/\/…, \"key\":, &amp; in URLs). Normalise just enough for
 * the key/URL patterns above to match uniformly.
 */
function normalizeSsrJson(html: string): string {
  // Two passes: some payloads are escape-encoded twice (a JSON string
  // inside a JS string inside the HTML).
  let out = html;
  for (let pass = 0; pass < 2; pass++) {
    out = out
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003a/gi, ":")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/&amp;/g, "&");
  }
  return out;
}

/**
 * Scrub a cookie header's values out of text destined for an error
 * string (which lands in crawl_runs). The dedicated session must
 * never be logged — not even inside an upstream error message.
 * (src/lib/dedicated-fb-session.ts has the env-level equivalent for
 * route/admin code; this local copy keeps facebook.ts free of the
 * server-only import so its parsers stay runnable in plain tsx.)
 */
function redactCookie(cookie: string, text: string): string {
  let out = text;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const value = part.slice(eq + 1).trim();
    if (value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out;
}

function ogPreviewNote(mediaUrl: string): string {
  // The verified photo URL carried its rendition size in the query
  // (…&ctp=s600x600&…); surface it when present.
  const dims = mediaUrl.match(/[=_?&]s(\d{2,4})x(\d{2,4})/);
  const size = dims ? ` (${dims[1]}×${dims[2]})` : "";
  return (
    `OG preview rendition${size} served by the story.php link-preview ` +
    "page (storyphp-og) — a preview crop, not the full-size original."
  );
}

/**
 * Parse Open Graph (and twitter:) meta tags into a property → content
 * map. Tolerant of attribute order and quote style — Facebook's preview
 * pages are small and stable, but there's no reason to depend on the
 * exact serialisation. Exported for verification scripts/tests.
 */
export function parseOgTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const prop = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (prop && content && !(prop in out)) {
      out[prop] = decodeEntities(content);
    }
  }
  return out;
}

function parseMediaFromHtml(html: string): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();

  // Pass 1: standard Open Graph tags — reliable for ordinary posts/videos.
  const og = parseOgTags(html);
  const ogVideo = og["og:video:secure_url"] ?? og["og:video:url"] ?? og["og:video"];
  const ogImage = og["og:image:secure_url"] ?? og["og:image"];
  if (ogVideo) addItem(items, seen, ogVideo, "video");
  else if (ogImage) addItem(items, seen, ogImage, "image");

  // Pass 2: heuristic scan for Facebook's CDN media hostnames embedded in
  // the page's script/JSON blobs. Looks for the CDN URL shape directly
  // rather than a specific JSON schema, which would be far more likely to
  // silently break whenever Facebook reshuffles its internal data
  // structures.
  const cdnPattern =
    /https:\\?\/\\?\/(?:scontent[^"'\\]*\.fbcdn\.net|video[^"'\\]*\.fbcdn\.net)[^"'\\]+/g;
  for (const m of html.matchAll(cdnPattern)) {
    const mediaUrl = m[0].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    const mediaType: MediaItem["mediaType"] = /\.(mp4|m4v)(\?|$)/.test(mediaUrl)
      ? "video"
      : "image";
    addItem(items, seen, mediaUrl, mediaType);
  }

  return items;
}

function addItem(
  items: MediaItem[],
  seen: Set<string>,
  mediaUrl: string,
  mediaType: MediaItem["mediaType"]
) {
  if (seen.has(mediaUrl)) return;
  seen.add(mediaUrl);
  items.push({ mediaUrl, mediaType });
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"');
}

function mockResult(url: string): ExtractionResult {
  // Stable per-URL sourceId: re-running a crawl in MOCK mode returns the
  // SAME story, so dedupe (stories_seen + content hash) can be exercised
  // end-to-end — a second crawl must produce nothing new.
  const seed = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return {
    ok: true,
    items: [
      {
        mediaUrl: `https://picsum.photos/seed/${seed}/1080/1920`,
        mediaType: "image",
        postedAt: new Date().toISOString(),
        sourceId: `mock-story-${seed}`,
      },
    ],
  };
}
