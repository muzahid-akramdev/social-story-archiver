import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { checkServerFacebookSessionHealth } from "@/lib/server-fb-session";
import { checkDedicatedFacebookSessionHealth } from "@/lib/dedicated-fb-session";
import { CrawlRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const health = await checkServerFacebookSessionHealth();
  const dedicated = await checkDedicatedFacebookSessionHealth();

  const db = supabaseServer();
  const { data: runs } = await db
    .from("crawl_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);

  const crawlRuns = (runs ?? []) as CrawlRun[];
  const mock = process.env.MOCK_EXTRACTION === "true";

  return (
    <main className="max-w-4xl mx-auto px-6 py-16">
      <Link href="/" className="font-mono text-xs uppercase tracking-widest text-amber">
        &larr; Dashboard
      </Link>

      <h1 className="font-display text-4xl italic mt-4 mb-10">System status</h1>

      <section className="mb-10 border border-paper/15 rounded px-5 py-4">
        <h2 className="font-mono text-xs uppercase tracking-widest text-paper/50 mb-3">
          Extraction
        </h2>
        <dl className="font-mono text-sm space-y-1 text-paper/80">
          <div className="flex justify-between">
            <dt>mode</dt>
            <dd>{mock ? "MOCK (placeholder media, no Facebook calls)" : "live"}</dd>
          </div>
          <div className="flex justify-between">
            <dt>strategy order</dt>
            <dd>
              storyphp-og → session-ssr (dedicated, query-only) →
              session-free → media-endpoint fetch
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>dedicated account session (FB_SESSION_COOKIE)</dt>
            <dd>
              {!dedicated.configured
                ? "not configured — anonymous strategies only; pure/Page stories unreachable"
                : dedicated.status}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>optional server session fallback</dt>
            <dd>
              {!health.configured
                ? "not configured (normal — not required)"
                : health.status}
            </dd>
          </div>
        </dl>
        {dedicated.configured && dedicated.status === "fb_session_expired" && (
          <p className="mt-3 text-rust text-sm">
            The dedicated account session has expired or been
            checkpointed — session-ssr (pure stories, Page stories) is
            down until FB_SESSION_COOKIE is re-supplied from the
            dedicated account. Anonymous strategies are unaffected.
          </p>
        )}
        {dedicated.configured && dedicated.missingCookies.length > 0 && (
          <p className="mt-3 text-rust text-sm">
            The dedicated session cookie is missing expected cookies:{" "}
            {dedicated.missingCookies.join(", ")}. Copy the full
            .facebook.com cookie header from the dedicated account.
          </p>
        )}
        {health.configured && health.status === "fb_session_expired" && (
          <p className="mt-3 text-rust text-sm">
            The optional fallback session has expired. Session-free
            extraction is unaffected; replace the env cookie only if you
            rely on the fallback.
          </p>
        )}
      </section>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-widest text-paper/50 mb-3">
          Recent crawl runs (every 8 hours)
        </h2>
        {crawlRuns.length === 0 ? (
          <p className="text-paper/60 italic font-display text-lg">
            No crawl runs recorded yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {crawlRuns.map((r) => (
              <li
                key={r.id}
                className="border border-paper/15 rounded px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap gap-x-4 font-mono text-xs text-paper/70">
                  <span>{new Date(r.started_at).toLocaleString()}</span>
                  <span>status: {r.status}</span>
                  <span>folders: {r.folders_checked}</span>
                  <span>new stories: {r.new_stories}</span>
                </div>
                {r.error_summary && (
                  <pre className="mt-2 whitespace-pre-wrap text-rust/90 text-xs">
                    {r.error_summary}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
