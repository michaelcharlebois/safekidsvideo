import { NextResponse, type NextRequest } from "next/server";
import { runDiscovery, runPipeline } from "@/lib/pipeline";
import { learnFromFeedback, rereviewDisputed } from "@/lib/learn";
import { authorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: refresh approved channels and pre-review new uploads. Vercel Cron sends the bearer token. */
export async function GET(req: NextRequest) {
  if (!authorizedCronRequest(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result = await runPipeline({ maxReviews: 10, uploadsPerChannel: 10 });
  // Shared library next, with whatever time is left (Hobby plan allows two daily crons; the other is the evening check-in).
  const discovery = await runDiscovery({ max: 25, budgetMs: Math.max(30_000, 230_000 - (Date.now() - started)) });
  // Then learn from whatever parents said since last night, and give disputed cards a second look.
  let learned: number | null = null, rereviewed = { reviewed: 0, failed: 0 };
  try { learned = (await learnFromFeedback({ minDisagreements: 1 }))?.version ?? null; } catch (e) { console.error("learn failed", e); }
  try { rereviewed = await rereviewDisputed({ max: 3 }); } catch (e) { console.error("re-review failed", e); }
  return NextResponse.json({ ...result, discovery, notesVersion: learned, rereviewed });
}
