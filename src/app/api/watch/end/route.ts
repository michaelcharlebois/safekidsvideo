import { NextResponse, type NextRequest } from "next/server";
import { resolveViewer } from "@/lib/family";
import { logWatchEnd } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * The end of a viewing session when the kid screen is closing (the TV app quits, the tab closes). Browsers
 * only reliably deliver one last request then via navigator.sendBeacon, which can't call a server action,
 * so this is the same as recordWatchEnd. Same-origin only; the child comes from the screen's own cookies;
 * one end per session (a duplicate is ignored by the database).
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403 });
  let body: { videoId?: unknown; outcome?: unknown; atSec?: unknown; watchedSec?: unknown; sessionId?: unknown };
  try { body = JSON.parse(await req.text()); } catch { return new NextResponse(null, { status: 400 }); }
  const videoId = String(body.videoId ?? ""), sessionId = String(body.sessionId ?? "");
  if (!/^[\w-]{11}$/.test(videoId) || body.outcome !== "left") return new NextResponse(null, { status: 400 });
  const v = await resolveViewer();
  if (!v.familyId || !v.profileId) return new NextResponse(null, { status: 204 });
  await logWatchEnd(v.familyId, videoId, v.profileId, "left", Number(body.atSec), sessionId, body.watchedSec == null ? undefined : Number(body.watchedSec));
  return new NextResponse(null, { status: 204 });
}
