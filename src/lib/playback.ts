// Playback time vs playhead position. The player reports both when a viewing session ends: where the
// playhead was (ended_at_sec) and how long the video actually PLAYED (watched_sec). Only playing time
// counts: pauses, buffering and seeking add nothing; watching a part again counts again. Pure.

export class PlaybackClock {
  private ms = 0;
  private since: number | null = null;
  /** The video is playing (from `now`, in ms). Calling it again while playing changes nothing. */
  play(now: number) { if (this.since == null) this.since = now; }
  /** Anything that isn't playing: paused, buffering, ended, seeking, hidden. */
  stop(now: number) { if (this.since != null) { this.ms += Math.max(0, now - this.since); this.since = null; } }
  get playing() { return this.since != null; }
  /** Seconds played so far. */
  seconds(now: number) { return (this.ms + (this.since != null ? Math.max(0, now - this.since) : 0)) / 1000; }
}
