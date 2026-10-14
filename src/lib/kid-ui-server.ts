import "server-only";
import { cookies, headers } from "next/headers";
import { chooseKidUi, KID_UI_COOKIE, type KidUiChoice } from "@/lib/form-factor";

/** The kid interface for this request (URL ?ui= wins, then the remembered cookie, then the user agent). */
export async function kidUi(urlOverride?: string | string[]): Promise<KidUiChoice> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const override = typeof urlOverride === "string" ? urlOverride : jar.get(KID_UI_COOKIE)?.value;
  return chooseKidUi(h.get("user-agent") ?? "", override);
}
