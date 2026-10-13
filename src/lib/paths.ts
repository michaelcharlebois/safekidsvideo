// Return paths for "come back to where you were" redirects. Pure.

/** Same-site path only ("/x", not "//host" or "/\host"), so a form's `next` can't redirect off-site. */
export const isLocalPath = (p: string) => p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\");

/** Add or replace a query parameter, keeping any #fragment at the end. */
export function withParam(path: string, key: string, value: string): string {
  const [beforeHash, hash] = path.split("#", 2);
  const [base, query = ""] = beforeHash.split("?", 2);
  const q = new URLSearchParams(query);
  q.set(key, value);
  return `${base}?${q.toString()}${hash !== undefined ? `#${hash}` : ""}`;
}
