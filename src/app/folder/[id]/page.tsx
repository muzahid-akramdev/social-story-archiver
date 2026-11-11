import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { Archive, Story, WatchedLink } from "@/lib/types";
import StoryGrid, { GalleryItem } from "@/components/StoryGrid";
import DeleteFolderButton from "@/components/DeleteFolderButton";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

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

  // v2: this folder's ZIP archives (one per crawl that found new
  // stories), newest first, each with a signed download URL.
  const { data: archiveRows } = await db
    .from("archives")
    .select("*")
    .eq("watched_link_id", params.id)
    .order("created_at", { ascending: false });

  const archiveItems = await Promise.all(
    ((archiveRows ?? []) as Archive[]).map(async (a) => {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(a.zip_path, SIGNED_URL_TTL_SECONDS);
      return { ...a, downloadUrl: signed?.signedUrl ?? "" };
    })
  );

  const items: GalleryItem[] = await Promise.all(
    stories.map(async (story) => {
      const { data: signed } = await db.storage
        .from(BUCKET)
        .createSignedUrl(story.storage_path, SIGNED_URL_TTL_SECONDS);
      // Video stories keep a poster image at the thumbs convention
      // path (see storage.ts) — sign it as the gallery cover.
      let posterUrl: string | undefined;
      if (story.media_type === "video") {
        const dir = story.storage_path.split("/").slice(0, -1).join("/");
        const stem = (story.storage_path.split("/").pop() ?? "").replace(
          /\.[^.]+$/,
          ""
        );
        const { data: posterSigned } = await db.storage
          .from(BUCKET)
          .createSignedUrl(
            `${dir}/thumbs/${stem}.webp`,
            SIGNED_URL_TTL_SECONDS
          );
        posterUrl = posterSigned?.signedUrl ?? undefined;
      }
      return {
        id: story.id,
        mediaType: story.media_type,
        url: signed?.signedUrl ?? "",
        archivedAt: story.archived_at,
        posterUrl,
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
        <div className="mt-4">
          <DeleteFolderButton linkId={link.id} variant="dark" redirectHome />
        </div>
      </header>

      {archiveItems.length > 0 && (
        <section className="mb-14">
          <h2 className="font-mono text-xs uppercase tracking-widest text-paper/50 mb-4">
            ZIP archives from earlier crawls — new stories are kept as
            individual files below; bundle any selection into a ZIP from
            there
          </h2>
          <ul className="space-y-2">
            {archiveItems.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-paper/15 rounded px-4 py-3 text-sm"
              >
                <span className="text-paper/80">
                  {new Date(a.created_at).toLocaleString()}
                </span>
                <span className="font-mono text-xs text-paper/50">
                  {a.story_count} {a.story_count === 1 ? "story" : "stories"} ·{" "}
                  {formatBytes(a.zip_size_bytes)}
                </span>
                {a.downloadUrl && (
                  <a
                    href={a.downloadUrl}
                    className="ml-auto text-amber underline underline-offset-2"
                  >
                    Download ZIP
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <StoryGrid items={items.filter((i) => i.url)} />
    </main>
  );
}
