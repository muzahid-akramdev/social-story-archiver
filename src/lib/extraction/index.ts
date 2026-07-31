import { Platform, ExtractionResult } from "@/lib/types";
import { fetchAndParseFacebookMedia } from "./facebook";

/**
 * The one function the rest of the app calls. `cookie`, if given, is a
 * specific app-user's own saved Facebook session (see
 * src/lib/facebook-session.ts) — never a shared/global one.
 */
export async function extractStoryMedia(
  url: string,
  platform: Platform,
  cookie?: string | null
): Promise<ExtractionResult> {
  switch (platform) {
    case "facebook":
      return fetchAndParseFacebookMedia(url, cookie);
    case "instagram":
      return {
        ok: false,
        error: "Instagram extraction isn't built yet (Facebook first).",
      };
  }
}

export function detectPlatform(url: string): Platform | null {
  const host = safeHostname(url);
  if (!host) return null;
  if (host.includes("facebook.com") || host.includes("fb.watch"))
    return "facebook";
  if (host.includes("instagram.com")) return "instagram";
  return null;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
