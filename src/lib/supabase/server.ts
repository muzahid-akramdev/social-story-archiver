import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server-only (API routes, Server Components, the
 * Edge Function) — never import this from a Client Component or ship it
 * to the browser. There's intentionally no browser-side Supabase client
 * in this app: the client never talks to Supabase directly, only to our
 * own /api routes, so RLS having zero anon/authenticated policies (see
 * migration 0001) actually means something.
 */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
