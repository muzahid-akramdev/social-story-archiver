-- Scheduled recheck. Points at the Next.js app on Vercel (not a Supabase
-- Edge Function) so the extraction/upload/dedupe code lives in one place —
-- see src/app/api/cron/check-all-links/route.ts for why.
--
-- Before running: replace <your-app>.vercel.app and <cron-secret> below.
-- <cron-secret> must match the CRON_SECRET env var set on the Vercel
-- deployment. Generate one with: openssl rand -hex 32

create extension if not exists pg_net;

select cron.schedule(
  'recheck-watched-links',
  '0 */4 * * *', -- every 4 hours, on the hour; tune to taste (still comfortably inside the 24h story window)
  $$
  select net.http_post(
    url := 'https://<your-app>.vercel.app/api/cron/check-all-links',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <cron-secret>',
      'Content-Type', 'application/json'
    )
  );
  $$
);

-- Reminder from the original spec, still true here: Supabase Cron's
-- http_post is fire-and-forget — a failed run doesn't retry or alert, and
-- a paused project silently drops every tick. Fine for a personal tool. If
-- you want retries/alerting later, point an external scheduler (GitHub
-- Actions, cron-job.org, Vercel Cron) at the same URL instead — nothing
-- else about the app needs to change.
