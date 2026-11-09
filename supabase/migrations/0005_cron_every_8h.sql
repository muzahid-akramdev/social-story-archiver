-- 0005 (v2): move the scheduled sweep from every 4 hours to every 8 hours
-- (owner's requirement, 2026-11-10). Stories live 24h, so an 8h cadence
-- still checks every story at least twice before it expires, while
-- halving the request volume against Facebook.
--
-- Cron expression: 0 */8 * * *   (00:00, 08:00, 16:00 UTC)
--
-- Before running: replace <your-app>.vercel.app and <cron-secret> below,
-- same as 0002_cron.sql. <cron-secret> must match the CRON_SECRET env var
-- on the deployment. Safe to run after 0002 — it unschedules the old job
-- name first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('recheck-watched-links')
where exists (select 1 from cron.job where jobname = 'recheck-watched-links');

select cron.schedule(
  'recheck-watched-links',
  '0 */8 * * *', -- v2: every 8 hours
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
