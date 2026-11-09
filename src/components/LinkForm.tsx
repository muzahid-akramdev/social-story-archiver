"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FolderTypeChoice = "personal_profile" | "page";

const inputClass =
  "mt-1 w-full rounded-xl border border-ink/15 bg-white/70 px-3.5 py-2.5 text-ink shadow-inner transition placeholder:text-ink/40 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/40";

export default function LinkForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [friendName, setFriendName] = useState("");
  // Folder type (migration 0006): extraction branches on it, so the
  // user picks it here — personal profiles and Pages don't preview
  // the same way anonymously.
  const [folderType, setFolderType] = useState<FolderTypeChoice>("personal_profile");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: sourceUrl,
          // Optional in v2 — the server resolves the label from the
          // link when this is left blank.
          friend_name: friendName.trim() ? friendName : undefined,
          folder_type: folderType,
          consent_confirmed: consentConfirmed,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      setSourceUrl("");
      setFriendName("");
      setFolderType("personal_profile");
      setConsentConfirmed(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="film-frame film-frame-glow max-w-lg -rotate-1.5 mx-auto sm:mx-0"
    >
      <h2 className="font-display text-2xl text-ink mb-4">Archive a story</h2>

      <label className="block mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
          Profile or story link
        </span>
        <input
          type="url"
          required
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://facebook.com/… or …/stories/…"
          className={inputClass}
        />
        <span className="mt-1 block text-xs text-ink/50">
          Either link creates a folder for that person — the crawler
          checks it every 8 hours.
        </span>
      </label>

      <div className="mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
          Folder type
        </span>
        <div
          className="mt-1 inline-flex rounded-full border border-ink/15 bg-ink/5 p-1"
          role="group"
          aria-label="Folder type"
        >
          <button
            type="button"
            aria-pressed={folderType === "personal_profile"}
            onClick={() => setFolderType("personal_profile")}
            className={
              folderType === "personal_profile"
                ? "rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper shadow"
                : "rounded-full px-4 py-1.5 text-sm text-ink/60 transition-colors hover:text-ink"
            }
          >
            Personal Profile
          </button>
          <button
            type="button"
            aria-pressed={folderType === "page"}
            onClick={() => setFolderType("page")}
            className={
              folderType === "page"
                ? "rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper shadow"
                : "rounded-full px-4 py-1.5 text-sm text-ink/60 transition-colors hover:text-ink"
            }
          >
            Page
          </button>
        </div>
        <span className="mt-1 block text-xs text-ink/50">
          {folderType === "page"
            ? "Page stories can't be previewed anonymously yet — crawls will say so plainly when that happens."
            : "A person's own profile (not a Facebook Page)."}
        </span>
      </div>

      <label className="block mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
          Whose stories are these? (optional)
        </span>
        <input
          type="text"
          value={friendName}
          onChange={(e) => setFriendName(e.target.value)}
          placeholder="Leave blank to use the name from the link"
          className={inputClass}
        />
      </label>

      <label className="flex items-start gap-2 mb-4 text-sm text-ink">
        <input
          type="checkbox"
          checked={consentConfirmed}
          onChange={(e) => setConsentConfirmed(e.target.checked)}
          required
          className="mt-1 h-4 w-4 shrink-0 accent-[#D4A72C]"
        />
        <span>I have this person&rsquo;s permission to archive their stories.</span>
      </label>

      {error && (
        <p className="mb-3 rounded-lg border border-rust/30 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !consentConfirmed}
        className="w-full rounded-xl bg-gradient-to-b from-[#E9C766] to-amber px-4 py-3 font-semibold text-darkroom shadow-lg shadow-amber/25 transition-all hover:-translate-y-0.5 hover:to-amber-dim disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {submitting ? "Archiving\u2026" : "Archive"}
      </button>
    </form>
  );
}
