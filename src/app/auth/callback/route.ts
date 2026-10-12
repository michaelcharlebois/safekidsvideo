import { NextResponse, type NextRequest } from "next/server";
import { supabaseAuthClient } from "@/lib/supabase/server";

/** Magic-link landing: exchange the code for a session, then continue. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/parent";
  const safeNext = next.startsWith("/") ? next : "/parent";
  if (code) {
    const sb = await supabaseAuthClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
