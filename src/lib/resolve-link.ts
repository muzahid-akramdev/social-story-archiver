/**
 * Folder-by-link resolution (v2 §3/§6): a folder is created by pasting
 * EITHER a Facebook profile link or a story link. This module extracts
 * everything that is knowable from the URL alone — no network, no
 * session — and returns it in the shape `watched_links` stores
 * (label / fb_bucket_id / fb_profile_id / avatar_url).
 *
 * What a URL alone can and cannot tell us:
 *  - Story link  facebook.com/stories/{bucketId}/{base64}
 *      → fb_bucket_id = bucketId (the story-set owner id)
 *      → the base64 payload decodes to `S:_ISC:{storyId}`, giving the
 *        specific story's fb_story_id as a bonus.
 *  - Profile link facebook.com/profile.php?id={id}
 *      → fb_profile_id = id
 *  - Vanity link facebook.com/{username}
 *      → the username (used as label guess; the numeric id is NOT
 *        derivable without a lookup — see TODO below).
 *  - Display name / avatar for bucket & vanity links are NOT in the URL.
 *
 * TODO (live resolution): with extraction working, resolve name/avatar
 * from the story/profile page's OG tags or `graph.facebook.com`
 * picture endpoint and backfill. Until then MOCK mode and manual
 * friend_name (the create form still accepts an optional name) fill the
 * label, and avatar_url stays null — the UI already handles a missing
 * avatar by falling back to initials.
 */

export type ResolvedFolderIdentity = {
  kind: "story" | "profile" | "unknown";
  fbBucketId: string | null;
  fbProfileId: string | null;
  /** Set only for story links: the specific story the link points at. */
  fbStoryId: string | null;
  /** Best label guess from the URL alone; null if none. */
  labelGuess: string | null;
  avatarUrl: string | null;
};

export function resolveFolderIdentity(rawUrl: string): ResolvedFolderIdentity {
  const out: ResolvedFolderIdentity = {
    kind: "unknown",
    fbBucketId: null,
    fbProfileId: null,
    fbStoryId: null,
    labelGuess: null,
    avatarUrl: null,
  };

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return out;
  }

  const segments = url.pathname.split("/").filter(Boolean);

  // Story link: /stories/{bucketId}/{payload}
  if (segments[0] === "stories" && segments.length >= 2) {
    out.kind = "story";
    out.fbBucketId = segments[1] ?? null;
    if (segments[2]) {
      out.fbStoryId = decodeStoryPayload(segments[2]);
    }
    return out;
  }

  // Profile link with explicit id: /profile.php?id=123…
  if (segments[0] === "profile.php") {
    const id = url.searchParams.get("id");
    if (id) {
      out.kind = "profile";
      out.fbProfileId = id;
      return out;
    }
  }

  // Vanity profile link: /{username} — skip Facebook's own app paths.
  const RESERVED = new Set([
    "watch", "reel", "reels", "groups", "events", "marketplace",
    "gaming", "pages", "story.php", "photo.php", "videos", "share",
  ]);
  if (segments.length === 1 && !RESERVED.has(segments[0])) {
    out.kind = "profile";
    out.labelGuess = segments[0];
    return out;
  }

  return out;
}

/**
 * Story payloads look like `UzpfSVNDOjIxMjA4OTM3Njg1MzIxNDQ=` →
 * base64 → `S:_ISC:2120893768532144`. Returns the numeric story id, or
 * null if the payload doesn't decode to anything recognisable.
 */
export function decodeStoryPayload(payload: string): string | null {
  try {
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    const m = decoded.match(/(\d{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function isMockMode(): boolean {
  return process.env.MOCK_EXTRACTION === "true";
}

/**
 * In MOCK mode there is no Facebook to ask, so synthesize a stable
 * placeholder identity: label from the resolver's guess (or a short
 * bucket/profile fragment), avatar from a deterministic placeholder
 * service. Live mode returns the resolver's result untouched.
 */
export function withMockIdentity(
  resolved: ResolvedFolderIdentity,
  rawUrl: string
): ResolvedFolderIdentity {
  if (!isMockMode()) return resolved;
  const seed =
    resolved.fbBucketId ?? resolved.fbProfileId ?? resolved.labelGuess ?? rawUrl;
  return {
    ...resolved,
    labelGuess:
      resolved.labelGuess ?? `Mock user ${String(seed).slice(0, 6)}`,
    avatarUrl:
      resolved.avatarUrl ??
      `https://i.pravatar.cc/96?u=${encodeURIComponent(String(seed))}`,
  };
}
