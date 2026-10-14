// Which kid interface to show. Presentation only: every interface shows the same authorized content.
export type KidUi = "tv" | "tablet" | "phone";
export const KID_UI_COOKIE = "bf_ui";
export type KidUiChoice = KidUi | "touch"; // "touch" = decide tablet vs phone by width, in CSS

const TV_UA = /Tizen|SMART-TV|SmartTV|Web0S|webOS.TV|NetCast|Android TV|GoogleTV|AFT[A-Z]|BRAVIA|CrKey|HbbTV|Viera|AppleTV/i;

export const isTvUserAgent = (ua: string) => TV_UA.test(ua);
export const isKidUi = (x: unknown): x is KidUi => x === "tv" || x === "tablet" || x === "phone";

/** An explicit choice (URL or remembered cookie) wins; otherwise a TV engine gets TV, everything else touch. */
export function chooseKidUi(ua: string, override?: string | null): KidUiChoice {
  if (isKidUi(override)) return override;
  return isTvUserAgent(ua) ? "tv" : "touch";
}
