"use client";

import { useEffect, useState } from "react";

type Status = { connected: boolean; verifiedAt: string | null };

export default function ConnectFacebookPage() {
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/facebook-session")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, verifiedAt: null }));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/facebook-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setCookie("");
      setStatus({ connected: true, verifiedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await fetch("/api/facebook-session", { method: "DELETE" });
      setStatus({ connected: false, verifiedAt: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-lg mx-auto px-6 py-16">
      <h1 className="font-display text-3xl italic mb-4 text-paper">Connect Facebook</h1>
      <p className="text-paper/70 text-sm mb-6">
        Private-group video downloads and story archiving both need your
        own logged-in Facebook session — there&rsquo;s no other way to reach
        that content. Paste your session cookie below: in your browser,
        while logged into Facebook, open DevTools &rarr; Application/Storage
        &rarr; Cookies &rarr; facebook.com and copy the full Cookie header
        value. Treat this like a password — whoever holds it can act as
        your Facebook session, and using it this way isn&rsquo;t how
        Facebook expects its site to be accessed, so there&rsquo;s some risk
        of the session getting flagged or logged out on Facebook&rsquo;s
        side.
      </p>

      {status === null ? (
        <p className="text-paper/50 text-sm">Checking status\u2026</p>
      ) : status.connected ? (
        <div className="film-frame">
          <p className="text-ink mb-3">
            Connected
            {status.verifiedAt
              ? ` — saved ${new Date(status.verifiedAt).toLocaleString()}`
              : ""}
          </p>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="text-rust underline text-sm disabled:opacity-40"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="film-frame">
          <label className="block mb-3">
            <span className="font-mono text-xs uppercase tracking-wide text-ink/70">
              Facebook cookie
            </span>
            <textarea
              required
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={4}
              placeholder="c_user=...; xs=...; ..."
              className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink text-xs font-mono"
            />
          </label>

          {error && <p className="text-rust text-sm mb-3">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="bg-amber hover:bg-amber-dim disabled:opacity-40 text-darkroom font-medium rounded px-4 py-2"
          >
            {busy ? "Saving\u2026" : "Save & connect"}
          </button>
        </form>
      )}
    </main>
  );
}
