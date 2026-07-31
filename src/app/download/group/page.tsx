import Link from "next/link";
import DownloadPanel from "@/components/DownloadPanel";
import { getAuthUser } from "@/lib/auth";
import { facebookSessionStatus } from "@/lib/facebook-session";

export const dynamic = "force-dynamic";

export default async function DownloadGroupPage() {
  const user = await getAuthUser();
  const status = user
    ? await facebookSessionStatus(user.id)
    : { connected: false, verifiedAt: null };

  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="font-mono text-xs uppercase tracking-widest text-amber">
        &larr; Home
      </Link>
      <h1 className="font-display text-4xl italic mt-4 mb-3 text-paper">
        Download a private group video
      </h1>

      {!status.connected ? (
        <p className="text-paper/70">
          This needs your own Facebook session first —{" "}
          <Link href="/connect-facebook" className="text-amber underline">
            connect Facebook
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-paper/70 mb-8">
            Uses your connected Facebook session. Only works for groups
            you&rsquo;re actually a member of. Nothing is saved here.
          </p>
          <DownloadPanel endpoint="/api/download/group" />
        </>
      )}
    </main>
  );
}
