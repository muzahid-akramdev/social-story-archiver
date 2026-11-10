# fb-egress-worker

Cloudflare Worker that performs the story archiver's dedicated-session
Facebook fetches from Cloudflare's network instead of Vercel's
datacenter IPs (which draw Facebook's generic GraphQL refusal,
error 1357004). See the header comment in `fb-egress-worker.js`.

## Deploy (Cloudflare dashboard)

1. Workers & Pages → Create → Create Worker. Name: `fb-egress`.
2. Replace the default code with `fb-egress-worker.js`, Deploy.
3. Worker → Settings → Variables and Secrets: add a **Secret**
   named `EGRESS_SECRET` — the same value as the app's
   `FB_EGRESS_PROXY_SECRET` Vercel env var.
4. Note the Worker URL (`https://fb-egress.<subdomain>.workers.dev`)
   and set it as the app's `FB_EGRESS_PROXY_URL` Vercel env var.

When both `FB_EGRESS_PROXY_URL` and `FB_EGRESS_PROXY_SECRET` are set,
every dedicated-session fetch in `src/lib/extraction/facebook.ts`
(dtsg bootstrap, bucket discovery, stories SSR legs, the GraphQL
POST) routes through the Worker via `sessionFetch`. When unset, the
app fetches directly, exactly as before. The GraphQL shape census in
crawl results carries `egress=worker|direct` so a crawl proves which
path it took.
