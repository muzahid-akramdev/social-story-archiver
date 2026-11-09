import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { detectPlatform } from "@/lib/extraction";
import { recheckOneLink } from "@/lib/recheck";
import { getAuthUser } from "@/lib/auth";
import {
  resolveFolderIdentity,
  withMockIdentity,
} from "@/lib/resolve-link";
import { FolderType, WatchedLink } from "@/lib/types";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = supabaseServer();

  const { data: links, error } = await db
    .from("watched_links")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Story counts per link, for the card list. Small personal-scale tool,
  // so N+1-ish is fine — swap for a view/RPC if this ever needs to scale.
  const withCounts = await Promise.all(
    (links ?? []).map(async (link) => {
      const { count } = await db
        .from("stories")
        .select("id", { count: "exact", head: true })
        .eq("watched_link_id", link.id);
      return { ...link, story_count: count ?? 0 };
    })
  );

  return NextResponse.json({ links: withCounts });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // v2: NO Facebook session of any kind is a prerequisite for creating a
  // folder. Extraction is session-free first (see extraction/facebook.ts);
  // a connected session, when a user has one, is only a fallback inside
  // recheck. Folder creation must never be gated on it.

  const body = await req.json().catch(() => null);

  if (!body || typeof body.source_url !== "string" || !body.source_url.trim()) {
    return NextResponse.json({ error: "source_url is required" }, { status: 400 });
  }
  // friend_name is optional in v2: when omitted, the folder's label is
  // resolved from the link itself (src/lib/resolve-link.ts). When given,
  // it wins — a human knows the person's name better than a URL does.
  if (body.consent_confirmed !== true) {
    return NextResponse.json(
      {
        error:
          "consent_confirmed must be true — this tool is scoped to people " +
          "who've actually agreed to have their stories archived.",
      },
      { status: 400 }
    );
  }

  const platform = detectPlatform(body.source_url);
  if (!platform) {
    return NextResponse.json(
      { error: "Couldn't detect platform — expected a facebook.com, fb.watch, or instagram.com URL" },
      { status: 400 }
    );
  }
  if (platform === "instagram") {
    return NextResponse.json(
      { error: "Instagram support isn't built yet — Facebook first." },
      { status: 400 }
    );
  }

  const db = supabaseServer();

  // Folder type (migration 0006): chosen with two buttons in the form.
  // Anything that isn't explicitly "page" is a personal profile — the
  // DB default agrees.
  const folderType: FolderType =
    body.folder_type === "page" ? "page" : "personal_profile";

  // Resolve identity from the link: profile links AND story links both
  // work. Story link → fb_bucket_id (+ the story id it points at);
  // profile.php?id= → fb_profile_id; vanity link → username as label.
  const sourceUrl = body.source_url.trim();
  const resolved = withMockIdentity(resolveFolderIdentity(sourceUrl), sourceUrl);

  const friendName =
    typeof body.friend_name === "string" && body.friend_name.trim()
      ? body.friend_name.trim()
      : (resolved.labelGuess ?? "Facebook user");

  const { data: link, error: upsertError } = await db
    .from("watched_links")
    .upsert(
      {
        user_id: user.id,
        source_url: sourceUrl,
        platform,
        friend_name: friendName,
        consent_confirmed: true,
        consent_note: typeof body.consent_note === "string" ? body.consent_note : null,
        label:
          typeof body.label === "string" && body.label.trim()
            ? body.label.trim()
            : friendName,
        fb_bucket_id: resolved.fbBucketId,
        fb_profile_id: resolved.fbProfileId,
        avatar_url: resolved.avatarUrl,
        folder_type: folderType,
      },
      { onConflict: "user_id,source_url", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (upsertError || !link) {
    return NextResponse.json(
      { error: upsertError?.message ?? "Failed to save link" },
      { status: 500 }
    );
  }

  const recheck = await recheckOneLink(link as WatchedLink);

  return NextResponse.json({ link, recheck });
}
