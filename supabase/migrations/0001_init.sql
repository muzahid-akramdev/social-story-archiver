-- Social Story Archiver — initial schema
-- Scoped to: a specific, consenting handful of people, not arbitrary public links.
-- See README.md "Consent gate" section for why the extra columns below exist.

create table watched_links (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  platform text not null check (platform in ('facebook', 'instagram')),
  label text,

  -- Consent gate: who this actually is, and an explicit attestation that
  -- they've agreed to be archived. Required at the API layer before a row
  -- can be created — see POST /api/links. Not real enforcement (nothing
  -- can verify an offline conversation happened) but it replaces "paste
  -- and forget" with a deliberate step, and keeps the tool's own data
  -- honest about what it's for.
  friend_name text not null,
  consent_confirmed boolean not null default false,
  consent_note text, -- optional: how/when you confirmed, for your own memory

  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_new_story_at timestamptz,
  consecutive_failures int not null default 0,
  is_active boolean not null default true
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  watched_link_id uuid not null references watched_links(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  content_hash text not null,
  posted_at timestamptz,
  archived_at timestamptz not null default now(),
  unique (watched_link_id, content_hash)
);

create index stories_by_link on stories (watched_link_id, archived_at desc);

-- RLS: this app has no end-user auth, so the browser never talks to Supabase
-- directly. All reads/writes go through Next.js API routes using the
-- service-role key server-side (which bypasses RLS by design). Enabling RLS
-- with no policies for anon/authenticated means a leaked anon key, or a
-- future client-side Supabase call someone adds by mistake, can't touch
-- this data at all.
alter table watched_links enable row level security;
alter table stories enable row level security;

-- Storage: private bucket. Archived content is personal (friends' photos
-- and videos), so it should never be reachable via a guessable public URL —
-- the app serves it through signed URLs generated server-side on demand.
insert into storage.buckets (id, name, public)
values ('story-archive', 'story-archive', false)
on conflict (id) do nothing;
