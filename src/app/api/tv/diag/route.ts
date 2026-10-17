import { NextResponse, type NextRequest } from "next/server";
import { resolveViewer } from "@/lib/family";

export const dynamic = "force-dynamic";

const KINDS = new Set(["js", "promise", "network", "player", "pairing", "page"]);

/**
 * Device-side diagnostics from a kid screen (lib/tv-diagnostics.ts), written to the server log so a pilot TV
 * can be debugged without a cable. Same-origin only; accepted from a paired screen or a signed-in parent (an
 * unpaired screen's pairing failures are logged without an identity). Truncated; never stored.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403 });
  let d: { kind?: unknown; detail?: unknown; path?: unknown; at?: unknown };
  try { d = JSON.parse((await req.text()).slice(0, 2000)); } catch { return new NextResponse(null, { status: 400 }); }
  const kind = String(d.kind ?? "");
  if (!KINDS.has(kind)) return new NextResponse(null, { status: 400 });
  const v = await resolveViewer();
  if (v.role === "none" && kind !== "pairing" && kind !== "network") return new NextResponse(null, { status: 204 });
  const who = v.role === "device" ? `screen ${v.deviceId} (${v.deviceName})` : v.role === "parent" ? `parent family ${v.familyId}` : "unpaired screen";
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 160);
  console.warn(`[tv-diag] ${kind} · ${who} · ${String(d.path ?? "").slice(0, 120)} · ${String(d.detail ?? "").slice(0, 300)} · ${ua}`);
  return new NextResponse(null, { status: 204 });
}
