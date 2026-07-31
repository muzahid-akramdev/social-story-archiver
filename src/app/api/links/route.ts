import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { detectPlatform } from "@/lib/extraction";
import { recheckOneLink } from "@/lib/recheck";
import { getAuthUser } from "@/lib/auth";
import { facebookSessionStatus } from "@/lib/facebook-session";
import { WatchedLink } from "@/lib/types";

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

  // Story fetching always needs this user's own Facebook session (no API
  // path works — see facebook.ts), so check upfront rather than letting
  // it fail confusingly during the recheck below.
  const fbStatus = await facebookSessionStatus(user.id);
  if (!fbStatus.connected) {
    return NextResponse.json(
      {
        error:
          "Connect your Facebook account first at /connect-facebook — " +
          "story archiving needs your own logged-in session.",
      },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);

  if (!body || typeof body.source_url !== "string" || !body.source_url.trim()) {
    return NextResponse.json({ error: "source_url is required" }, { status: 400 });
  }
  if (typeof body.friend_name !== "string" || !body.friend_name.trim()) {
    return NextResponse.json(
      { error: "friend_name is required — whose stories these are" },
      { status: 400 }
    );
  }
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

  const { data: link, error: upsertError } = await db
    .from("watched_links")
    .upsert(
      {
        user_id: user.id,
        source_url: body.source_url.trim(),
        platform,
        friend_name: body.friend_name.trim(),
        consent_confirmed: true,
        consent_note: typeof body.consent_note === "string" ? body.consent_note : null,
        label: typeof body.label === "string" ? body.label : null,
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
