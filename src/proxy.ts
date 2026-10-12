import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { PARENT_COOKIE } from "@/lib/auth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Local mode: /parent requires the PIN cookie.
 * Supabase mode: refresh the auth session cookie on every request and require a user for /parent.
 */
export async function proxy(req: NextRequest) {
  const wantsParent = req.nextUrl.pathname.startsWith("/parent");

  if (!url || !key) {
    if (wantsParent && req.cookies.get(PARENT_COOKIE)?.value !== "1") {
      return redirectTo(req, "/unlock");
    }
    return NextResponse.next();
  }

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of toSet) res.cookies.set(name, value, options);
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (wantsParent && !user) return redirectTo(req, "/login");
  return res;
}

function redirectTo(req: NextRequest, path: string) {
  const u = req.nextUrl.clone();
  u.pathname = path;
  u.search = "";
  u.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(u);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest).*)"],
};
