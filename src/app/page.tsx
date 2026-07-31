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

export default async function HomePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login"); // middleware already covers this; belt and suspenders

  const links = await getLinksWithCounts(user.id);

  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      <nav className="flex flex-wrap items-center gap-4 mb-8 font-mono text-xs uppercase tracking-widest">
        <Link href="/connect-facebook" className="text-amber">Connect Facebook</Link>
        <Link href="/download/video" className="text-paper/60 hover:text-paper">Download video</Link>
        <Link href="/download/group" className="text-paper/60 hover:text-paper">Download group video</Link>
        <span className="ml-auto"><SignOutButton /></span>
      </nav>

      <header className="mb-12 text-center sm:text-left">
        <p className="font-mono text-xs uppercase tracking-widest text-amber mb-2">
          Story Archive
        </p>
        <h1 className="font-display text-4xl sm:text-5xl italic">
          A kept box, not a broadcast.
        </h1>
        <p className="mt-3 text-paper/70 max-w-xl">
          For the handful of people who&rsquo;ve actually said yes. Every
          entry below required a name and a checked box before it was
          allowed to exist.
        </p>
      </header>

      <section className="mb-16">
        <LinkForm />
      </section>

      <section>
        <h2 className="font-mono text-xs uppercase tracking-widest text-paper/50 mb-4">
          {links.length === 0
            ? "Nothing archived yet"
            : `Tracking ${links.length} ${links.length === 1 ? "person" : "people"}`}
        </h2>

        {links.length === 0 ? (
          <p className="text-paper/60 italic font-display text-lg">
            Add the first link above once someone&rsquo;s said it&rsquo;s okay.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {links.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
