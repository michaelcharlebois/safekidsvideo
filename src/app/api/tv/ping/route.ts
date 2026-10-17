import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Reachability and clock check for the Samsung TV shell (tizen/shell.js), which runs from the app package
 * before the site opens. No cookies, no data: the server's time (to spot a wrong TV clock, which affects
 * bedtime countdowns on screen; the server enforces bedtime regardless) and the build.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, time: new Date().toISOString(), build: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7) },
    { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
  );
}
