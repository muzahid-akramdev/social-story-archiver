import { supabaseServer } from "@/lib/supabase/server";
import { contentHashFromBytes, contentHashFromSourceId } from "@/lib/hash";
import {
  compressImageToTarget,
  makeThumbnail,
  archiveZipName,
} from "@/lib/media/pipeline";
import { MediaItem, WatchedLink } from "@/lib/types";

const BUCKET = "story-archive";

export type SyncOutcome = {
  newStories: number;
  skippedDuplicates: number;
  failed: number;
  /** Per-item failure reasons (media type + host + message; never a full signed URL). */
  errors: string[];
  /** Legacy fields: crawls no longer bundle ZIPs (see header), so
   * these stay null/0 — kept so existing callers keep compiling. */
  archiveId: string | null;
  zipPath: string | null;
  zipSizeBytes: number;
};

export type SyncContext = {
  /** crawl_runs.id for cron sweeps; a fresh uuid for manual rechecks. */
  crawlId: string;
};

/**
 * v2 sync for one folder (= watched link): dedupe → compress → store.
 *
 * Dedupe has two layers:
 *  1. `stories_seen` keyed by fb_story_id — checked BEFORE downloading,
 *     so a repeat crawl costs no bandwidth (spec §4 step 2).
 *  2. `stories.content_hash` unique constraint — the v1 guarantee,
 *     still the backstop for items with no stable source id.
 *
 * New IMAGES go through the ≤40 KB adaptive WebP pipeline
 * (src/lib/media/pipeline.ts): the compressed file is stored
 * individually (gallery), a 240px thumbnail beside it. Videos are
 * stored as the original MP4, individually.
 *
 * Storage form is the native file itself (user direction, 2026-11-12):
 * crawls no longer bundle a per-crawl ZIP. ZIPs are produced on demand
 * at download time (POST /api/stories/download-zip) for any selection
 * of stories. `archives` rows from earlier crawls remain downloadable
 * from the folder page.
 */
export async function syncExtractedMedia(
  link: WatchedLink,
  items: MediaItem[],
  ctx: SyncContext
): Promise<SyncOutcome> {
  const db = supabaseServer();
  const outcome: SyncOutcome = {
    newStories: 0,
    skippedDuplicates: 0,
    failed: 0,
    errors: [],
    archiveId: null,
    zipPath: null,
    zipSizeBytes: 0,
  };

  const seenRows: {
    fb_story_id: string;
    expires_at: string | null;
  }[] = [];

  for (const item of items) {
    try {
      // Layer 1: story-id ledger — skip before any download.
      if (item.sourceId) {
        const { data: seen } = await db
          .from("stories_seen")
          .select("id")
          .eq("watched_link_id", link.id)
          .eq("fb_story_id", item.sourceId)
          .maybeSingle();
        if (seen) {
          outcome.skippedDuplicates++;
          continue;
        }
      }

      const hash = item.sourceId
        ? contentHashFromSourceId(item.sourceId)
        : null;

      if (hash) {
        const { data: existing } = await db
          .from("stories")
          .select("id")
          .eq("watched_link_id", link.id)
          .eq("content_hash", hash)
          .maybeSingle();
        if (existing) {
          outcome.skippedDuplicates++;
          continue;
        }
      }

      // CDN media URLs are signed but host-checked: fbcdn answers a
      // bare server fetch with 403 often enough that a browser UA +
      // Facebook referer is the reliable shape. A plain GET of a CDN
      // file never registers a story view.
      const res = await fetch(item.mediaUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Referer: "https://www.facebook.com/",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const finalHash = hash ?? contentHashFromBytes(bytes);
      const storyId = crypto.randomUUID();

      if (item.mediaType === "image") {
        // Compress to ≤40 KB, store individually + thumbnail.
        const compressed = await compressImageToTarget(bytes);
        if (compressed.bytes > 40 * 1024) {
          console.warn(
            `image for link ${link.id} stayed above 40 KB after all steps ` +
              `(${compressed.bytes} bytes) — archived anyway`
          );
        }
        const path = `${link.user_id}/${link.id}/${storyId}.webp`;
        const { error: uploadError } = await db.storage
          .from(BUCKET)
          .upload(path, compressed.buffer, {
            contentType: "image/webp",
            upsert: false,
          });
        if (uploadError) throw uploadError;

        const thumb = await makeThumbnail(bytes);
        await db.storage
          .from(BUCKET)
          .upload(`${link.user_id}/${link.id}/thumbs/${storyId}.webp`, thumb, {
            contentType: "image/webp",
            upsert: true,
          });

        const { error: insertError } = await db.from("stories").insert({
          watched_link_id: link.id,
          storage_path: path,
          media_type: "image",
          content_hash: finalHash,
          posted_at: item.postedAt ?? null,
        });
        if (insertError) {
          if (insertError.code === "23505") {
            await db.storage.from(BUCKET).remove([path]);
            outcome.skippedDuplicates++;
            continue;
          }
          throw insertError;
        }

      } else {
        // Video: store the original MP4 individually. No
        // recompression: no ffmpeg pipeline here.
        const path = `${link.user_id}/${link.id}/${storyId}.mp4`;
        const { error: uploadError } = await db.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: "video/mp4", upsert: false });
        if (uploadError) throw uploadError;

        const { error: insertError } = await db.from("stories").insert({
          watched_link_id: link.id,
          storage_path: path,
          media_type: "video",
          content_hash: finalHash,
          posted_at: item.postedAt ?? null,
        });
        if (insertError) {
          if (insertError.code === "23505") {
            await db.storage.from(BUCKET).remove([path]);
            outcome.skippedDuplicates++;
            continue;
          }
          throw insertError;
        }
      }

      outcome.newStories++;
      if (item.sourceId) {
        seenRows.push({ fb_story_id: item.sourceId, expires_at: null });
      }
    } catch (err) {
      console.error("syncExtractedMedia item failed:", err);
      outcome.failed++;
      let host = "unknown-host";
      try {
        host = new URL(item.mediaUrl).hostname;
      } catch {
        /* keep placeholder */
      }
      outcome.errors.push(
        `${item.mediaType} via ${host}: ${(err as Error).message}`.slice(0, 300)
      );
    }
  }

  // Record the dedupe ledger for this crawl's new stories. No ZIP is
  // bundled at crawl time — native files are the storage form, and
  // ZIPs are generated on demand at download time.
  if (seenRows.length > 0) {
    await db.from("stories_seen").upsert(
      seenRows.map((r) => ({
        user_id: link.user_id,
        watched_link_id: link.id,
        fb_story_id: r.fb_story_id,
        expires_at: r.expires_at,
        archive_id: outcome.archiveId,
      })),
      { onConflict: "watched_link_id,fb_story_id" }
    );
  }

  if (outcome.newStories > 0) {
    await db
      .from("watched_links")
      .update({ last_new_story_at: new Date().toISOString() })
      .eq("id", link.id);
  }

  return outcome;
}

export { archiveZipName };
