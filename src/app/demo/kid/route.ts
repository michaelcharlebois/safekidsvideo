import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { supabaseAuthClient } from "@/lib/supabase/server";
import { demoKeyOk, ensureDemoFamily, ensureDemoUser } from "@/lib/demo";
import { createDeviceToken, DEVICE_COOKIE, PROFILE_COOKIE } from "@/lib/family";

export const dynamic = "force-dynamic";

/** /demo/kid?key=… — this browser becomes a paired kid screen in the demo family. */
export async function GET(req: NextRequest) {
  if (!demoKeyOk(req.nextUrl.searchParams.get("key"))) return new NextResponse("Not found", { status: 404 });
  try {
    return await enter(req);
  } catch (e) {
    console.error("demo kid failed", e);
    return new NextResponse(`Demo setup failed: ${(e as Error).message}`, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function enter(req: NextRequest) {
  const userId = await ensureDemoUser();
  const fid = await ensureDemoFamily(userId);
  // A kid screen isn't signed in as anyone: drop any parent session in this browser.
  const sb = await supabaseAuthClient();
  await sb.auth.signOut();
  const token = await createDeviceToken(fid, "Demo screen");
  const c = await cookies();
  c.set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
  c.delete(PROFILE_COOKIE);
  return NextResponse.redirect(new URL("/watch/who", req.url));
}
