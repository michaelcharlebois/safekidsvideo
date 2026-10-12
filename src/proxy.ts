import { NextResponse, type NextRequest } from "next/server";
import { PARENT_COOKIE } from "@/lib/auth";

/** Parent area requires the PIN cookie. Kid mode and public content cards do not. */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/parent") && req.cookies.get(PARENT_COOKIE)?.value !== "1") {
    const url = req.nextUrl.clone();
    url.pathname = "/unlock";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/parent/:path*"] };
