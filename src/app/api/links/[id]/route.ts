import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { WatchedLink } from "@/lib/types";

const BUCKET = "story-archive";

/**
 * Delete a folder (watched link) and everything archived under it.
 * DB rows (stories, archives, stories_seen) cascade from watched_links;
 * the storage objects (story media + ZIP bundles) are removed first,
 * best-effort — a storage hiccup must not strand the folder undeletable.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseServer();

  const { data: link, error } = await db
    .from("watched_links")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  if ((link as WatchedLink).user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort storage cleanup (media files + archive ZIPs).
  try {
    const [{ data: storyRows }, { data: archiveRows }] = await Promise.all([
      db.from("stories").select("storage_path").eq("watched_link_id", params.id),
      db.from("archives").select("zip_path").eq("watched_link_id", params.id),
    ]);
    const paths = [
      ...((storyRows ?? []) as { storage_path: string }[]).map((s) => s.storage_path),
      ...((archiveRows ?? []) as { zip_path: string }[]).map((a) => a.zip_path),
    ].filter(Boolean);
    if (paths.length > 0) {
      await db.storage.from(BUCKET).remove(paths);
    }
  } catch {
    // Orphaned files are acceptable; a failed cleanup never blocks delete.
  }

  const { error: delError } = await db
    .from("watched_links")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (delError) {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
