"use client";

import { useState } from "react";

export type GalleryItem = {
  id: string;
  mediaType: "image" | "video";
  url: string; // signed URL, generated server-side
  archivedAt: string;
};

const ROTATIONS = ["-rotate-2.5", "-rotate-1.5", "rotate-1", "rotate-1.5", "rotate-2.5"];

export default function StoryGrid({ items }: { items: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <p className="text-paper/60 italic font-display text-lg">
        Nothing archived from this link yet — it&rsquo;ll fill in after the
        next check.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-8">
        {items.map((item, i) => (
          <button
            key={item.id}
            onClick={() => setOpenIndex(i)}
            className={`film-frame ${ROTATIONS[i % ROTATIONS.length]} hover:rotate-0 text-left`}
          >
            {item.mediaType === "image" ? (
              <img
                src={item.url}
                alt=""
                className="w-full aspect-[9/16] object-cover"
              />
            ) : (
              <video src={item.url} className="w-full aspect-[9/16] object-cover" muted />
            )}
            <p className="font-mono text-[10px] text-ink/50 mt-2">
              {new Date(item.archivedAt).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <div
          className="fixed inset-0 bg-darkroom/95 flex items-center justify-center p-6 z-50"
          onClick={() => setOpenIndex(null)}
        >
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            {items[openIndex].mediaType === "image" ? (
              <img
                src={items[openIndex].url}
                alt=""
                className="w-full rounded shadow-2xl"
              />
            ) : (
              <video
                src={items[openIndex].url}
                className="w-full rounded shadow-2xl"
                controls
                autoPlay
              />
            )}
            <div className="flex justify-between mt-4">
              <a
                href={items[openIndex].url}
                download
                className="font-mono text-xs uppercase tracking-wide text-amber"
              >
                Download
              </a>
              <button
                onClick={() => setOpenIndex(null)}
                className="font-mono text-xs uppercase tracking-wide text-paper/60"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
