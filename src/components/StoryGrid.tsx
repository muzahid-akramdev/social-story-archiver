"use client";

import { useMemo, useState } from "react";

export type GalleryItem = {
  id: string;
  mediaType: "image" | "video";
  url: string; // signed URL, generated server-side
  archivedAt: string;
  posterUrl?: string; // video stories: signed URL of the kept poster image
};

const ROTATIONS = ["-rotate-2.5", "-rotate-1.5", "rotate-1", "rotate-1.5", "rotate-2.5"];

type TypeFilter = "all" | "image" | "video";
type SortOrder = "new" | "old";

/**
 * Archive browser (user direction, 2026-11-12): stories live as native
 * files; this grid adds filter (type + archived-date range), sort,
 * multi-select, and ZIP-on-demand downloads — a ZIP is only created
 * when the user downloads a selection (or everything shown), never at
 * crawl time. Individual downloads offer the native format directly,
 * or a one-item ZIP.
 */
export default function StoryGrid({ items }: { items: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<SortOrder>("new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmSingleDelete, setConfirmSingleDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
    const out = items.filter((i) => {
      if (removedIds.has(i.id)) return false;
      if (typeFilter !== "all" && i.mediaType !== typeFilter) return false;
      const d = new Date(i.archivedAt);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    out.sort((a, b) =>
      sort === "new"
        ? b.archivedAt.localeCompare(a.archivedAt)
        : a.archivedAt.localeCompare(b.archivedAt)
    );
    return out;
  }, [items, typeFilter, fromDate, toDate, sort, removedIds]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllShown = () =>
    setSelected(new Set(filtered.map((i) => i.id)));
  const clearSelection = () => setSelected(new Set());

  async function deleteStories(ids: string[]) {
    if (ids.length === 0 || deleting) return;
    setDeleting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/stories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyIds: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRemovedIds((prev) => new Set([...prev, ...ids]));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setOpenIndex(null);
      setConfirmBulkDelete(false);
      setConfirmSingleDelete(false);
    } catch {
      setStatus("Delete failed — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function downloadZip(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/stories/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyIds: ids }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stories-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setStatus("ZIP download failed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-paper/60 italic font-display text-lg">
        Nothing archived from this link yet — it&rsquo;ll fill in after the
        next check.
      </p>
    );
  }

  const inputCls =
    "bg-darkroom border border-paper/20 rounded px-2 py-1.5 text-sm text-paper";
  const btnCls =
    "font-mono text-xs uppercase tracking-wide border border-paper/25 rounded px-3 py-2 text-paper/80 hover:border-amber hover:text-amber disabled:opacity-40 disabled:hover:border-paper/25 disabled:hover:text-paper/80";
  const dangerBtnCls =
    "font-mono text-xs uppercase tracking-wide border border-red-400/50 rounded px-3 py-2 text-red-300 hover:border-red-400 hover:text-red-200 disabled:opacity-40";

  return (
    <>
      {/* Filter / sort / select toolbar */}
      <div className="mb-8 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper/50">
              Type
            </span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className={inputCls}
            >
              <option value="all">All</option>
              <option value="image">Photos</option>
              <option value="video">Videos</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper/50">
              From
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper/50">
              To
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-paper/50">
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
              className={inputCls}
            >
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </label>
          <p className="font-mono text-xs text-paper/50 pb-2">
            {filtered.length} of {items.length} shown
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={selectAllShown} className={btnCls}>
            Select all shown
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selected.size === 0}
            className={btnCls}
          >
            Clear selection
          </button>
          <button
            type="button"
            onClick={() => downloadZip([...selected])}
            disabled={selected.size === 0 || busy}
            className={btnCls}
          >
            {busy
              ? "Preparing ZIP…"
              : `Download selected as ZIP (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => downloadZip(filtered.map((i) => i.id))}
            disabled={filtered.length === 0 || busy}
            className={btnCls}
          >
            Download all shown as ZIP
          </button>
          {!confirmBulkDelete ? (
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={selected.size === 0 || deleting}
              className={dangerBtnCls}
            >
              Delete selected ({selected.size})
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => deleteStories([...selected])}
                disabled={deleting}
                className={dangerBtnCls}
              >
                {deleting
                  ? "Deleting…"
                  : `Confirm delete (${selected.size})?`}
              </button>
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={deleting}
                className={btnCls}
              >
                Cancel
              </button>
            </>
          )}
          {status && <span className="text-sm text-amber">{status}</span>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-paper/60 italic font-display text-lg">
          No stories match these filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-8">
          {filtered.map((item, i) => {
            const isSel = selected.has(item.id);
            return (
              <div key={item.id} className="relative">
                <button
                  onClick={() => { setOpenIndex(i); setConfirmSingleDelete(false); }}
                  className={`film-frame ${ROTATIONS[i % ROTATIONS.length]} hover:rotate-0 text-left w-full ${
                    isSel ? "ring-2 ring-amber" : ""
                  }`}
                >
                  {item.mediaType === "image" ? (
                    <img
                      src={item.url}
                      alt=""
                      className="w-full aspect-[9/16] object-cover"
                    />
                  ) : (
                    <video
                      src={item.url}
                      poster={item.posterUrl}
                      className="w-full aspect-[9/16] object-cover"
                      muted
                    />
                  )}
                  <p className="font-mono text-[10px] text-ink/50 mt-2">
                    {new Date(item.archivedAt).toLocaleDateString()}
                    {item.mediaType === "video" ? " · VIDEO" : ""}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={isSel ? "Deselect story" : "Select story"}
                  onClick={() => toggleSelected(item.id)}
                  className={`absolute top-2 left-2 z-10 w-7 h-7 rounded border font-mono text-sm leading-none ${
                    isSel
                      ? "bg-amber text-darkroom border-amber"
                      : "bg-darkroom/70 text-paper border-paper/40"
                  }`}
                >
                  {isSel ? "✓" : ""}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {openIndex !== null && filtered[openIndex] && (
        <div
          className="fixed inset-0 bg-darkroom/95 flex items-center justify-center p-6 z-50"
          onClick={() => { setOpenIndex(null); setConfirmSingleDelete(false); }}
        >
          <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            {filtered[openIndex].mediaType === "image" ? (
              <img
                src={filtered[openIndex].url}
                alt=""
                className="w-full rounded shadow-2xl"
              />
            ) : (
              <video
                src={filtered[openIndex].url}
                poster={filtered[openIndex].posterUrl}
                className="w-full rounded shadow-2xl"
                controls
                autoPlay
              />
            )}
            <div className="flex flex-wrap justify-between gap-3 mt-4">
              <div className="flex gap-4">
                <a
                  href={filtered[openIndex].url}
                  download
                  className="font-mono text-xs uppercase tracking-wide text-amber"
                >
                  Download {filtered[openIndex].mediaType === "video" ? "video" : "photo"}
                </a>
                <button
                  type="button"
                  onClick={() => downloadZip([filtered[openIndex].id])}
                  disabled={busy}
                  className="font-mono text-xs uppercase tracking-wide text-amber disabled:opacity-40"
                >
                  {busy ? "Preparing…" : "Download as ZIP"}
                </button>
                {!confirmSingleDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmSingleDelete(true)}
                    disabled={deleting}
                    className="font-mono text-xs uppercase tracking-wide text-red-300 disabled:opacity-40"
                  >
                    Delete
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => deleteStories([filtered[openIndex].id])}
                      disabled={deleting}
                      className="font-mono text-xs uppercase tracking-wide text-red-300 disabled:opacity-40"
                    >
                      {deleting ? "Deleting…" : "Confirm delete?"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmSingleDelete(false)}
                      disabled={deleting}
                      className="font-mono text-xs uppercase tracking-wide text-paper/60"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => { setOpenIndex(null); setConfirmSingleDelete(false); }}
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
