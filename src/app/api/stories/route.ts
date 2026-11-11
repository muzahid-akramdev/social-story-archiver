import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { Story, WatchedLink } from "@/lib/types";

const BUCKET = "story-archive";
const MAX_ITEMS = 200;

/**
 * Delete archived stories (user direction, 2026-11-12): removes the
 * stored file(s) — the media file plus its thumbs-path companion
 * (thumbnail for photos, poster for videos) — and the stories row.
 *
 * The stories_seen ledger rows are deliberately KEPT: a deleted story
 * must not silently re-archive on the next crawl while its Facebook
 * original is still live. (After the original expires the ledger row
 * is moot.) Ownership is enforced exactly like the ZIP download:
 * foreign or unknown ids are silently dropped.
 */
export async function DELETE(req: NextRequest) {
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

  // Storage objects first (best effort), then the rows.
  const paths: string[] = [];
  for (const story of owned) {
    paths.push(story.storage_path);
    const dir = story.storage_path.split("/").slice(0, -1).join("/");
    const stem = (story.storage_path.split("/").pop() ?? "").replace(
      /\.[^.]+$/,
      ""
    );
    paths.push(`${dir}/thumbs/${stem}.webp`);
  }
  await db.storage.from(BUCKET).remove(paths);

  const { error: deleteError } = await db
    .from("stories")
    .delete()
    .in(
      "id",
      owned.map((s) => s.id)
    );
  if (deleteError) {
    return NextResponse.json(
      { error: "Delete failed — please try again" },
      { status: 500 }
    );
  }

  return NextResponse.json({ deleted: owned.length });
}
