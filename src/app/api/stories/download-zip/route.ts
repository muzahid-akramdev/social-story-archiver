import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { bundleZip, ZipEntry } from "@/lib/media/pipeline";
import { Story, WatchedLink } from "@/lib/types";

const BUCKET = "story-archive";
const MAX_ITEMS = 200;

/**
 * On-demand ZIP download (user direction, 2026-11-12): stories are
 * stored as native files (WebP images / MP4 videos); a ZIP exists only
 * as a download-time bundle of whatever the user selected in the
 * archive browser. POST { storyIds: string[] } → one .zip attachment
 * containing exactly those stories, each in its native format.
 *
 * Ownership: every requested story must belong to a folder owned by
 * the caller — foreign or unknown ids are silently dropped, and an
 * empty effective selection is a 404.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storyIds?: unknown };
  try {
    body = (await req.json()) as { storyIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawIds = Array.isArray(body.storyIds) ? body.storyIds : [];
  const storyIds = [
    ...new Set(rawIds.filter((x): x is string => typeof x === "string")),
  ].slice(0, MAX_ITEMS);
  if (storyIds.length === 0) {
    return NextResponse.json(
      { error: "No stories selected" },
      { status: 400 }
    );
  }

  const db = supabaseServer();

  const { data: storyRows } = await db
    .from("stories")
    .select("*")
    .in("id", storyIds);
  const stories = (storyRows ?? []) as Story[];
  if (stories.length === 0) {
    return NextResponse.json({ error: "No stories found" }, { status: 404 });
  }

  // Ownership check via the parent folders.
  const linkIds = [...new Set(stories.map((s) => s.watched_link_id))];
  const { data: linkRows } = await db
    .from("watched_links")
    .select("id, user_id")
    .in("id", linkIds);
  const ownedLinkIds = new Set(
    ((linkRows ?? []) as Pick<WatchedLink, "id" | "user_id">[])
      .filter((l) => l.user_id === user.id)
      .map((l) => l.id)
  );
  const owned = stories.filter((s) => ownedLinkIds.has(s.watched_link_id));
  if (owned.length === 0) {
    return NextResponse.json({ error: "No stories found" }, { status: 404 });
  }

  const entries: ZipEntry[] = [];
  for (const story of owned) {
    const { data: blob, error } = await db.storage
      .from(BUCKET)
      .download(story.storage_path);
    if (error || !blob) continue;
    const base = story.storage_path.split("/").pop() ?? `${story.id}`;
    const datePrefix = (story.archived_at ?? "").slice(0, 10);
    entries.push({
      name: datePrefix ? `${datePrefix}_${base}` : base,
      buffer: Buffer.from(await blob.arrayBuffer()),
    });
  }
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Selected files could not be read" },
      { status: 500 }
    );
  }

  const zip = await bundleZip(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="stories-${stamp}.zip"`,
      "Content-Length": String(zip.length),
    },
  });
}
