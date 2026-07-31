import { NextRequest, NextResponse } from "next/server";
import { fetchAndParseFacebookMedia } from "@/lib/extraction/facebook";

/**
 * Normal public Facebook video download. No login, no storage — fetches
 * the direct media URL on demand and hands it back for the browser to
 * download. Only works for genuinely public posts/videos; anything
 * requiring a login wall will come back as an error from the shared
 * extractor.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const result = await fetchAndParseFacebookMedia(body.url.trim());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ items: result.items });
}
