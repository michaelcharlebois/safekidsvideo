// Viewing sessions: the ONE interpretation of watch_events that every viewing number uses — Activity (time,
// history, patterns), Home's "today", daily screen-time limits and the evening check-in. Pure.
//
// The model (from migration 0020 on): one playback session = one start row (outcome null) and at most one
// end row (outcome = finished | skipped | left, ended_at_sec = how far it got), sharing a session_id. Both
// rows are idempotent in the database (a unique index per session and kind), so a retried insert can't
// double-count.
//
// Older rows have no session_id and came from a player that wrote a start row, then on completion a SECOND
// plain row (completed = true, no outcome) and a "finished" end row. Those are folded into one session:
//   - a plain completed row right after a start of the same video (same child) marks that session finished;
//   - an end row attaches to the latest session of that video that hasn't ended yet;
//   - a start that arrives just after an end that had no start (inserts racing) joins that session.
// A session with no end row (tab closed, power cut) is "unknown" and gets an estimate.
//
// Seconds watched: finished → the video's length; skipped / left → the reported position (capped at the
// length); unknown → 60% of the length, at least 2 minutes, never more than the length. A video with no
// known length counts as 5 minutes.
export type RawWatchEvent = {
  videoId: string; profileId?: string; startedAt: string; completed: boolean;
  outcome?: "skipped" | "finished" | "left"; endedAtSec?: number; sessionId?: string;
};
export type SessionOutcome = "finished" | "skipped" | "left" | "unknown";
export type WatchSession = { videoId: string; profileId?: string; startedAt: string; outcome: SessionOutcome; endedAtSec?: number };

const DEFAULT_SEC = 300;
const RACE_MS = 15_000; // a start inserted this soon after its own end row (out of order)
const legacyWindowMs = (durSec: number) => (durSec + 15 * 60) * 1000; // how long after a start its end can arrive

type Building = WatchSession & { ended: boolean; completedFlag: boolean; hadStart: boolean; endAtMs?: number };

export function sessionsFrom(events: RawWatchEvent[], durationOf: (videoId: string) => number | undefined = () => undefined): WatchSession[] {
  const ordered = [...events].sort((a, b) => a.startedAt.localeCompare(b.startedAt) || Number(!!a.outcome) - Number(!!b.outcome));
  const out: Building[] = [];
  const bySession = new Map<string, Building>();
  const key = (e: { videoId: string; profileId?: string }) => `${e.profileId ?? ""}|${e.videoId}`;
  const latest = new Map<string, Building[]>(); // legacy sessions per child+video, oldest first
  const dur = (id: string) => durationOf(id) ?? DEFAULT_SEC;

  const open = (e: RawWatchEvent, hadStart: boolean): Building => {
    const s: Building = { videoId: e.videoId, profileId: e.profileId, startedAt: e.startedAt, outcome: "unknown", ended: false, completedFlag: false, hadStart };
    out.push(s);
    if (!e.sessionId) latest.set(key(e), [...(latest.get(key(e)) ?? []), s]);
    return s;
  };
  const end = (s: Building, e: RawWatchEvent) => {
    if (s.ended) return; // a duplicate or second end row: the first one wins
    s.ended = true;
    s.outcome = e.outcome!;
    s.endedAtSec = e.endedAtSec;
    s.endAtMs = Date.parse(e.startedAt);
    if (!s.hadStart && e.endedAtSec != null) s.startedAt = new Date(Date.parse(e.startedAt) - e.endedAtSec * 1000).toISOString();
  };

  for (const e of ordered) {
    // ---- current rows: grouped by session id ----
    if (e.sessionId) {
      let s = bySession.get(e.sessionId);
      if (!e.outcome) {
        if (!s) { s = open(e, true); bySession.set(e.sessionId, s); }
        else if (!s.hadStart) { s.hadStart = true; if (e.startedAt < s.startedAt) s.startedAt = e.startedAt; } // start arrived after its end
        continue; // duplicate start rows are ignored
      }
      if (!s) { s = open(e, false); bySession.set(e.sessionId, s); }
      end(s, e);
      continue;
    }

    // ---- older rows: no session id ----
    const t = Date.parse(e.startedAt);
    const mine = latest.get(key(e)) ?? [];
    const last = mine[mine.length - 1];
    if (e.outcome) {
      const target = [...mine].reverse().find((s) => !s.ended && t - Date.parse(s.startedAt) <= legacyWindowMs(dur(e.videoId)));
      if (target) end(target, e);
      else if (last?.ended && last.outcome === e.outcome && last.endAtMs !== undefined && Math.abs(t - last.endAtMs) < RACE_MS) { /* duplicate end */ }
      else end(open(e, false), e);
      continue;
    }
    if (e.completed) {
      // The old player's second "play" row on completion: part of the session it completes.
      if (last && !last.completedFlag && (!last.ended || last.outcome === "finished") && t - Date.parse(last.startedAt) <= legacyWindowMs(dur(e.videoId))) { last.completedFlag = true; continue; }
      open(e, true).completedFlag = true;
      continue;
    }
    // A plain start. If it arrived just after an end that had no start, it belongs to that session.
    if (last && last.ended && !last.hadStart && last.endAtMs !== undefined && t - last.endAtMs >= 0 && t - last.endAtMs < RACE_MS) { last.hadStart = true; continue; }
    open(e, true);
  }

  return out
    .map((s) => ({ videoId: s.videoId, profileId: s.profileId, startedAt: s.startedAt, endedAtSec: s.endedAtSec, outcome: s.ended ? s.outcome : s.completedFlag ? "finished" : "unknown" } as WatchSession))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Seconds a session counts for (see the rules at the top). */
export function sessionSeconds(s: WatchSession, durationSec?: number): number {
  const d = durationSec ?? DEFAULT_SEC;
  if (s.outcome === "finished") return d;
  if ((s.outcome === "skipped" || s.outcome === "left") && s.endedAtSec != null) return Math.max(0, Math.min(d, s.endedAtSec));
  return Math.min(d, Math.max(120, d * 0.6));
}

/**
 * Whose viewing an event is. With one child, unattributed rows (from before child profiles) are theirs.
 * With several, they belong to no child: they're reported separately, never added to each child.
 */
export function attributedTo(profileId: string | undefined, kidId: string, childCount: number): boolean {
  return profileId === kidId || (!profileId && childCount === 1);
}
