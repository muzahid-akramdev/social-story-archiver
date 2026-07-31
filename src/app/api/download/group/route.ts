import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getFacebookCookieForUser } from "@/lib/facebook-session";
import { fetchAndParseFacebookMedia } from "@/lib/extraction/facebook";

/**
 * Private Facebook-group video download. Requires the app user to be
 * logged in AND to have a connected Facebook session (see
 * /connect-facebook) — group content isn't reachable logged-out. No
 * storage: fetches the direct media URL on demand, same as the public
 * video download route, just with the caller's own cookie attached.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookie = await getFacebookCookieForUser(user.id);
  if (!cookie) {
    return NextResponse.json(
      { error: "Connect your Facebook account first at /connect-facebook." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const result = await fetchAndParseFacebookMedia(body.url.trim(), cookie);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ items: result.items });
}
