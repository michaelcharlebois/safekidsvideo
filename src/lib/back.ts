// "Back" for detail pages (a video, a channel): return to where the parent came from, carried as
// ?from=review|library|home (&kid=). Detail pages belong to Library, so that is the default. Pure.

export type BackLink = { href: string; label: string };
const KID = /^[\w-]{1,64}$/;

export function backLink(sp: Record<string, string | string[] | undefined>): BackLink {
  const from = typeof sp.from === "string" ? sp.from : "";
  const kid = typeof sp.kid === "string" && KID.test(sp.kid) ? sp.kid : "";
  const q = kid ? `?kid=${kid}` : "";
  if (from === "review") return { href: `/parent/review${q}`, label: "Review" };
  if (from === "home") return { href: `/parent${q}`, label: "Home" };
  return { href: `/parent/library${q}`, label: "Library" };
}

/** A detail-page link that remembers where it was opened from. */
export const detailHref = (path: string, from: "review" | "library" | "home", kid?: string | null) =>
  `${path}?from=${from}${kid && KID.test(kid) ? `&kid=${kid}` : ""}`;
