import { redirect } from "next/navigation";

/**
 * Registration lives on the login page (it toggles between sign-in and
 * sign-up against Supabase Auth) — /register exists so the spec's route
 * name resolves somewhere sensible.
 */
export default function RegisterPage() {
  redirect("/login");
}
