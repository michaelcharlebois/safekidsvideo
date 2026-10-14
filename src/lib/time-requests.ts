// "Ask a grown-up for more time": what a stored request means for the kid screen and the parent inbox. Pure.
// The record is authoritative (migration 0022 / local store); push is only a heads-up.

export type TimeRequestKind = "limit";
export type TimeRequest = {
  id: string; familyId: string; profileId: string; kind: TimeRequestKind;
  /** Family-local day (YYYY-MM-DD) the request is for. */
  day: string;
  status: "pending" | "approved" | "denied";
  grantedMinutes?: 15 | 30 | 60;
  deviceId?: string; createdAt: string; resolvedAt?: string;
};
export const GRANT_MINUTES = [15, 30, 60] as const;
export const isGrant = (m: number): m is (typeof GRANT_MINUTES)[number] => (GRANT_MINUTES as readonly number[]).includes(m);

/**
 * What the time-up screen offers this child now.
 *  - not-offered: bedtime (a separate restriction; extra minutes don't lift it, so we don't ask for them)
 *  - pending: today's ask is waiting for a grown-up (from any screen)
 *  - declined: a grown-up said not today; no asking again today
 *  - can-ask: nothing asked today, or the last ask was approved and that time has run out too
 * Requests for an earlier day are expired and ignored.
 */
export type TimeAskState = "not-offered" | "can-ask" | "pending" | "declined";
export function timeAskState(reason: "limit" | "bedtime", requests: TimeRequest[], profileId: string, today: string): TimeAskState {
  if (reason === "bedtime") return "not-offered";
  const latest = requests
    .filter((r) => r.profileId === profileId && r.kind === "limit" && r.day === today)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest) return "can-ask";
  return latest.status === "pending" ? "pending" : latest.status === "denied" ? "declined" : "can-ask";
}

/** The parent's inbox: today's pending asks (an earlier day's pending ask has expired), oldest first. */
export const liveTimeRequests = (requests: TimeRequest[], today: string) =>
  requests.filter((r) => r.status === "pending" && r.day === today).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
