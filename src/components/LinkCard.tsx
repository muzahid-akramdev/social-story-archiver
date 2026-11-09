"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { WatchedLink } from "@/lib/types";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** v2 crawl cadence is 8h (migration 0005) — next sweep ≈ last check + 8h. */
function nextCrawlIn(iso: string | null): string {
  if (!iso) return "due now";
  const next = new Date(iso).getTime() + 8 * 3600000;
  const ms = next - Date.now();
  if (ms <= 0) return "due now";
  const hr = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  return hr > 0 ? `~${hr}h ${min}m` : `~${min}m`;
}

const chipClass =
  "rounded-full border border-ink/15 bg-white/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink/60";
const statLabel =
  "font-mono text-[10px] uppercase tracking-widest text-ink/50";
const statValue = "mt-0.5 font-display text-base leading-snug text-ink";

export default function LinkCard({
  link,
}: {
  link: WatchedLink & { story_count: number };
}) {
  const router = useRouter();
  const [rechecking, setRechecking] = useState(false);

  async function handleRecheck() {
    setRechecking(true);
    try {
      await fetch(`/api/links/${link.id}/recheck`, { method: "POST" });
      router.refresh();
    } finally {
      setRechecking(false);
    }
  }

  const stale = link.consecutive_failures >= 3;

  return (
    <div className="film-frame flex h-full rotate-1 flex-col hover:rotate-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {link.avatar_url ? (
            <span className="story-ring">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={link.avatar_url}
                alt=""
                className="block h-11 w-11 rounded-full object-cover"
              />
            </span>
          ) : (
            <span className="story-ring">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-dim font-display text-lg italic text-ink/60">
                {(link.label || link.friend_name).slice(0, 1)}
              </span>
            </span>
          )}
          <div>
            <h3 className="font-display text-xl leading-tight text-ink">
              {link.label || link.friend_name}
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={chipClass}>{link.platform}</span>
              <span className={chipClass}>
                {link.folder_type === "page" ? "Page" : "Personal profile"}
              </span>
            </div>
          </div>
        </div>
        {stale && (
          <span
            title={`${link.consecutive_failures} checks in a row have failed`}
            className="rounded-full border border-rust/40 bg-rust/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-rust"
          >
            stalled
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2">
        <div className="border-b border-r border-ink/10 py-2.5 pr-3">
          <dt className={statLabel}>stories</dt>
          <dd className={statValue}>{link.story_count}</dd>
        </div>
        <div className="border-b border-ink/10 py-2.5 pl-3">
          <dt className={statLabel}>last checked</dt>
          <dd className={statValue}>{timeAgo(link.last_checked_at)}</dd>
        </div>
        <div className="border-r border-ink/10 py-2.5 pr-3">
          <dt className={statLabel}>last new story</dt>
          <dd className={statValue}>{timeAgo(link.last_new_story_at)}</dd>
        </div>
        <div className="py-2.5 pl-3">
          <dt className={statLabel}>next crawl</dt>
          <dd className={statValue}>{nextCrawlIn(link.last_checked_at)}</dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <Link
          href={`/folder/${link.id}`}
          className="rounded-full bg-amber px-4 py-1.5 text-sm font-medium text-darkroom shadow-md shadow-amber/30 transition-all hover:-translate-y-0.5 hover:bg-amber-dim"
        >
          Open archive
        </Link>
        <button
          onClick={handleRecheck}
          disabled={rechecking}
          className="ml-auto rounded-full border border-transparent px-3 py-1.5 text-sm text-ink/55 transition-colors hover:border-ink/20 hover:text-ink disabled:opacity-40"
        >
          {rechecking ? "Checking\u2026" : "Recheck now"}
        </button>
      </div>
    </div>
  );
}
