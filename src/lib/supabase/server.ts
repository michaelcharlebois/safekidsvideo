import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseEnabled = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/** Auth client bound to the request's cookies. Use for sign-in/out and reading the session. */
export async function supabaseAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * Data client with the secret key. Server-only; bypasses RLS, so every caller must
 * resolve the family id through `resolveFamily()` first and scope queries to it.
 */
let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set (server needs it to read/write data)");
  admin ??= createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
