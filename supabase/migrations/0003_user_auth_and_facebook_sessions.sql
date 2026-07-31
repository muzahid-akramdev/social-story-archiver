-- 0003: real per-user accounts + per-user Facebook session storage
--
-- Story archiving and private-group video downloads now require the app
-- user to be logged in (Supabase Auth) AND to have connected their own
-- Facebook session. Normal public-video download stays anonymous.

-- 1) Own the existing data per-user instead of single-tenant.
alter table watched_links add column user_id uuid references auth.users(id) on delete cascade;

-- If you already have rows from before this migration: sign up your app
-- account first, then run this once with your own auth.users id before
-- making the column required:
--   update watched_links set user_id = '<your-auth-user-id>' where user_id is null;
-- After backfilling:
--   alter table watched_links alter column user_id set not null;

create index if not exists watched_links_by_user on watched_links (user_id);

-- Was globally unique; now unique per user, since two different app users
-- may independently want to track the same public source_url.
alter table watched_links drop constraint if exists watched_links_source_url_key;
alter table watched_links add constraint watched_links_user_source_url_key unique (user_id, source_url);

-- 2) One Facebook session per app user. The raw cookie is encrypted at the
-- application layer (see src/lib/crypto.ts) before it ever reaches this
-- table, so a DB dump alone doesn't leak usable sessions.
create table if not exists facebook_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cookie_encrypted text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same pattern as the rest of this app (see 0001_init.sql): the browser
-- never talks to Supabase directly, only through our Next.js API routes
-- using the service-role key, after that route has already checked the
-- caller's session. So RLS is enabled with zero anon/authenticated
-- policies — defense against a leaked anon key or a future mistaken
-- client-side call, not the primary access control.
alter table facebook_sessions enable row level security;
