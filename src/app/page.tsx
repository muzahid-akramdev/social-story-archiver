import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { WatchedLink } from "@/lib/types";
import LinkForm from "@/components/LinkForm";
import LinkCard from "@/components/LinkCard";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

async function getLinksWithCounts(userId: string) {
  const db = supabaseServer();
  const { data: links } = await db
    .from("watched_links")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const withCounts = await Promise.all(
    (links ?? []).map(async (link) => {
      const { count } = await db
        .from("stories")
        .select("id", { count: "exact", head: true })
        .eq("watched_link_id", link.id);
      return { ...(link as WatchedLink), story_count: count ?? 0 };
    })
  );

  return withCounts;
}

function LogoMark() {
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#E9C766] via-amber to-amber-dim shadow-lg shadow-amber/30">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <circle cx="12" cy="12" r="7.25" fill="none" stroke="#FFF9EC" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.5" fill="#FFF9EC" />
        </svg>
      </span>
      <span className="font-display text-lg leading-none tracking-tight text-paper">
        Story <span className="italic text-gold-grad">Archive</span>
      </span>
    </span>
  );
}

const navPill =
  "hidden rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-paper/60 transition-colors hover:border-white/25 hover:text-paper md:inline-flex";

export default async function HomePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login"); // middleware already covers this; belt and suspenders

  const links = await getLinksWithCounts(user.id);
  const totalStories = links.reduce((sum, link) => sum + link.story_count, 0);

  return (
    <div className="relative min-h-screen">
      <div className="film-grain" aria-hidden="true" />

      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-darkroom/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
          <LogoMark />
          <nav className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest">
            <Link
              href="/connect-facebook"
              className="hidden rounded-full border border-amber/30 bg-amber/10 px-3.5 py-1.5 text-amber transition-colors hover:bg-amber/20 md:inline-flex"
            >
              Connect Facebook
            </Link>
            <Link href="/admin" className={navPill}>System status</Link>
            <Link href="/download/video" className={navPill}>Download video</Link>
            <Link href="/download/group" className={navPill}>Download group video</Link>
            <span className="ml-2"><SignOutButton /></span>
          </nav>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 pb-20">
        <section className="grid items-center gap-14 pb-16 pt-14 sm:pt-20 sm:pb-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="animate-rise flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-amber">
              <span className="h-px w-10 bg-amber/60" aria-hidden="true" />
              Private story vault — crawls every 8 hours
            </p>
            <h1
              className="animate-rise mt-6 font-display text-5xl leading-[1.04] sm:text-6xl xl:text-7xl"
              style={{ animationDelay: "90ms" }}
            >
              Stories vanish in 24 hours.
              <span className="block pb-2 italic text-gold-grad">Yours don&rsquo;t.</span>
            </h1>
            <p
              className="animate-rise mt-6 font-display text-xl italic text-paper/85"
              style={{ animationDelay: "170ms" }}
            >
              A kept box, not a broadcast.
            </p>
            <p
              className="animate-rise mt-3 max-w-xl leading-relaxed text-paper/65"
              style={{ animationDelay: "240ms" }}
            >
              For the handful of people who&rsquo;ve actually said yes — every
              folder here exists because someone gave permission. Their
              stories are fetched without ever registering a view, compressed
              small, and zipped into a private vault only you can open. No
              seen. No trace.
            </p>

            <div
              className="animate-rise mt-10 flex flex-wrap gap-3"
              style={{ animationDelay: "320ms" }}
            >
              <div className="glass-panel min-w-[9.5rem] px-5 py-4">
                <p className="font-display text-4xl text-paper">{links.length}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper/50">
                  Folders tracked
                </p>
              </div>
              <div className="glass-panel min-w-[9.5rem] px-5 py-4">
                <p className="font-display text-4xl text-paper">{totalStories}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper/50">
                  Stories kept
                </p>
              </div>
              <div className="glass-panel min-w-[9.5rem] px-5 py-4">
                <p className="font-display text-4xl text-paper">
                  8<span className="italic text-gold-grad">h</span>
                </p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper/50">
                  Sweep cadence
                </p>
              </div>
            </div>
          </div>

          {/* Decorative fanned prints — pure CSS, no real stories. */}
          <div
            className="animate-rise relative hidden h-[470px] lg:block"
            style={{ animationDelay: "220ms" }}
            aria-hidden="true"
          >
            <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber/15 blur-3xl" />
            <div className="film-frame absolute left-2 top-10 w-60" style={{ transform: "rotate(-8deg)" }}>
              <div className="h-52 bg-[linear-gradient(160deg,#2E2440,#B0532A_58%,#D4A72C)]" />
              <div className="flex items-center gap-2 pt-2.5">
                <span className="story-ring">
                  <span className="block h-6 w-6 rounded-full bg-[linear-gradient(140deg,#E9C766,#B0532A)]" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
                  golden hour — kept
                </span>
              </div>
            </div>
            <div className="film-frame absolute right-0 top-0 w-56" style={{ transform: "rotate(6deg)" }}>
              <div className="h-44 bg-[linear-gradient(150deg,#14201A,#7A9471_62%,#22301F)]" />
              <div className="flex items-center gap-2 pt-2.5">
                <span className="story-ring">
                  <span className="block h-6 w-6 rounded-full bg-[linear-gradient(140deg,#A8C3A0,#3E5C34)]" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
                  night market — 23:41
                </span>
              </div>
            </div>
            <div className="film-frame absolute bottom-0 left-28 w-64" style={{ transform: "rotate(-2deg)" }}>
              <div className="h-48 bg-[radial-gradient(circle_at_32%_22%,#E9C766,#8A5A17_46%,#1C1917_82%)]" />
              <div className="flex items-center gap-2 pt-2.5">
                <span className="story-ring">
                  <span className="block h-6 w-6 rounded-full bg-[radial-gradient(circle_at_35%_30%,#E9C766,#8A5A17)]" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
                  safelight — no. 04
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="animate-rise mb-16" style={{ animationDelay: "150ms" }}>
          <div className="glass-panel p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl text-paper">Add a folder</h2>
              <span className="font-mono text-[10px] uppercase tracking-widest text-paper/40">
                New folder — checked every 8 hours
              </span>
            </div>
            <LinkForm />
          </div>
        </section>

        <section>
          <div className="mb-6 flex items-end justify-between gap-4 border-b border-white/[0.06] pb-4">
            <h2 className="font-display text-2xl text-paper">
              {links.length === 0
                ? "Nothing archived yet"
                : `Tracking ${links.length} ${links.length === 1 ? "person" : "people"}`}
            </h2>
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper/40">
              The kept box
            </span>
          </div>

          {links.length === 0 ? (
            <div className="glass-panel glass-panel-dashed px-8 py-14 text-center">
              <p className="font-display text-xl italic text-paper/75">
                Add the first link above once someone&rsquo;s said it&rsquo;s okay.
              </p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-paper/40">
                The shelf is empty — for now
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {links.map((link, i) => (
                <div
                  key={link.id}
                  className="animate-rise h-full"
                  style={{ animationDelay: `${Math.min(i * 90, 540)}ms` }}
                >
                  <LinkCard link={link} />
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 font-mono text-[10px] uppercase tracking-widest text-paper/35">
          <span>Story Archive — kept, not broadcast</span>
          <span>Anonymous by design · No seen, ever</span>
        </footer>
      </main>
    </div>
  );
}
