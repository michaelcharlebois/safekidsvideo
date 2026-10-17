"use server";

import { redirect } from "next/navigation";
import { qaFamilyFor, qaLoginEnabled } from "@/lib/qa-login";
import { supabaseAdmin, supabaseAuthClient } from "@/lib/supabase/server";
import { afterSignInPath, takeOverScreenForParent } from "@/lib/session-transition";

/** POST-only: no emails or tokens exposed to the browser, and no new users or families. */
export async function qaSignIn(form: FormData) {
  if (!qaLoginEnabled()) redirect("/login");
  const chosen = qaFamilyFor(form.get("family"));
  if (!chosen) redirect("/login?error=qa");

  const admin = supabaseAdmin();
  const { data: family, error: familyError } = await admin.from("families")
    .select("owner_user_id").eq("id", chosen.familyId).maybeSingle();
  if (familyError || !family?.owner_user_id) redirect("/login?error=qa");

  const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(family.owner_user_id);
  if (ownerError || !owner.user || owner.user.email?.toLowerCase() !== chosen.email) redirect("/login?error=qa");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink", email: chosen.email,
  });
  if (linkError || link.user?.id !== owner.user.id || !link.properties?.hashed_token) redirect("/login?error=qa");

  const sb = await supabaseAuthClient();
  const { data: signedIn, error: verifyError } = await sb.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: "magiclink",
  });
  if (verifyError || signedIn.user?.id !== owner.user.id) redirect("/login?error=qa");

  // Same rule as every other sign-in: if this browser was a kid screen, it stops being one.
  redirect(afterSignInPath("/parent", await takeOverScreenForParent()));
}
