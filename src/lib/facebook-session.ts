import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export async function saveFacebookCookie(userId: string, cookie: string) {
  const db = supabaseServer();
  const { error } = await db.from("facebook_sessions").upsert({
    user_id: userId,
    cookie_encrypted: encryptSecret(cookie),
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getFacebookCookieForUser(
  userId: string
): Promise<string | null> {
  const db = supabaseServer();
  const { data } = await db
    .from("facebook_sessions")
    .select("cookie_encrypted")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  try {
    return decryptSecret(data.cookie_encrypted);
  } catch {
    return null; // corrupt/undecryptable — treat as not connected
  }
}

export async function removeFacebookCookie(userId: string) {
  const db = supabaseServer();
  await db.from("facebook_sessions").delete().eq("user_id", userId);
}

export async function facebookSessionStatus(userId: string) {
  const db = supabaseServer();
  const { data } = await db
    .from("facebook_sessions")
    .select("verified_at")
    .eq("user_id", userId)
    .maybeSingle();

  return { connected: !!data, verifiedAt: data?.verified_at ?? null };
}
