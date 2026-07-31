import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  saveFacebookCookie,
  removeFacebookCookie,
  facebookSessionStatus,
} from "@/lib/facebook-session";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await facebookSessionStatus(user.id));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.cookie !== "string" || !body.cookie.trim()) {
    return NextResponse.json({ error: "cookie is required" }, { status: 400 });
  }

  // Cheap sanity check only, not a real verification — a login-wall
  // response the next time extraction actually runs is the real signal
  // that the cookie is invalid/expired. This just catches obviously
  // wrong pastes (e.g. only one cookie name, or a copy-paste mistake).
  if (!body.cookie.includes("c_user")) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a full Facebook cookie — it should " +
          "include c_user among others. In your browser, while logged " +
          "into Facebook: DevTools → Application/Storage → Cookies → " +
          "facebook.com, and copy the full Cookie header value (or use " +
          "a 'copy cookies' extension) rather than a single cookie name.",
      },
      { status: 400 }
    );
  }

  await saveFacebookCookie(user.id, body.cookie.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await removeFacebookCookie(user.id);
  return NextResponse.json({ ok: true });
}
