// Asks for more time: daily minutes ("limit") and a one-night bedtime extension ("bedtime"). What a stored
// request means for the kid screen and the parent's inbox. Pure. The record is authoritative (migrations
// 0022/0023, or the local store); push is only a heads-up.

export type TimeRequestKind = "limit" | "bedtime";
export type TimeRequest = {
  id: string; familyId: string; profileId: string; kind: TimeRequestKind;
  /** limit: the family-local day. bedtime: the night (the evening's local date). */
  day: string;
  status: "pending" | "approved" | "denied";
  grantedMinutes?: 15 | 30 | 45 | 60;
  deviceId?: string; createdAt: string; resolvedAt?: string;
};
/** Daily-minute grants (bedtime extensions have their own steps, lib/bedtime.ts). */
export const GRANT_MINUTES = [15, 30, 60] as const;
export const isGrant = (m: number): m is (typeof GRANT_MINUTES)[number] => (GRANT_MINUTES as readonly number[]).includes(m);

/**
 * What the time-up screen offers this child now.
 *  - limit (daily minutes ran out): can-ask; pending; declined (not again today); after an approval whose
 *    time also ran out, can-ask again. One pending ask per day.
 *  - bedtime: ONE ask per night. can-ask until then; pending; declined ("not tonight"); fulfilled (an
 *    extension was granted and has run out: no second ask). Not offered when tonight already has the
 *    maximum extension.
 * Asks for an earlier day or night are expired and ignored.
 */
export type TimeAskState = "not-offered" | "can-ask" | "pending" | "declined" | "fulfilled";
export function timeAskState(
  reason: "limit" | "bedtime", requests: TimeRequest[], profileId: string,
  when: { today: string; night: string; extensionMinutes?: number },
): TimeAskState {
  const day = reason === "bedtime" ? when.night : when.today;
  const latest = requests
    .filter((r) => r.profileId === profileId && r.kind === reason && r.day === day)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (reason === "bedtime") {
    if (latest) return latest.status === "pending" ? "pending" : latest.status === "denied" ? "declined" : "fulfilled";
    return (when.extensionMinutes ?? 0) >= 60 ? "not-offered" : "can-ask";
  }
  if (!latest) return "can-ask";
  return latest.status === "pending" ? "pending" : latest.status === "denied" ? "declined" : "can-ask";
}

/** The parent's inbox: pending asks for today (limit) or tonight (bedtime), oldest first. */
export const liveTimeRequests = (requests: TimeRequest[], today: string, night: string) =>
  requests.filter((r) => r.status === "pending" && r.day === (r.kind === "bedtime" ? night : today)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
