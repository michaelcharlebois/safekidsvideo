import "server-only";
import { cookies } from "next/headers";
import { PARENT_COOKIE } from "@/lib/auth";
import { DEVICE_COOKIE, revokeDeviceToken } from "@/lib/family";
import { supabaseAuthClient } from "@/lib/supabase/server";

// A browser is either a parent's or a kid screen, never both (docs/brightframe/19-session-isolation.md).
//   Pairing succeeds        → this browser's parent session ends (here only), then it becomes the screen.
//   Parent sign-in succeeds → this browser's screen is disconnected (its record revoked), then it's the parent's.

/** Supabase's session cookies: sb-<project-ref>-auth-token, split into .0, .1, … when large. */
export const SUPABASE_AUTH_COOKIE = /^sb-[a-z0-9]+-auth-token(\.\d+)?$/;

/**
 * End the parent's session in THIS browser only. scope: "local" revokes just this session's refresh token on
 * the auth server (the parent's phone and other browsers stay signed in; the default scope is "global",
 * which would sign them out everywhere). Then every Supabase auth cookie and the local-mode PIN cookie are
 * removed, even if the auth server couldn't be reached, so nothing parent-shaped is left in this browser.
 */
export async function endParentSessionHere(): Promise<void> {
  try {
    const sb = await supabaseAuthClient();
    const { error } = await sb.auth.signOut({ scope: "local" });
    if (error) console.error("local sign-out: auth server error (cookies are cleared anyway)", error.message);
  } catch (e) {
    console.error("local sign-out failed (cookies are cleared anyway)", e instanceof Error ? e.message : e);
  }
  const c = await cookies();
  for (const { name } of c.getAll()) if (SUPABASE_AUTH_COOKIE.test(name)) c.delete(name);
  c.delete(PARENT_COOKIE);
}

export type ScreenHandOver = { screen: null } | { screen: string; disconnected: boolean };

/**
 * Called right after a parent's sign-in has been verified by the auth server, from every sign-in path
 * (email code, magic link, token link, staging QA). If this browser was a kid screen, its device record is
 * revoked and its cookie removed. The cookie goes even if the revoke fails (the caller then tells the parent
 * to disconnect it on Screens), so the browser never holds both credentials.
 */
export async function takeOverScreenForParent(): Promise<ScreenHandOver> {
  const c = await cookies();
  const token = c.get(DEVICE_COOKIE)?.value;
  if (!token) return { screen: null };
  c.delete(DEVICE_COOKIE);
  const r = await revokeDeviceToken(token);
  if (r.status === "none") return { screen: null };     // a stale or already-disconnected cookie: nothing to do
  return { screen: r.name ?? "this kid screen", disconnected: r.status === "revoked" };
}

/** Where a parent goes after signing in: their page, or Screens to explain the screen they took over. */
export function afterSignInPath(next: string, h: ScreenHandOver): string {
  if (!h.screen) return next;
  return h.disconnected
    ? `/parent/devices?converted=${encodeURIComponent(h.screen)}`
    : `/parent/devices?error=${encodeURIComponent(`This browser was the kid screen "${h.screen}". It's no longer a kid screen, but it couldn't be disconnected automatically: disconnect it below.`)}`;
}
