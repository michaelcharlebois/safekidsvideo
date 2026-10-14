/**
 * Skip budget, Pandora-style. Lives in sessionStorage so it survives Home → another video,
 * and resets when the TV app is relaunched (a new "session").
 *
 *  - Leaving a video before it's done costs a skip — unless you left in the first `freePeekSec`
 *    (thumbnail lied, wrong video) or after `finishRatio` of it (close enough to finished).
 *  - Finishing a video earns `regen` skips back, up to `limit`.
 *  - Out of skips? The current video keeps playing; Next becomes a countdown. When it ends you get one.
 */
export type SkipConfig = { limit: number; regen: number; cooldownSec: number; freePeekSec: number };
export type Ledger = {
  skipsLeft: number;
  lockedUntil: number; // epoch ms, 0 = not locked
  last?: { id: string; title: string; watchedSec: number; durationSec: number; finished: boolean };
};
export const FINISH_RATIO = 0.7;
const KEY = "sift.skips";

export function loadLedger(cfg: SkipConfig): Ledger {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const l = JSON.parse(raw) as Ledger;
      // Cooldown over → one skip back.
      if (l.lockedUntil && Date.now() >= l.lockedUntil) { l.lockedUntil = 0; l.skipsLeft = Math.max(l.skipsLeft, 1); }
      return { ...l, skipsLeft: Math.min(l.skipsLeft, cfg.limit) };
    }
  } catch { /* private mode etc. */ }
  return { skipsLeft: cfg.limit, lockedUntil: 0 };
}

export function saveLedger(l: Ledger) {
  try { sessionStorage.setItem(KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

export function clearLedger() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Would leaving `last` right now count as a skip (vs. a free peek or a near-finish)? */
export function leavingCounts(last: Ledger["last"], cfg: SkipConfig): "free" | "finished" | "skip" {
  if (!last || last.finished) return "free";
  if (last.watchedSec < cfg.freePeekSec) return "free";
  if (last.durationSec > 0 && last.watchedSec / last.durationSec >= FINISH_RATIO) return "finished";
  return "skip";
}

export const isLocked = (l: Ledger) => l.lockedUntil > Date.now();

/**
 * How a viewing session that leaves a video (it ended, or Next) is recorded — by the same rule the skip
 * budget uses: at least FINISH_RATIO of it actually PLAYED → finished; otherwise skipped (including jumping
 * to the end). So the record never says "finished" while the budget charged a skip.
 */
export function leavingOutcome(playedSec: number, durationSec: number): "finished" | "skipped" {
  return durationSec > 0 && playedSec / durationSec >= FINISH_RATIO ? "finished" : "skipped";
}
