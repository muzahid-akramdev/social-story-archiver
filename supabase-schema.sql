-- Supabase Schema for Social Story Archiver

-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Watched Links table
create table if not exists watched_links (
  id uuid primary key default uuid_generate_v4(),
  source_url text not null unique,
  platform text not null check (platform in ('facebook', 'instagram')),
  label text,
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_new_story_at timestamptz,
  is_active boolean not null default true
);

-- Stories table
create table if not exists stories (
  id uuid primary key default uuid_generate_v4(),
  watched_link_id uuid not null references watched_links(id) on delete cascade,
  storage_path text not null,
  media_type text not null check (media_type in ('image', 'video')),
  content_hash text not null,
  posted_at timestamptz,
  archived_at timestamptz not null default now(),
  unique (watched_link_id, content_hash)
);

-- Indexes
create index if not exists idx_stories_by_link on stories (watched_link_id, archived_at desc);
create index if not exists idx_watched_links_active on watched_links (is_active) where is_active = true;

-- RLS Policies (adjust as needed for single-user)
alter table watched_links enable row level security;
alter table stories enable row level security;

-- For single user / public for now (tighten later)
create policy "Allow all for watched_links" on watched_links for all using (true);
create policy "Allow all for stories" on stories for all using (true);

comment on table watched_links is 'Tracked story sources';
comment on table stories is 'Archived story media items';
