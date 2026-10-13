import { NextResponse, type NextRequest } from "next/server";
import { runDiscovery } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Nightly: keep the curated popular-kids-channels list reviewed for everyone. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDiscovery({ max: 25, budgetMs: 240_000 });
  return NextResponse.json(result);
}
