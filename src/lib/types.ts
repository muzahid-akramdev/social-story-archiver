export type Platform = "facebook" | "instagram";

/**
 * Folder type (migration 0006, owner decision 2026-11-10): chosen with
 * two buttons in the add-folder form. Extraction branches on it —
 * personal profiles get the storyphp-og strategy first; Page stories
 * are not publicly previewable anonymously, so page folders rely on
 * the session-ssr strategy (dedicated account, owner decision
 * 2026-11-10) when a session is configured, and otherwise end at an
 * explicit "anonymous route unavailable" crawl diagnostic instead of
 * a silent failure.
 */
export type FolderType = "personal_profile" | "page";

export type WatchedLink = {
  id: string;
  user_id: string;
  source_url: string;
  platform: Platform;
  folder_type: FolderType;
  label: string | null;
  friend_name: string;
  consent_confirmed: boolean;
  consent_note: string | null;
  // v2 (migration 0004): identity resolved from the pasted link —
  // see src/lib/resolve-link.ts. All nullable; resolution is best-effort.
  fb_bucket_id: string | null;
  fb_profile_id: string | null;
  avatar_url: string | null;
  created_at: string;
  last_checked_at: string | null;
  last_new_story_at: string | null;
  consecutive_failures: number;
  is_active: boolean;
};

/** v2: one row per crawl that found new stories (migration 0004). */
export type Archive = {
  id: string;
  user_id: string;
  watched_link_id: string;
  crawl_id: string;
  zip_path: string;
  zip_size_bytes: number;
  story_count: number;
  created_at: string;
};

/** v2: one row per sweep, cron or manual (migration 0004). */
export type CrawlRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "partial" | "error";
  folders_checked: number;
  new_stories: number;
  error_summary: string | null;
};

export type Story = {
  id: string;
  watched_link_id: string;
  storage_path: string;
  media_type: "image" | "video";
  content_hash: string;
  posted_at: string | null;
  archived_at: string;
};

// What an extraction implementation hands back for one currently-live
// story item, before it's been hashed, deduped, or uploaded.
export type MediaItem = {
  mediaUrl: string; // direct, fetchable URL to the image/video
  mediaType: "image" | "video";
  postedAt?: string; // ISO timestamp, if the source exposes one
  sourceId?: string; // a stable per-item id from the source, if available —
  // preferred over hashing the file when present, since it survives the
  // source re-encoding the same media differently between checks
  note?: string; // free-text caveat about what was actually served, e.g.
  // the storyphp-og strategy's OG preview rendition being a ≤600×600
  // square crop rather than the full-size original
  posterOfVideo?: boolean; // true when the source story card IS a video
  // but only its poster image URL was extractable from the response that
  // produced this item — callers may try to upgrade it to the real video
  // via another leg before archiving (added 2026-11-12)
};

/**
 * Per-folder story context for extraction strategies that fetch ONE
 * specific story (storyphp-og and session-ssr in
 * extraction/facebook.ts).
 * - storyId: the fb story id, decoded from the folder's story link
 *   (src/lib/resolve-link.ts). Null for profile-link folders, where no
 *   specific story is known up front.
 * - ownerId: the story owner's numeric uid OR vanity username — the
 *   folder's stored `watched_links.fb_profile_id`, with the vanity from
 *   a profile link as fallback. A story bucket id is NOT an owner id:
 *   story.php?id={bucket} hits the login wall (verified 2026-11-10).
 * - bucketId: the story-set bucket id from the folder's story link
 *   (`watched_links.fb_bucket_id`). session-ssr needs it (with the
 *   story id) to build the /stories/{bucket}/{token} page URL when the
 *   folder's source_url isn't itself a story link.
 * - folderType: the folder's type (migration 0006). For "page"
 *   folders storyphp-og is best-effort only; the full-coverage path
 *   is session-ssr (the dedicated account's session) when configured,
 *   and only when NO session is configured does a page crawl end at
 *   the "page story: anonymous route unavailable" diagnostic.
 */
export type StoryFetchContext = {
  storyId?: string | null;
  ownerId?: string | null;
  bucketId?: string | null;
  folderType?: FolderType | null;
};

export type ExtractionResult =
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string };
