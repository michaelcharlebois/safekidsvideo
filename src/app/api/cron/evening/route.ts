import { NextResponse, type NextRequest } from "next/server";
import { sendCheckinNudges } from "@/lib/checkin";
import { authorizedCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Evening: "How was he today?" push to families whose kids watched today. */
export async function GET(req: NextRequest) {
  if (!authorizedCronRequest(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sent = await sendCheckinNudges((s) => console.log(s));
  return NextResponse.json({ sent });
}
