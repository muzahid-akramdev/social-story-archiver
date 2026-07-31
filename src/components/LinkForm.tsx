"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LinkForm() {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [friendName, setFriendName] = useState("");
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
          friend_name: friendName,
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
      className="film-frame max-w-lg -rotate-1.5 mx-auto sm:mx-0"
    >
      <h2 className="font-display text-2xl text-ink mb-4">Archive a story</h2>

      <label className="block mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
          Story link
        </span>
        <input
          type="url"
          required
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://facebook.com/..."
          className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink placeholder:text-ink/40"
        />
      </label>

      <label className="block mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
          Whose stories are these?
        </span>
        <input
          type="text"
          required
          value={friendName}
          onChange={(e) => setFriendName(e.target.value)}
          placeholder="First name is fine"
          className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink placeholder:text-ink/40"
        />
      </label>

      <label className="flex items-start gap-2 mb-4 text-sm text-ink">
        <input
          type="checkbox"
          checked={consentConfirmed}
          onChange={(e) => setConsentConfirmed(e.target.checked)}
          required
          className="mt-1"
        />
        <span>I have this person&rsquo;s permission to archive their stories.</span>
      </label>

      {error && <p className="text-rust text-sm mb-3">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !consentConfirmed}
        className="bg-amber hover:bg-amber-dim disabled:opacity-40 disabled:cursor-not-allowed text-darkroom font-medium rounded px-4 py-2 transition-colors"
      >
        {submitting ? "Archiving\u2026" : "Archive"}
      </button>
    </form>
  );
}
