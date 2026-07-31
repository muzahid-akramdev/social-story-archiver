import Link from "next/link";
import DownloadPanel from "@/components/DownloadPanel";

export default function DownloadVideoPage() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="font-mono text-xs uppercase tracking-widest text-amber">
        &larr; Home
      </Link>
      <h1 className="font-display text-4xl italic mt-4 mb-3 text-paper">
        Download a public video
      </h1>
      <p className="text-paper/70 mb-8">
        Works for public Facebook posts and videos. Nothing is saved here —
        grab the direct link while it&rsquo;s fresh.
      </p>
      <DownloadPanel endpoint="/api/download/video" />
    </main>
  );
}
