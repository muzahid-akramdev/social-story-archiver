import { ExtractionResult, MediaItem } from "@/lib/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Core scraper, shared by three call sites now: story archiving, private
 * group video download, and normal public video download. Same parsing
 * logic works for all of them (og:video/og:image + the fbcdn heuristic
 * below) — what differs per call site is only whether a Facebook session
 * cookie is passed in, and whose:
 *   - normal public video: no cookie — content is public, nothing to log
 *     into.
 *   - private group video / story: the requesting app-user's own saved
 *     Facebook session (see src/lib/facebook-session.ts), fetched by the
 *     caller and passed here. Never a shared/global cookie — that's what
 *     used to live in FACEBOOK_SESSION_COOKIE before this became
 *     per-user.
 *
 * Same honesty note as before: this hasn't been run against a live
 * Facebook URL — no network access in the environment this was built in.
 * Verify against a real URL (with and without a cookie) before relying on
 * it. See the two uncertainties flagged below.
 */
export async function fetchAndParseFacebookMedia(
  url: string,
  cookie?: string | null
): Promise<ExtractionResult> {
  if (process.env.MOCK_EXTRACTION === "true") {
    return mockResult(url);
  }

  let html: string;
  let finalUrl: string;

  try {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const res = await fetch(url, { headers, redirect: "follow" });
    finalUrl = res.url;

    if (finalUrl.includes("/login") || res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: cookie
          ? "Facebook redirected to a login wall even with a saved session " +
            "— the cookie has likely expired or been logged out elsewhere. " +
            "Reconnect Facebook and try again."
          : "Facebook redirected to a login wall. This link needs a " +
            "connected Facebook session to reach.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Facebook returned HTTP ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { ok: false, error: `Request failed: ${(err as Error).message}` };
  }

  // Uncertainty #1 (unresolved, same as before this refactor): Facebook
  // pages are heavily client-rendered. A plain HTTP fetch may return only
  // an app shell with no usable media URLs at all, in which case this
  // needs a headless browser (e.g. Playwright) that executes the page's
  // JS first — a bigger change than swapping a function body, and
  // probably a small separate worker rather than a standard Vercel
  // serverless function, since headless Chromium doesn't fit that
  // runtime well.
  const items = parseMediaFromHtml(html);

  if (items.length === 0) {
    return {
      ok: false,
      error:
        "No media found in the response. Most likely cause: the page is " +
        "client-rendered and this fetch only got the app shell — see the " +
        "comment at the top of facebook.ts.",
    };
  }

  return { ok: true, items };
}

/** Backward-compatible name for the story-archiving call site. */
export const extractFacebookStoryMedia = fetchAndParseFacebookMedia;

function parseMediaFromHtml(html: string): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();

  // Pass 1: standard Open Graph tags — reliable for ordinary posts/videos.
  const ogVideo = html.match(/<meta property="og:video(?::secure_url)?" content="([^"]+)"/);
  const ogImage = html.match(/<meta property="og:image(?::secure_url)?" content="([^"]+)"/);
  if (ogVideo) addItem(items, seen, decodeEntities(ogVideo[1]), "video");
  else if (ogImage) addItem(items, seen, decodeEntities(ogImage[1]), "image");

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
  return {
    ok: true,
    items: [
      {
        mediaUrl: `https://picsum.photos/seed/${encodeURIComponent(url)}-${Math.floor(
          Date.now() / 60000
        )}/800/1400`,
        mediaType: "image",
        postedAt: new Date().toISOString(),
        sourceId: `mock-${url}-${Date.now()}`,
      },
    ],
  };
}
