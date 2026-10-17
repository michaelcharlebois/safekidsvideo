import { NextResponse, type NextRequest } from "next/server";
import { supabaseAuthClient } from "@/lib/supabase/server";
import { isLocalPath } from "@/lib/paths";
import { afterSignInPath, takeOverScreenForParent } from "@/lib/session-transition";

/** Magic-link landing: exchange the code for a session, then continue. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/parent";
  const safeNext = isLocalPath(next) ? next : "/parent";
  if (code) {
    const sb = await supabaseAuthClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    // Verified: if this browser was a kid screen, it stops being one (disconnected, cookie removed).
    if (!error) return NextResponse.redirect(new URL(afterSignInPath(safeNext, await takeOverScreenForParent()), url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
