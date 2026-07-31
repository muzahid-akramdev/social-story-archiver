import { supabaseServer } from "@/lib/supabase/server";
import { contentHashFromBytes, contentHashFromSourceId } from "@/lib/hash";
import { MediaItem } from "@/lib/types";

const BUCKET = "story-archive";

export type SyncOutcome = {
  newStories: number;
  skippedDuplicates: number;
  failed: number;
};

/**
 * For one watched link: take whatever extraction currently returned,
 * dedupe against what's already archived, and upload+insert anything new.
 * Safe to call repeatedly with overlapping results — the DB unique
 * constraint on (watched_link_id, content_hash) is the real dedupe
 * guarantee; the pre-check here just avoids pointless downloads.
 */
export async function syncExtractedMedia(
  watchedLinkId: string,
  items: MediaItem[]
): Promise<SyncOutcome> {
  const db = supabaseServer();
  const outcome: SyncOutcome = { newStories: 0, skippedDuplicates: 0, failed: 0 };

  for (const item of items) {
    try {
      const hash = item.sourceId
        ? contentHashFromSourceId(item.sourceId)
        : null; // fall back to hashing bytes below if no stable id

      if (hash) {
        const { data: existing } = await db
          .from("stories")
          .select("id")
          .eq("watched_link_id", watchedLinkId)
          .eq("content_hash", hash)
          .maybeSingle();
        if (existing) {
          outcome.skippedDuplicates++;
          continue;
        }
      }

      const res = await fetch(item.mediaUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const bytes = await res.arrayBuffer();
      const finalHash = hash ?? contentHashFromBytes(bytes);

      const ext = item.mediaType === "video" ? "mp4" : "jpg";
      const storyId = crypto.randomUUID();
      const path = `${watchedLinkId}/${storyId}.${ext}`;

      const { error: uploadError } = await db.storage
        .from(BUCKET)
        .upload(path, bytes, {
          contentType: item.mediaType === "video" ? "video/mp4" : "image/jpeg",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await db.from("stories").insert({
        watched_link_id: watchedLinkId,
        storage_path: path,
        media_type: item.mediaType,
        content_hash: finalHash,
        posted_at: item.postedAt ?? null,
      });

      // Unique constraint racing with a concurrent check for the same link
      // is expected occasionally — treat it as a dedupe hit, not a failure.
      if (insertError) {
        if (insertError.code === "23505") {
          await db.storage.from(BUCKET).remove([path]);
          outcome.skippedDuplicates++;
          continue;
        }
        throw insertError;
      }

      outcome.newStories++;
    } catch (err) {
      console.error("syncExtractedMedia item failed:", err);
      outcome.failed++;
    }
  }

  if (outcome.newStories > 0) {
    await db
      .from("watched_links")
      .update({ last_new_story_at: new Date().toISOString() })
      .eq("id", watchedLinkId);
  }

  return outcome;
}
