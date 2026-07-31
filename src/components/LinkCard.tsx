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
    <div className="film-frame rotate-1 hover:rotate-0 pb-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
            {link.platform}
          </p>
          <h3 className="font-display text-lg text-ink leading-tight">
            {link.label || link.friend_name}
          </h3>
        </div>
        {stale && (
          <span
            title={`${link.consecutive_failures} checks in a row have failed`}
            className="font-mono text-[10px] uppercase text-rust border border-rust/50 rounded px-1.5 py-0.5"
          >
            stalled
          </span>
        )}
      </div>

      <dl className="mt-3 font-mono text-xs text-ink/70 space-y-0.5">
        <div className="flex justify-between">
          <dt>stories</dt>
          <dd>{link.story_count}</dd>
        </div>
        <div className="flex justify-between">
          <dt>last checked</dt>
          <dd>{timeAgo(link.last_checked_at)}</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-3">
        <Link
          href={`/folder/${link.id}`}
          className="text-sm text-ink underline decoration-amber decoration-2 underline-offset-2"
        >
          Open archive
        </Link>
        <button
          onClick={handleRecheck}
          disabled={rechecking}
          className="text-sm text-ink/60 hover:text-ink disabled:opacity-40 ml-auto"
        >
          {rechecking ? "Checking\u2026" : "Recheck now"}
        </button>
      </div>
    </div>
  );
}
