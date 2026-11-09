-- 0004 (v2): folders-by-link identity columns, per-crawl ZIP archives,
-- story-id dedupe ledger, and crawl run logging — all user-owned.
--
-- Naming note: v1's `watched_links` IS the v2 spec's "folders" (one row =
-- one watched person, created by pasting a link). We extend that table
-- instead of creating a parallel `folders` table, so existing data, the
-- consent gate, and all v1 code paths keep working. The new tables below
-- use the spec's names (stories_seen / archives / crawl_runs).

-- 1) Identity resolved from the pasted link (see src/lib/resolve-link.ts).
--    Nullable: profile links may not expose a bucket id and vice versa,
--    and name/avatar resolution from Facebook is best-effort (TODO in the
--    resolver — a story link alone reliably yields only the bucket id).
alter table watched_links add column if not exists fb_bucket_id text;
alter table watched_links add column if not exists fb_profile_id text;
alter table watched_links add column if not exists avatar_url text;

-- 2) Archives: one row per crawl that found new stories. The ZIP itself
--    lives in the existing private `story-archive` bucket at
--    {user_id}/{watched_link_id}/{YYYY-MM-DD}/{crawl_id}.zip
create table if not exists archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watched_link_id uuid not null references watched_links(id) on delete cascade,
  crawl_id uuid not null,
  zip_path text not null,
  zip_size_bytes bigint not null default 0,
  story_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists archives_by_link on archives (watched_link_id, created_at desc);
create index if not exists archives_by_user on archives (user_id, created_at desc);

-- 3) stories_seen: dedupe ledger keyed by Facebook's own story id.
--    v1 deduped by content hash (still kept on `stories`); a stable
--    fb_story_id lets the crawl skip already-archived stories BEFORE
--    downloading anything (spec §4 step 2).
create table if not exists stories_seen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  watched_link_id uuid not null references watched_links(id) on delete cascade,
  fb_story_id text not null,
  first_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  archive_id uuid references archives(id) on delete set null,
  unique (watched_link_id, fb_story_id)
);

create index if not exists stories_seen_by_link on stories_seen (watched_link_id);

-- 4) crawl_runs: one row per sweep (cron or manual), so the admin page
--    can show what happened — including fb_session_expired when the
--    optional session fallback is configured and dies (see README:
--    a session is NOT required; session-free extraction runs first).
create table if not exists crawl_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'error')),
  folders_checked int not null default 0,
  new_stories int not null default 0,
  error_summary text
);

-- 5) RLS: v1 enabled RLS with zero policies (service-role-only access).
--    v2 keeps that pattern AND adds owner policies for the `authenticated`
--    role, so a logged-in user can only ever touch their own rows even if
--    a future client-side query is added. Service role bypasses RLS as
--    before and remains the app's actual data path.
alter table archives enable row level security;
alter table stories_seen enable row level security;
alter table crawl_runs enable row level security;

create policy archives_owner_select on archives
  for select to authenticated using (user_id = auth.uid());
create policy archives_owner_insert on archives
  for insert to authenticated with check (user_id = auth.uid());
create policy archives_owner_delete on archives
  for delete to authenticated using (user_id = auth.uid());

create policy stories_seen_owner_select on stories_seen
  for select to authenticated using (user_id = auth.uid());
create policy stories_seen_owner_insert on stories_seen
  for insert to authenticated with check (user_id = auth.uid());
create policy stories_seen_owner_delete on stories_seen
  for delete to authenticated using (user_id = auth.uid());

create policy watched_links_owner_select on watched_links
  for select to authenticated using (user_id = auth.uid());
create policy watched_links_owner_insert on watched_links
  for insert to authenticated with check (user_id = auth.uid());
create policy watched_links_owner_update on watched_links
  for update to authenticated using (user_id = auth.uid());
create policy watched_links_owner_delete on watched_links
  for delete to authenticated using (user_id = auth.uid());

-- crawl_runs are global (a sweep covers every user), so no per-user
-- policy: authenticated gets no direct access; the admin page reads them
-- through a service-role API route after an auth check.
