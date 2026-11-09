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

  // ---- Strategy 2: session-ssr (dedicated account, query-only) ------
  // The full-coverage path for pure stories and Page stories. Skipped
  // with a named diagnostic when FB_SESSION_COOKIE is unset — the
  // caller (recheck) passes the cookie in; it is never read from the
  // client and never logged (see redactCookie below).
  if (sessionCookie) {
    const pageUrl = url.includes("/stories/")
      ? url
      : bucketId && storyId
        ? buildStoriesPageUrl(bucketId, storyId)
        : null;
    if (pageUrl && storyId) {
      const viaSession = await fetchViaSessionSsr({
        pageUrl,
        storyId,
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
  storyPhpUrl: string | null;
  cookie: string;
}): Promise<
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string; sessionInvalid: boolean }
> {
  const { pageUrl, storyId, storyPhpUrl, cookie } = args;
  const sessionInvalid = (where: string) => ({
    ok: false as const,
    sessionInvalid: true,
    error:
      "dedicated session invalid/expired or checkpointed — Facebook " +
      `answered the ${where} request with a login/checkpoint page. ` +
      "Re-supply FB_SESSION_COOKIE from the dedicated account.",
  });

  // Leg 1: the authenticated /stories/{bucket}/{token}/ page.
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: cookie,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(SESSION_SSR_TIMEOUT_MS),
    });
    const html = await res.text();
    if (classifySessionResponse(res.url, html) === "invalid") {
      return sessionInvalid("stories page");
    }
    if (res.ok) {
      const items = parseStoryBucketMedia(html, storyId);
      if (items.length > 0) return { ok: true, items };
    }
  } catch (err) {
    return {
      ok: false,
      sessionInvalid: false,
      error: `stories page request failed: ${redactCookie(cookie, (err as Error).message)}`,
    };
  }

  // Leg 2: story.php WITH the session, parsed the same way.
  if (storyPhpUrl) {
    try {
      const res = await fetch(storyPhpUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookie,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(SESSION_SSR_TIMEOUT_MS),
      });
      const html = await res.text();
      if (classifySessionResponse(res.url, html) === "invalid") {
        return sessionInvalid("story.php");
      }
      if (res.ok) {
        const items = parseStoryBucketMedia(html, storyId);
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
  storyId: string
): MediaItem[] {
  if (!html || !storyId) return [];
  const norm = normalizeSsrJson(html);

  const anchors: number[] = [];
  for (const needle of [storyId, `S:_ISC:${storyId}`]) {
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
