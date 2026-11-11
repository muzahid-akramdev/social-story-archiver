import { supabaseServer } from "@/lib/supabase/server";
import { contentHashFromBytes, contentHashFromSourceId } from "@/lib/hash";
import {
  compressImageToTarget,
  makeThumbnail,
  bundleZip,
  archiveZipName,
  ZipEntry,
} from "@/lib/media/pipeline";
import { MediaItem, WatchedLink } from "@/lib/types";

const BUCKET = "story-archive";

export type SyncOutcome = {
  newStories: number;
  skippedDuplicates: number;
  failed: number;
  /** Per-item failure reasons (media type + host + message; never a full signed URL). */
  errors: string[];
  /** Set when this sync produced a ZIP archive (images were bundled). */
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
 * individually (gallery), a 240px thumbnail beside it, and all of this
 * crawl's new images are bundled into ONE ZIP uploaded to
 * {user_id}/{link_id}/{YYYY-MM-DD}/{crawl_id}.zip with an `archives`
 * row recording it (spec storage layout).
 *
 * Videos are stored as the original MP4, individually and in the ZIP
 * (no recompression — no ffmpeg pipeline here).
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

  const zipEntries: ZipEntry[] = [];
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
        // Compress to ≤40 KB, store individually + thumbnail, and hold
        // the compressed bytes for this crawl's ZIP bundle.
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

        zipEntries.push({
          name: `${storyId}.webp`,
          buffer: compressed.buffer,
        });
      } else {
        // Video: store the original individually AND include it in this
        // crawl's ZIP bundle (since 2026-11-12 — previously videos were
        // stored but never zipped, so the downloadable archive held
        // only images). No recompression: no ffmpeg pipeline here.
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

        zipEntries.push({
          name: `${storyId}.mp4`,
          buffer: Buffer.from(bytes),
        });
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

  // Bundle this crawl's new images into one ZIP + archives row.
  if (zipEntries.length > 0) {
    try {
      const zip = await bundleZip(zipEntries);
      const now = new Date();
      const dateDir = now.toISOString().slice(0, 10);
      const zipPath =
        `${link.user_id}/${link.id}/${dateDir}/${ctx.crawlId}.zip`;

      const { error: zipError } = await db.storage
        .from(BUCKET)
        .upload(zipPath, zip, {
          contentType: "application/zip",
          upsert: false,
        });
      if (zipError) throw zipError;

      const { data: archive, error: archiveError } = await db
        .from("archives")
        .insert({
          user_id: link.user_id,
          watched_link_id: link.id,
          crawl_id: ctx.crawlId,
          zip_path: zipPath,
          zip_size_bytes: zip.length,
          story_count: zipEntries.length,
        })
        .select()
        .single();
      if (archiveError) throw archiveError;

      outcome.archiveId = archive.id;
      outcome.zipPath = zipPath;
      outcome.zipSizeBytes = zip.length;

      // Point this crawl's stories_seen rows at the archive they live in.
      if (seenRows.length > 0) {
        await db.from("stories_seen").upsert(
          seenRows.map((r) => ({
            user_id: link.user_id,
            watched_link_id: link.id,
            fb_story_id: r.fb_story_id,
            expires_at: r.expires_at,
            archive_id: archive.id,
          })),
          { onConflict: "watched_link_id,fb_story_id" }
        );
      }
    } catch (err) {
      // The individual stories are already stored; a failed bundle is
      // logged, not fatal to the crawl.
      console.error("archive ZIP bundling failed:", err);
    }
  } else if (seenRows.length > 0) {
    // Videos only (or images whose ZIP failed): still record the ledger.
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
