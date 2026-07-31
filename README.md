# Story Archive

A personal tool for archiving Facebook (Instagram later) stories from a
specific, consenting handful of people — not a general "paste any public
link" scraper. See **Consent gate** below for what that means concretely.

## What's built vs. what's unverified

Everything is wired end-to-end, including a real Facebook extraction
attempt (`src/lib/extraction/facebook.ts`) — a custom scraper against
public-privacy Stories, since neither a third-party "story saver" API nor
session-based friend access fit (see the comment at the top of that file
for why).

**That file hasn't been run against a live Facebook story** — there was no
network access in the environment it was built in. Treat it as a strong
starting point, not confirmed-working. Before anything else: run it
against one real public story URL and see what actually comes back, per
the build order below. The two most likely things to need adjusting,
in order of likelihood, are documented in that file's header — short
version: Stories are probably client-rendered enough that a plain fetch
won't be sufficient, and personal-profile public stories might need some
authenticated session even though anyone can view them.

Set `MOCK_EXTRACTION=true` in `.env.local` to develop everything else
(upload, hashing, dedupe, both galleries, the scheduled sweep) against
placeholder images without touching Facebook at all.

## Setup

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY from your Supabase project's API settings
```

1. Create a Supabase project.
2. Run the migrations in `supabase/migrations/` against it, in order (via
   the SQL editor in the dashboard, or `supabase db push` with the CLI).
   `0001_init.sql` creates the schema and the **private** storage bucket.
   `0002_cron.sql` sets up the scheduled sweep — edit the placeholder URL
   and secret in that file before running it (see below).
3. `npm run dev` and open `http://localhost:3000`.

## Consent gate

`watched_links` requires `friend_name` and `consent_confirmed = true` on
every row — the API rejects link creation without both (see
`POST /api/links`). The form on the home page makes the checkbox required
before the submit button even enables. This is attestation, not
enforcement — nothing can verify a real conversation happened — but it
replaces "paste and forget" with a deliberate step, and keeps the tool
honest about what it's for even to future-you. If you ever want to go
further, a natural next step is an actual two-party flow: generate an
invite link the friend clicks to confirm themselves, instead of you
checking a box on their behalf.

## Deploying + the scheduled recheck

Deploy the Next.js app to Vercel as usual, setting the same env vars from
`.env.local` in the Vercel project settings, plus a `CRON_SECRET` (any
long random string — `openssl rand -hex 32`).

The scheduled sweep is `POST /api/cron/check-all-links`, called by
Supabase Cron via `pg_net`, **not** a Supabase Edge Function — see the
comment at the top of that route for why (keeps extraction logic in one
Node codebase instead of duplicating it in Deno). Once deployed, edit
`supabase/migrations/0002_cron.sql` with your real Vercel URL and
`CRON_SECRET`, then run it.

Supabase Cron's `http_post` is fire-and-forget: a failed run doesn't retry
or alert, and a paused project silently drops every tick. Fine for a
personal tool. For retries/alerting, point an external scheduler (GitHub
Actions, `cron-job.org`, Vercel Cron) at the same URL instead — nothing
else changes.

## Project layout

```
src/lib/extraction/     — extractStoryMedia(url, platform); facebook.ts is the pending stub
src/lib/storage.ts      — upload + hash + dedupe against stories.content_hash
src/lib/recheck.ts      — shared by link creation, manual recheck, and the cron sweep
src/app/api/links/               — POST create (consent-gated) + GET list
src/app/api/links/[id]/recheck/  — manual "recheck now"
src/app/api/cron/check-all-links/ — scheduled sweep, secret-guarded
src/app/(pages)          — home (form + card list) and /folder/[id] (gallery)
```

## Next step

Before deploying anything: point the app at one real public Facebook story
URL with `MOCK_EXTRACTION` unset, and see what `extractFacebookStoryMedia`
actually returns. It'll either work, partially work, or come back with a
clear "no media found" — the error messages in that file are written to
tell you which of the two documented uncertainties you hit, so you know
what to fix.

## Not yet handled

- Instagram (Facebook first, per the build plan)
- Retry/backoff beyond what's already there: `consecutive_failures` is
  tracked per link, the scheduled sweep stretches its gap to ~12h after 3
  failures in a row and ~24h after 6 (see `shouldAttemptRecheck` in
  `src/lib/recheck.ts` — scaled off the 4h cron interval, revisit both
  together if you change one), and a "stalled" badge shows on its card at
  3. Manual "recheck now" always bypasses backoff.
- Auth / multi-user — this is intentionally a single-person tool for now
