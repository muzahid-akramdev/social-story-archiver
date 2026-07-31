import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { Story, WatchedLink } from "@/lib/types";
import StoryGrid, { GalleryItem } from "@/components/StoryGrid";

export const dynamic = "force-dynamic";

const BUCKET = "story-archive";
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough for a viewing session

export default async function FolderPage({ params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const db = supabaseServer();

  const { data: linkRow } = await db
    .from("watched_links")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!linkRow) notFound();
  const link = linkRow as WatchedLink;
  if (link.user_id !== user.id) notFound(); // don't leak existence to other users

  const { data: storyRows } = await db
    .from("stories")
    .select("*")
    .eq("watched_link_id", params.id)
    .order("archived_at", { ascending: false });

  const stories = (storyRows ?? []) as Story[];

  const items: GalleryItem[] = await Promise.all(
    stories.map(async (story) => {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(story.storage_path, SIGNED_URL_TTL_SECONDS);
      return {
        id: story.id,
        mediaType: story.media_type,
        url: signed?.signedUrl ?? "",
        archivedAt: story.archived_at,
      };
    })
  );

  return (
    <main className="max-w-6xl mx-auto px-6 py-16">
      <Link href="/" className="font-mono text-xs uppercase tracking-widest text-amber">
        &larr; All archives
      </Link>

      <header className="mt-4 mb-12">
        <p className="font-mono text-xs uppercase tracking-widest text-paper/50 mb-2">
          {link.platform}
        </p>
        <h1 className="font-display text-4xl italic">
          {link.label || link.friend_name}
        </h1>
        <p className="mt-2 text-paper/60 text-sm">
          {items.length} {items.length === 1 ? "story" : "stories"} kept
        </p>
      </header>

      <StoryGrid items={items.filter((i) => i.url)} />
    </main>
  );
}
