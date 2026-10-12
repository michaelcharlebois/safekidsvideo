import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: refresh approved channels and pre-review new uploads. Vercel Cron sends the bearer token. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPipeline({ maxReviews: 20, uploadsPerChannel: 10 });
  return NextResponse.json(result);
}
