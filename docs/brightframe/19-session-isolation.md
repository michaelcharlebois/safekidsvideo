# Parent / kid-screen session isolation

A browser is either a parent's or a kid screen, never both.

## Transitions
**Pairing a browser where a parent is signed in** (`pairDevice`):
1. The pairing code is checked first. A wrong, used or expired code returns an error and changes nothing; the parent stays signed in.
2. On success, the parent's session ends **in this browser only**. `signOut({ scope: "local" })` revokes just this session's refresh token on the auth server. Then every Supabase auth cookie is removed, including the split `.0`/`.1` chunks, along with the local-mode PIN cookie. The cookies are removed even if the auth server can't be reached.
3. The screen cookie is set, and the browser opens the kid screen.

The parent's phone and other browsers stay signed in. `/pair` says so before the parent connects.

**A parent signing in on a paired screen.** This applies to every sign-in path: email code (`verifyCode`), magic link (`/auth/callback`), token link (`/auth/confirm`) and staging QA (`qaSignIn`).
1. Sign-in is verified by the auth server first. A failed sign-in changes nothing; the screen keeps working.
2. On success, the screen whose token this browser holds is **disconnected**: its record is revoked, so no connected screen is left orphaned. Its cookie is removed. No other screen is touched.
3. The parent lands on Screens with a notice: "This browser was the kid screen X. It's now disconnected… To use it as a kid screen again, sign out and pair it with a new code."
4. If the disconnect fails, the cookie is still removed and Screens says to disconnect it by hand.
5. The login page warns about this before the parent signs in, and suggests signing in on another device to keep the screen connected.

Why disconnect rather than keep the screen? Keeping the record with no browser holding its token would leave a "connected" screen that can never be used again. Keeping the token alongside the parent session is exactly the dual state this change removes.

**Sign out** is this browser only (`scope: "local"`). Before this change it used Supabase's default, `"global"`, which signed the parent out on every device.

## When both credentials are present anyway
Both can be present in browsers from before this change, or when two tabs race. A **valid, non-revoked screen token wins** over the parent session (`resolveViewer`).

- **Why the screen wins:** it fails safe. A parent session forgotten on a child's TV no longer grants parent pages or actions. Before, it did, including switching children on a shared screen without the PIN. A parent who hits this just signs in again, which disconnects the screen with the notice above.
- **Ignored tokens:** a revoked or unknown screen token is ignored, as before.
- **Lookup errors:** if the screen token can't be checked, nothing is granted. There's no fall-through to a parent session that might be a leftover.
- **Proof of parent access:** parent access always needs a session verified by the auth server (`getUser`). A screen token never grants it, and neither does the family PIN: `unlock` refuses in account mode, and the PIN cookie is ignored there.

## Tests
- **`test/session-isolation.test.ts`:** the real actions and auth routes, against stand-ins with server-side sessions and one cookie jar per browser shared by its tabs. All eight review scenarios are covered, plus local versus global sign-out, server-side revocation, and the disconnect-failure path. Each protection was broken in turn to confirm a test fails.
- **`scripts/e2e/session-isolation.sh`:** the built app in account mode against `scripts/e2e/fake-supabase.cjs`, run in real Chromium. It covers real split cookies, two tabs in one browser, a phone, replaying the old session, and sign-in on a paired screen.
