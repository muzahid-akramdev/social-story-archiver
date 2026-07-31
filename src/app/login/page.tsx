"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        router.push("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        setNotice("Account created. If email confirmation is on, check your inbox before logging in.");
        setMode("in");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-sm mx-auto px-6 py-24">
      <h1 className="font-display text-3xl italic mb-6 text-paper">
        {mode === "in" ? "Log in" : "Create account"}
      </h1>

      <form onSubmit={handleSubmit} className="film-frame">
        <label className="block mb-3">
          <span className="font-mono text-xs uppercase tracking-wide text-ink/70">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink"
          />
        </label>

        <label className="block mb-4">
          <span className="font-mono text-xs uppercase tracking-wide text-ink/70">Password</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-white/60 border border-ink/20 rounded px-3 py-2 text-ink"
          />
        </label>

        {error && <p className="text-rust text-sm mb-3">{error}</p>}
        {notice && <p className="text-ink text-sm mb-3">{notice}</p>}

        <button
          type="submit"
          disabled={busy}
          className="bg-amber hover:bg-amber-dim disabled:opacity-40 text-darkroom font-medium rounded px-4 py-2"
        >
          {busy ? "Please wait\u2026" : mode === "in" ? "Log in" : "Sign up"}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "in" ? "up" : "in")}
        className="mt-4 font-mono text-xs uppercase tracking-wide text-paper/60 underline"
      >
        {mode === "in" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </main>
  );
}
