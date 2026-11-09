/**
 * v2 spec names the per-user home `/dashboard`. The v1 home page at `/`
 * already IS the logged-in user's dashboard (their folders, scoped by
 * user_id), so /dashboard renders exactly that component — one
 * implementation, two routes, no drift.
 */
export { default } from "../page";
