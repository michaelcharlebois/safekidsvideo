import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { supabaseAuthClient } from "@/lib/supabase/server";
import { DEMO_EMAIL, demoKeyOk, ensureDemoFamily, ensureDemoUser } from "@/lib/demo";
import { DEVICE_COOKIE, PROFILE_COOKIE } from "@/lib/family";

export const dynamic = "force-dynamic";

/** /demo/parent?key=… — sign in as the demo parent and land on the dashboard. */
export async function GET(req: NextRequest) {
  if (!demoKeyOk(req.nextUrl.searchParams.get("key"))) return new NextResponse("Not found", { status: 404 });
  try {
    return await enter(req);
  } catch (e) {
    console.error("demo parent failed", e);
    return new NextResponse(`Demo setup failed: ${(e as Error).message}`, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function enter(req: NextRequest) {
  const userId = await ensureDemoUser();
  await ensureDemoFamily(userId, req.nextUrl.searchParams.get("reset") === "1");
  const c = await cookies();
  c.delete(DEVICE_COOKIE);
  c.delete(PROFILE_COOKIE);
  const sb = await supabaseAuthClient();
  const { error } = await sb.auth.signInWithPassword({ email: DEMO_EMAIL, password: process.env.DEMO_PASSWORD! });
  if (error) return new NextResponse(`Demo sign-in failed: ${error.message}`, { status: 500 });
  return NextResponse.redirect(new URL("/parent", req.url));
}
