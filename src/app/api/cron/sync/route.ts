import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { learnFromFeedback, rereviewDisputed } from "@/lib/learn";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: refresh approved channels and pre-review new uploads. Vercel Cron sends the bearer token. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPipeline({ maxReviews: 15, uploadsPerChannel: 10 });
  // Then learn from whatever parents said since last night, and give disputed cards a second look.
  let learned: number | null = null, rereviewed = { reviewed: 0, failed: 0 };
  try { learned = (await learnFromFeedback({ minDisagreements: 1 }))?.version ?? null; } catch (e) { console.error("learn failed", e); }
  try { rereviewed = await rereviewDisputed({ max: 3 }); } catch (e) { console.error("re-review failed", e); }
  return NextResponse.json({ ...result, notesVersion: learned, rereviewed });
}
