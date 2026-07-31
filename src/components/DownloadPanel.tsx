"use client";

import { useState } from "react";
import { MediaItem } from "@/lib/types";

export default function DownloadPanel({
  endpoint,
  note,
}: {
  endpoint: string;
  note?: string;
}) {
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setItems(null);
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setItems(data.items);
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="film-frame max-w-lg mb-8">
        <label className="block mb-3">
          <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
            Video link
          </span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://facebook.com/..."
            className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink placeholder:text-ink/40"
          />
        </label>

        {note && <p className="text-ink/60 text-xs mb-3">{note}</p>}
        {error && <p className="text-rust text-sm mb-3">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-amber hover:bg-amber-dim disabled:opacity-40 text-darkroom font-medium rounded px-4 py-2"
        >
          {busy ? "Fetching\u2026" : "Fetch"}
        </button>
      </form>

      {items && items.length === 0 && (
        <p className="text-paper/60 italic font-display">
          No downloadable media found at that link.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-3 max-w-lg">
          {items.map((item, i) => (
            <li
              key={i}
              className="film-frame flex items-center justify-between gap-4"
            >
              <span className="font-mono text-xs text-ink/70">{item.mediaType}</span>
              <a
                href={item.mediaUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="text-ink underline decoration-amber decoration-2 underline-offset-2 text-sm"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
