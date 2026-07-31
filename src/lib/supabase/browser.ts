"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Used only for auth (signInWithPassword / signUp / signOut) — never for
 * querying app tables. The app's data access pattern (see supabase/
 * server.ts) stays: browser -> our /api routes -> service-role client.
 * This keeps that guarantee intact while adding real login.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
