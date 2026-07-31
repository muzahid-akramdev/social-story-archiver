export type Platform = "facebook" | "instagram";

export type WatchedLink = {
  id: string;
  user_id: string;
  source_url: string;
  platform: Platform;
  label: string | null;
  friend_name: string;
  consent_confirmed: boolean;
  consent_note: string | null;
  created_at: string;
  last_checked_at: string | null;
  last_new_story_at: string | null;
  consecutive_failures: number;
  is_active: boolean;
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
};

export type ExtractionResult =
  | { ok: true; items: MediaItem[] }
  | { ok: false; error: string };
