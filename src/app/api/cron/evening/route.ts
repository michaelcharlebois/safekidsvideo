import { NextResponse, type NextRequest } from "next/server";
import { sendCheckinNudges } from "@/lib/checkin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Evening: "How was he today?" push to families whose kids watched today. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sent = await sendCheckinNudges((s) => console.log(s));
  return NextResponse.json({ sent });
}
