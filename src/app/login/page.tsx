"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

const inputClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5 text-paper transition placeholder:text-paper/30 focus:border-amber/60 focus:outline-none focus:ring-2 focus:ring-amber/30";

const FEATURES: { head: string; tail?: string }[] = [
  { head: "Anonymous by design", tail: "no seen, ever" },
  { head: "Auto-crawl every 8 hours" },
  { head: "Photos compressed to ≤40 KB" },
  { head: "Private ZIP vaults in Supabase" },
];

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
    <main className="relative min-h-screen lg:grid lg:grid-cols-2">
      <div className="film-grain" aria-hidden="true" />

      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.06] p-12 lg:flex xl:p-16">
        <span className="relative z-10 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#E9C766] via-amber to-amber-dim shadow-lg shadow-amber/30">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <circle cx="12" cy="12" r="7.25" fill="none" stroke="#FFF9EC" strokeWidth="2" />
              <circle cx="12" cy="12" r="2.5" fill="#FFF9EC" />
            </svg>
          </span>
          <span className="font-display text-lg leading-none tracking-tight text-paper">
            Story <span className="italic text-gold-grad">Archive</span>
          </span>
        </span>

        <div className="relative z-10 max-w-md">
          <p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-amber">
            <span className="h-px w-10 bg-amber/60" aria-hidden="true" />
            Private story vault
          </p>
          <h1 className="mt-5 font-display text-5xl italic leading-[1.08] text-paper xl:text-6xl">
            A kept box,
            <br />
            not a broadcast.
          </h1>
          <ul className="mt-10 space-y-4">
            {FEATURES.map((f) => (
              <li key={f.head} className="flex items-start gap-3 text-[15px]">
                <span
                  className="mt-[7px] h-2 w-2 shrink-0 rotate-45 bg-amber shadow shadow-amber/50"
                  aria-hidden="true"
                />
                <span className="text-paper/80">
                  <span className="font-medium text-paper">{f.head}</span>
                  {f.tail && <span className="text-paper/50"> — {f.tail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 font-mono text-[10px] uppercase tracking-widest text-paper/35">
          Crawls every 8 hours · ≤40 KB a photo · Yours alone
        </p>

        {/* Decorative prints, tucked into the corner. */}
        <div aria-hidden="true">
          <div
            className="film-frame absolute -bottom-8 right-6 w-44 opacity-95"
            style={{ transform: "rotate(7deg)" }}
          >
            <div className="h-32 bg-[linear-gradient(160deg,#2E2440,#B0532A_58%,#D4A72C)]" />
            <p className="pt-2 font-mono text-[9px] uppercase tracking-widest text-ink/50">
              golden hour — kept
            </p>
          </div>
          <div
            className="film-frame absolute bottom-24 right-48 w-36 opacity-90"
            style={{ transform: "rotate(-9deg)" }}
          >
            <div className="h-24 bg-[linear-gradient(150deg,#14201A,#7A9471_62%,#22301F)]" />
            <p className="pt-2 font-mono text-[9px] uppercase tracking-widest text-ink/50">
              night market
            </p>
          </div>
        </div>
      </aside>

      {/* Form panel */}
      <section className="relative flex flex-col items-center justify-center px-6 py-16 lg:py-10">
        <div className="mb-10 text-center lg:hidden">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#E9C766] via-amber to-amber-dim shadow-lg shadow-amber/30">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <circle cx="12" cy="12" r="7.25" fill="none" stroke="#FFF9EC" strokeWidth="2" />
              <circle cx="12" cy="12" r="2.5" fill="#FFF9EC" />
            </svg>
          </span>
          <p className="mt-4 font-display text-2xl italic text-paper">
            A kept box, not a broadcast.
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper/40">
            Story Archive — private story vault
          </p>
        </div>

        <div className="glass-panel animate-rise w-full max-w-sm p-7 sm:p-8">
          <div
            className="mb-7 grid grid-cols-2 gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1"
            role="group"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              aria-pressed={mode === "in"}
              onClick={() => setMode("in")}
              className={
                mode === "in"
                  ? "rounded-full bg-amber py-2 text-sm font-semibold text-darkroom shadow"
                  : "rounded-full py-2 text-sm text-paper/55 transition-colors hover:text-paper"
              }
            >
              Log in
            </button>
            <button
              type="button"
              aria-pressed={mode === "up"}
              onClick={() => setMode("up")}
              className={
                mode === "up"
                  ? "rounded-full bg-amber py-2 text-sm font-semibold text-darkroom shadow"
                  : "rounded-full py-2 text-sm text-paper/55 transition-colors hover:text-paper"
              }
            >
              Create account
            </button>
          </div>

          <h1 className="font-display text-2xl italic text-paper">
            {mode === "in" ? "Log in" : "Create account"}
          </h1>
          <p className="mb-6 mt-1 text-sm text-paper/55">
            {mode === "in"
              ? "Sign in to open your kept box."
              : "Create your private vault."}
          </p>

          <form onSubmit={handleSubmit}>
            <label className="block mb-3">
              <span className="font-mono text-xs uppercase tracking-wide text-paper/55">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block mb-4">
              <span className="font-mono text-xs uppercase tracking-wide text-paper/55">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            {error && (
              <p className="mb-3 rounded-lg border border-rust/40 bg-rust/15 px-3 py-2 text-sm text-[#F0B08E]">
                {error}
              </p>
            )}
            {notice && (
              <p className="mb-3 rounded-lg border border-moss/40 bg-moss/15 px-3 py-2 text-sm text-[#B9CCB2]">
                {notice}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-b from-[#E9C766] to-amber px-4 py-3 font-semibold text-darkroom shadow-lg shadow-amber/25 transition-all hover:-translate-y-0.5 hover:to-amber-dim disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? "Please wait\u2026" : mode === "in" ? "Log in" : "Sign up"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
