# Story Archive

A user-based tool for archiving Facebook stories: register, log in, add
a **folder** per person by pasting a link, and the system checks every
folder **every 8 hours** on its own. New stories are compressed to
**≤ 40 KB per image**, bundled into one small ZIP per crawl, and stored
in Supabase. A guest-facing manual fetch (paste a story link, get the
story) runs on the same extraction engine.

## v2 — what changed (2026-11-10)

- **Multi-user throughout.** Supabase Auth (sign up / log in on
  `/login`, registration also reachable at `/register`); the dashboard
  lives at `/` and `/dashboard`; every folder, archive and story is
  scoped to its owner (`user_id`), with owner RLS policies added in
  migration `0004` on top of the existing service-role data path.
- **Folders by link.** Pasting EITHER a profile link
  (`facebook.com/{username}`, `profile.php?id=…`) OR a story link
  (`facebook.com/stories/{bucket}/…`) creates the folder
  (`src/lib/resolve-link.ts`). The story payload is base64 — it decodes
  to the bucket id + story id, both stored (`fb_bucket_id`,
  `fb_profile_id`, `avatar_url` columns, migration `0004`). The name
  field on the form is now optional; the link's own label is used when
  it's blank. Name/avatar *enrichment* from Facebook itself is still a
  TODO in the resolver — a URL alone doesn't carry a display name for
  bucket/vanity links.
- **≤ 40 KB adaptive compression** (`src/lib/media/pipeline.ts`,
  `sharp`): WebP, stepping 720/q60 → 640/q50 → 540/q50 → 540/q40 →
  further last-resort step-downs until the image fits. The target is
  per image; a ZIP of n new stories is ~n × ≤40 KB. Plus a 240px WebP
  thumbnail per story for the gallery. Try it: `npm run demo:compress`.
  Measured locally on synthetic 1080×1920 frames: a worst-case
  per-pixel-noise frame (5.4 MB PNG) → **34.4 KB**; a gradient/text
  story frame → **6.1 KB** at the first step; a 3-story ZIP → **74.3 KB**
  total. (On a real photo-like frame measured during spec work:
  640/q50 ≈ 40 KB, 540/q55 ≈ 34 KB.)
- **ZIP archives in Supabase Storage.** Each crawl that finds new
  images uploads one ZIP to the existing private `story-archive`
  bucket at `{user_id}/{folder_id}/{YYYY-MM-DD}/{crawl_id}.zip`, with
  an `archives` row (size, story count) shown on the folder page with
  a signed download link. Videos still archive individually (video
  recompression via ffmpeg is future work).
- **Story-id dedupe ledger** (`stories_seen`, unique per folder):
  known `fb_story_id`s are skipped *before* downloading; the v1
  content-hash dedupe remains as backstop. A second immediate crawl
  produces nothing.
- **Crawl runs are logged** (`crawl_runs`): the 8-hour sweep
  (`0 */8 * * *`, migration `0005`, replacing the 4-hour job) inserts a
  run row and finishes it with status/folders/new-story counts and an
  error summary. Folders are processed sequentially with a pause
  between them. `/admin` (and `GET /api/admin/session-health`) shows
  extraction mode, the dedicated session's status (status only —
  never cookie values), fallback status, and the last 10 runs.
- **Extraction restructured** — see the research note below. Anonymous
  strategies first; full coverage (pure stories, Page stories) runs on
  a **dedicated Facebook account's session** (owner decision
  2026-11-10 — BraveDown's own method, used query-only so it never
  registers a seen). Setup: `FB_SESSION_COOKIE`, see Setup below.
- **Folder types** (migration `0006`): the add-folder form asks
  Personal Profile vs Page (`watched_links.folder_type`, default
  `personal_profile`); the crawl branches on it — see strategy 1 in
  the research note below.

## Extraction research note — how media is fetched without a "seen"

Design goal: **retrieve the media file without registering a view.**
Fetching a file and registering a seen are separate actions — a view
is logged when a story *player* runs its view-logging call, not when a
server GETs page HTML or a CDN file. Nothing in this codebase loads a
story player.

Strategy order in `src/lib/extraction/facebook.ts`:

1. **storyphp-og — OPPORTUNISTIC (verified live 2026-11-10 for
   post-backed stories only).** A plain anonymous GET of
   `https://{host}/story.php?story_fbid={story_id}&id={owner}` with an
   iPhone Safari UA. For SOME public personal-profile stories,
   Facebook serves the small (~3.5 KB) link-preview page whose
   `og:image` / `og:video` is the story's own fbcdn media URL. Hosts:
   `web.facebook.com`, then `touch.facebook.com` (www/m return the
   login page; a desktop UA gets HTTP 400). `id=` takes the owner's
   numeric uid OR vanity username — both come from the folder
   (`watched_links.fb_profile_id`, migration 0004; the story id is
   decoded from the folder's story link). Verified end-to-end on the
   owner's own public story through the built module: og:image
   downloaded as a 600×600 JPEG, 28 KB, content-checked as the story.
   **Not general:** a second public profile story (1011567334924150)
   login-walled on web/touch/www across 4 attempts the same night
   while a control fetch of the first story still worked — the route
   only works when the story resolves to a publicly previewable
   post-like object (the working story's `og:url` was `/posts/{id}/`);
   pure stories wall. When every host walls, the crawl diagnostic
   says "story.php preview unavailable for this story (login wall) —
   not a post-backed story" and the crawl falls through. Limits: the
   media is the OG preview rendition (≤600×600 square crop for photos,
   not the full-size original — items carry a note); and a bare story
   link alone doesn't reveal the owner (`id={bucket_id}` login-walls),
   so story-link-only folders skip this strategy and the crawl error
   says so.
   **Folder type branches here** (migration 0006): the add-folder
   form asks Personal Profile vs Page. Page folders get a best-effort
   storyphp-og attempt — Page stories are not publicly previewable
   anonymously (research; untested live) — but their real path is
   strategy 2 below; only when NO dedicated session is configured
   does a walled attempt end the crawl at "page story: anonymous
   route unavailable" in the diagnostic instead of a silent failure.
2. **session-ssr — the full-coverage path (owner decision
   2026-11-10).** One **dedicated Facebook account**, created only
   for this tool, whose session cookie is supplied via the
   server-only env `FB_SESSION_COOKIE`
   (`src/lib/dedicated-fb-session.ts`). The strategy GETs the
   authenticated `/stories/{bucket}/{token}/` page (desktop UA) and
   parses the SSR payload for the bucket's cards, filtered to the
   requested story id: photo `image.uri` (full-size `t39.30808-6`
   preferred; avatar-class `t39.30808-1` and sticker-class
   `t39.1997-6` rejected) and video `playable_url_quality_hd` /
   `playable_url` (+ `browser_native_*_url`). If the stories page
   yields nothing it falls back to `story.php?story_fbid=&id=` WITH
   the session, parsed the same way. This is the only strategy that
   reaches pure stories (strategy 1's counterexample) and Page
   stories.
   **Never-seen is a hard requirement, enforced by construction:**
   the strategy issues only GET page loads (read queries). It never
   calls any seen/view-logging operation
   (storiesUpdateSeenStateMutation /
   StoriesReaderUpdateSeenStateMutation / CometStoriesSeenMutation
   family) and never automates a story player — a guard note sits at
   the strategy definition in the code. Registering a view is a
   separate action the player performs; a query-only fetch performs
   no such action, so the dedicated account never appears in a
   poster's viewers list.
   A login/checkpoint answer is reported distinctly — "dedicated
   session invalid/expired or checkpointed" — never as "no media
   found"; with the env unset the skip diagnostic is "session
   strategy not configured (FB_SESSION_COOKIE unset)". Cookie values
   are redacted from every error path and never logged or returned
   by any endpoint; `/api/admin/session-health` reports the session
   as a status only (configured / ok / fb_session_expired / unknown,
   plus any missing expected cookie NAMES).
   **Operating notes:** the account can only fetch stories it can
   SEE — public stories work with any account; friends-audience
   stories need the account to be friends with the poster; Page
   folders need it to follow the Page. Volume stays at the 8h crawl
   cadence (one GET per folder + at most one fallback). Cookies
   expire: when `/admin` shows `fb_session_expired`, re-copy the
   cookie header from the dedicated account and replace the env.
   Checkpoint/ban risk sits on the dedicated account by design —
   never use a personal account here.
3. **Session-free URL fetch.** Plain GETs of the folder URL with a
   browser UA, then with Facebook's `facebookexternalhit` crawler UA
   (public posts/videos serve OG tags to it — that's how link previews
   work; the existing public-video download route depends on this),
   parsing `og:` tags + fbcdn URLs from the HTML.
   What's known: oEmbed needs an app access token since 2020 and never
   supported stories; Graph API story nodes need permissions Facebook
   doesn't grant for other people's stories; and the
   `/stories/{bucket}/{token}` URL fetched anonymously redirects to a
   **login wall** on every host (verified live 2026-11-10 — browser UA
   → login/400, crawler UA → login page, no media). Note that
   login-wall result is about the ANONYMOUS fetch of the `/stories/`
   path — strategy 1 is the anonymous route that works for
   post-backed stories, and strategy 2 fetches the same path WITH the
   dedicated session. This strategy still earns its place for public
   post/video links: free, anonymous, zero accounts.
4. **Media-endpoint fetch.** The same plain HTTP fetch, with a cookie
   IF one happens to be available (a per-user session an app user
   connected for themselves at `/connect-facebook`, or the optional
   hidden `FB_SESSION_COOKIES` env fallback in
   `src/lib/server-fb-session.ts` — a legacy experiment aid, distinct
   from strategy 2's `FB_SESSION_COOKIE`). Still just GETs of
   HTML/media — never the player, never a view-logging call. A
   login-wall failure here is reported as `fb_session_expired` in the
   crawl run so it surfaces on `/admin` instead of failing silently.

Verification status: strategy 1 (storyphp-og) is verified live
against a real post-backed public story AND against a pure-story
counterexample that walls (both 2026-11-10, see above). Strategy 2
(session-ssr) is implemented and its parser/classifier verified on
synthetic SSR fixtures (photo full-size over thumbnail, video HD
over SD, avatar/sticker exclusion, login-page → session-invalid
diagnostic, unconfigured → named skip diagnostic); its LIVE
verification is **PENDING** the owner's dedicated account +
`FB_SESSION_COOKIE` — see "Remaining live steps". Strategy 4's cookie
path remains unverified.

## Consent gate (unchanged from v1)

`watched_links` still requires `consent_confirmed = true` on every row
— the API rejects folder creation without it, and the form's checkbox
is required before submit enables. This is attestation, not
enforcement, but it keeps the tool scoped to people who've actually
agreed to be archived.

## Setup

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET from your Supabase project
npm run dev
```

1. **Supabase project.** Reuse the existing social-story-archiver
   project if it's still active (the owner can only keep two projects
   active at a time) — otherwise create one and say so.
2. **Migrations, in order** (SQL editor or `supabase db push`):
   `0001` (schema + private bucket) → `0002` (original cron; superseded
   by 0005) → `0003` (per-user ownership + sessions) → `0004` (v2:
   folder identity columns, `archives`, `stories_seen`, `crawl_runs`,
   owner RLS) → `0005` (cron every 8 hours — edit the placeholder app
   URL + `CRON_SECRET` in the file before running).
3. **Develop without Facebook:** set `MOCK_EXTRACTION=true` — extraction
   returns a stable placeholder story per link, so compression, ZIP
   archives, dedupe, galleries and the crawl all run end-to-end. A
   second crawl of the same folder correctly finds nothing new.
4. `npm run demo:compress` to see the ≤40 KB pipeline numbers.
5. **Full coverage (optional at setup, required for pure stories +
   Page stories):** create a DEDICATED Facebook account for this tool
   (never a personal one), have it friend/follow the people and Pages
   whose stories it must see, then set `FB_SESSION_COOKIE` in
   `.env.local` to the full `.facebook.com` Cookie header from its
   logged-in browser (DevTools → Network → the facebook.com document
   request → Cookie header; must include `c_user`, `xs`, `datr`,
   `sb`, `fr`). Check `/admin` — the dedicated session should read
   `ok`. Full notes in the research note, strategy 2.

## Deploying + the scheduled crawl

Deploy the Next.js app to Vercel with the same env vars as `.env.local`.
**No Facebook credential is required for the anonymous strategies.**
For full coverage, `FB_SESSION_COOKIE` (the dedicated account's
session) is deployed as a server-only env var — it is never exposed
to the client and never stored in the database.

The sweep is `POST /api/cron/check-all-links`, called by Supabase Cron
via `pg_net` (migrations `0002`/`0005`), not an Edge Function, so all
extraction/compression code lives in one Node codebase. pg_net is
fire-and-forget — a failed run doesn't retry, and a paused Supabase
project silently drops ticks; for alerting, point an external
scheduler (GitHub Actions, cron-job.org, Vercel Cron) at the same URL
instead. The dashboard's "Recheck now" button runs the same code path
for one folder at any time.

## Remaining live steps (Phase 1 → launch)

1. **Extraction proof:** ✅ done for strategy 1 — storyphp-og was
   run live through the built module against a real post-backed
   public story on 2026-11-10 and returned its media; a pure-story
   counterexample walled as documented (see the research note above).
   ⏳ **PENDING for strategy 2 (session-ssr):** the owner creates the
   dedicated Facebook account, supplies `FB_SESSION_COOKIE`, and one
   known pure story (strategy 1's counterexample) is fetched live
   through the built module — success = its full-size media, and the
   `/admin` dedicated-session status reading `ok`.
   Still open: a full recheck of a folder in the deployed app (needs
   migrations + deploy, steps 2–3). (If a headless-browser fetcher is
   ever added, it must fetch media bytes only — a story-player session
   that plays cards and registers views is explicitly out of design.)
2. Run migrations `0004` + `0005` + `0006` on the live Supabase project.
3. Deploy to Vercel, set env vars, confirm the 8-hour cron job exists
   in `cron.job`.
4. Watch the first real sweep on `/admin`.

## Project layout (v2 additions in **bold**)

```
src/lib/extraction/       — extractStoryMedia(url, platform, cookie?, storyContext?, sessionCookie?);
                            facebook.ts = strategies 1–4 (see note above)
src/lib/resolve-link.ts   — **profile/story link → folder identity**
src/lib/media/pipeline.ts — **≤40 KB WebP compression, thumbnails, ZIP**
src/lib/dedicated-fb-session.ts — **FB_SESSION_COOKIE dedicated account + health + redaction**
src/lib/server-fb-session.ts — **legacy optional hidden env fallback + health**
src/lib/storage.ts        — dedupe ledger + compress + ZIP + archives row
src/lib/recheck.ts        — shared by creation, manual recheck, sweep
src/app/api/cron/check-all-links/ — 8h sweep, writes crawl_runs
src/app/dashboard/        — **alias of the home dashboard**
src/app/admin/            — **extraction status + crawl run history**
src/app/folder/[id]/      — gallery + **ZIP archive list**
scripts/compress-demo.ts  — **npm run demo:compress**
supabase/migrations/0004* — **archives / stories_seen / crawl_runs / RLS**
supabase/migrations/0005* — **cron: every 8 hours**
supabase/migrations/0006* — **folder_type: personal_profile | page**
```

## Not yet handled

- Instagram (Facebook first, per the build plan).
- Live name/avatar resolution for folders (TODO in resolve-link.ts).
- Video recompression (videos archive at original size for now).
- Backoff beyond what's there: `consecutive_failures` stretches the
  automated sweep's per-folder gap to ~24h after 3 failures and ~48h
  after 6 (tuned to the 8h interval in `shouldAttemptRecheck`);
  manual "recheck now" always bypasses backoff.
