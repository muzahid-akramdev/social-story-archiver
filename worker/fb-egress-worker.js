// fb-egress-worker — Cloudflare Worker egress proxy for the story
// archiver (deployed 2026-11-10 at the owner's direction).
//
// WHY: the archiver's dedicated-session GraphQL calls from Vercel's
// datacenter IPs draw Facebook's generic gateway refusal (error
// 1357004, 249 bytes) even with a valid session, a fresh fb_dtsg and
// the full Comet boot field set — while the same account sees the
// stories fine in the app. This Worker gives those calls a different
// egress: the Vercel app sends each dedicated-session request here,
// and the Worker performs the actual facebook.com fetch from
// Cloudflare's network, returning the raw body plus the upstream
// status and final URL as headers.
//
// SAFETY SHAPE:
// - POST only, gated by a shared secret (EGRESS_SECRET env var,
//   compared against the x-egress-secret header). No secret, no fetch.
// - Destination hosts are allowlisted to facebook.com / fbcdn.net
//   (and subdomains) — even with the secret this is not an open proxy.
// - It is a dumb pipe: it forwards method/headers/body verbatim and
//   returns the response verbatim. All extraction logic, the
//   never-seen guard (query-only, never the seen-mutation family),
//   and cookie handling stay in the app; the session cookie arrives
//   per-request in the forwarded headers from the app's server env,
//   is never stored here, and is never logged.

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const secret = request.headers.get("x-egress-secret");
    if (!env.EGRESS_SECRET || !secret || secret !== env.EGRESS_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }
    const { url, method = "GET", headers = {}, body = null } = payload ?? {};

    let target;
    try {
      target = new URL(url);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    const host = target.hostname;
    if (
      !/(^|\.)facebook\.com$/.test(host) &&
      !/(^|\.)fbcdn\.net$/.test(host)
    ) {
      return new Response("host not allowed", { status: 403 });
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method,
        headers,
        body: body ?? undefined,
        redirect: "follow",
      });
    } catch {
      return new Response("upstream fetch failed", { status: 502 });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: 200,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ??
          "text/plain; charset=utf-8",
        "x-egress-upstream-status": String(upstream.status),
        "x-egress-final-url": upstream.url,
      },
    });
  },
};
