// "Last active" for a paired screen on the parent's Screens page, in the family's time zone. Activity is
// recorded at most every 5 minutes (LAST_SEEN_EVERY_MS in lib/family.ts), so anything newer reads as
// "in the last 5 minutes" rather than a precise "just now".

const THROTTLE_MIN = 5;

export function lastActiveLabel(iso: string | null | undefined, now: number, tz?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "Not used yet";
  const zone = tz || "America/Los_Angeles";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < THROTTLE_MIN) return `Active in the last ${THROTTLE_MIN} minutes`;
  if (mins < 60) return `Active ${mins} minutes ago`;
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: zone });
  const clock = new Date(t).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  if (day(t) === day(now)) return `Last active today at ${clock}`;
  if (day(t) === day(now - 86_400_000)) return `Last active yesterday at ${clock}`;
  const sameYear = day(t).slice(0, 4) === day(now).slice(0, 4);
  const date = new Date(t).toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `Last active ${date}`;
}
