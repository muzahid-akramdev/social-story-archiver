import "server-only";
import { supabaseRoute } from "@/lib/supabase/route";

export async function getAuthUser() {
  const supabase = supabaseRoute();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
