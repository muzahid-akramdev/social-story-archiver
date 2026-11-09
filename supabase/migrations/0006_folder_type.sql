-- 0006 (v2): folder type — 'personal_profile' vs 'page'.
--
-- Owner decision (2026-11-10): when adding a folder, the user picks the
-- type with two buttons in the form (Personal Profile / Page). The
-- crawl branches on it (see src/lib/recheck.ts → story context):
--   personal_profile → storyphp-og first, then the generic fallbacks.
--   page             → storyphp-og attempted best-effort only; Page
--                      stories are not publicly previewable anonymously
--                      (login wall), so a walled attempt is recorded as
--                      the crawl diagnostic "page story: anonymous
--                      route unavailable" instead of a silent failure.
-- Existing rows default to 'personal_profile' (every folder created so
-- far watches a personal profile).

alter table watched_links
  add column if not exists folder_type text not null default 'personal_profile'
  check (folder_type in ('personal_profile', 'page'));
