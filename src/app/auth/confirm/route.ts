import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseAuthClient } from "@/lib/supabase/server";
import { isLocalPath } from "@/lib/paths";

/**
 * Link fallback for the sign-in email. Uses token_hash verification, which (unlike the
 * PKCE code flow) does not require the link to open in the browser that requested it.
 * The Supabase "Magic Link" email template must point here — see README.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "magiclink") as EmailOtpType;
  const next = url.searchParams.get("next") ?? "/parent";
  const safeNext = isLocalPath(next) ? next : "/parent";
  if (token_hash) {
    const sb = await supabaseAuthClient();
    const { error } = await sb.auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
