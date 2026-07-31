import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { recheckOneLink } from "@/lib/recheck";
import { getAuthUser } from "@/lib/auth";
import { WatchedLink } from "@/lib/types";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

  const recheck = await recheckOneLink(link as WatchedLink);
  return NextResponse.json({ recheck });
}
