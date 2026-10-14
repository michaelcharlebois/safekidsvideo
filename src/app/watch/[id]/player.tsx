"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nextVideo, recordWatchEnd, recordWatchStart } from "@/app/actions";
import { IconBack, IconBack10, IconFwd10, IconHome, IconNext, IconPause, IconPlay } from "@/components/icons";
import { PlaybackClock } from "@/lib/playback";
import { arrowDir, isBack, isEnter } from "../remote-nav";
import { clearLedger, isLocked, leavingCounts, loadLedger, saveLedger, type Ledger, type SkipConfig } from "./skip-ledger";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

type Item = { id: string; title: string };
type Session = { videoId: string; id: string; ended: boolean; clock: PlaybackClock };
const HIDE_AFTER_MS = 4000;
const now = () => performance.now();
const fmt = (s: number) => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

/**
 * The kid player, on the YouTube IFrame API, for TV (remote) and touch.
 * - Only the video: no YouTube controls, search, comments or suggestions. When a video ends we ask the
 *   SERVER for the next one this child may watch (nextVideo re-authorizes every time), so YouTube's end
 *   screen never shows and a parent's change takes effect at the next advance.
 * - A transparent stage covers the iframe so focus never enters it (a focused iframe swallows the remote)
 *   and its title/logo links can't be tapped.
 * - Controls: Back/Home, −10 s, Play/Pause, +10 s, Next. They hide while playing and come back on any key,
 *   tap or pointer move; paused keeps them up.
 *   TV: while hidden, OK pauses/plays and shows the controls; arrows only show them. While shown, ◀ ▶
 *   move between controls and OK presses one. Return always leaves the player (to Search if you came from
 *   there, else Home). Media keys work any time.
 * - Viewing is one session per playback with BOTH where the playhead ended and how long it actually played
 *   (lib/playback.ts). Skips and the screen-time countdown use playing time, so seeking can't game them.
 */
export function Player({ playlist, index, remainingMinutes, skip, ui, fromSearch = false }: {
  playlist: Item[]; index: number; remainingMinutes?: number; skip?: SkipConfig; ui: "tv" | "touch"; fromSearch?: boolean;
}) {
  const router = useRouter();
  const tv = ui === "tv";
  const hostRef = useRef<HTMLDivElement>(null);
  const playBtn = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<any>(null);

  // ---- viewing sessions: one start, at most one end, per playback ----
  const session = useRef<Session | null>(null);
  const screenClock = useRef(new PlaybackClock()); // all playing time on this screen, for the countdown
  const played = () => session.current?.clock.seconds(now()) ?? 0;
  const beginSession = (videoId: string) => {
    session.current = { videoId, id: newSessionId(), ended: false, clock: new PlaybackClock() };
    void recordWatchStart(videoId, session.current.id);
  };
  const endSession = (videoId: string, outcome: "finished" | "skipped" | "left", atSec: number, viaBeacon = false) => {
    const s = session.current;
    if (!s || s.ended || s.videoId !== videoId) return; // never twice, never for another video
    s.ended = true;
    s.clock.stop(now());
    const watchedSec = s.clock.seconds(now());
    if (viaBeacon && typeof navigator.sendBeacon === "function") {
      // The page is going away (app closed): a beacon is the one request browsers still deliver.
      const body = JSON.stringify({ videoId, outcome, atSec, watchedSec, sessionId: s.id });
      if (navigator.sendBeacon("/api/watch/end", new Blob([body], { type: "application/json" }))) return;
    }
    void recordWatchEnd(videoId, outcome, atSec, s.id, watchedSec);
  };

  // The current video. Advancing asks the server; this list is only for display and shelf order.
  const [current, setCurrent] = useState<Item>(playlist[index]);
  const order = playlist.map((p) => p.id);
  const advanceRef = useRef<() => void>(() => {});
  const endedRef = useRef<(id: string, dur: number) => void>(() => {});
  const [paused, setPaused] = useState(true);
  const [needsTap, setNeedsTap] = useState(false); // autoplay was blocked
  const [flash, setFlash] = useState<"play" | "pause" | "fwd" | "back" | null>(null);
  const [pos, setPos] = useState({ at: 0, dur: 0 });
  const idx = playlist.findIndex((p) => p.id === current.id);
  const next = playlist[(idx + 1) % playlist.length] ?? playlist[0];

  useEffect(() => {
    const init = () => {
      if (!hostRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId: current.id,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, controls: 0, fs: 0, iv_load_policy: 3, disablekb: 1 },
        events: {
          onReady: () => {
            // TV engines often block autoplay-with-sound until a key press. Say so.
            setTimeout(() => {
              const s = playerRef.current?.getPlayerState?.();
              if (s === window.YT.PlayerState.UNSTARTED || s === window.YT.PlayerState.CUED || s === -1) setNeedsTap(true);
            }, 2500);
          },
          onStateChange: (e: any) => {
            const id = e.target?.getVideoData?.()?.video_id;
            const S = window.YT.PlayerState;
            const t = now();
            if (e.data === S.PLAYING) {
              setNeedsTap(false); setPaused(false);
              // A new session when this video starts (again); resuming after a pause is the same session.
              if (id && (!session.current || session.current.ended || session.current.videoId !== id)) beginSession(id);
              session.current?.clock.play(t);
              screenClock.current.play(t);
              return;
            }
            // Paused, buffering (incl. seeking), cued or ended: not playing, so no time counts.
            session.current?.clock.stop(t);
            screenClock.current.stop(t);
            if (e.data === S.PAUSED) setPaused(true);
            if (e.data === S.ENDED && id) {
              endedRef.current(id, e.target?.getDuration?.() ?? 0);
              endSession(id, "finished", e.target?.getDuration?.() ?? 0);
              advanceRef.current();
            }
          },
        },
      });
    };
    if (window.YT?.Player) init();
    else {
      window.onYouTubeIframeAPIReady = init;
      if (!document.querySelector("script[data-yt-api]")) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.dataset.ytApi = "1";
        document.head.appendChild(s);
      }
    }
    return () => {
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new current video (auto-advance or Next): load it. The same video again (a one-video list) replays.
  const [replays, setReplays] = useState(0);
  useEffect(() => {
    const p = playerRef.current;
    if (!p?.loadVideoById) return;
    if (p.getVideoData?.()?.video_id !== current.id || replays > 0) p.loadVideoById(current.id);
    window.history.replaceState(null, "", `/watch/${current.id}${fromSearch ? "?from=search" : ""}`);
  }, [current.id, replays, fromSearch]);

  // ---- controls overlay ----
  const [visible, setVisible] = useState(true);
  const visibleRef = useRef(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef(false); // something to read (paused, autoplay blocked, out of skips): keep the controls up
  const show = useCallback((on: boolean) => { visibleRef.current = on; setVisible(on); }, []);
  const reveal = useCallback(() => {
    show(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (!holdRef.current) show(false); }, HIDE_AFTER_MS);
  }, [show]);
  const hide = useCallback(() => { if (!holdRef.current) show(false); }, [show]);

  // Position and length for the progress bar.
  useEffect(() => {
    if (!visible) return;
    const tick = () => { const p = playerRef.current; setPos({ at: p?.getCurrentTime?.() || 0, dur: p?.getDuration?.() || 0 }); };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [visible]);

  const flashIcon = (f: NonNullable<typeof flash>) => { setFlash(f); setTimeout(() => setFlash(null), 600); };
  const togglePlay = () => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    if (p.getPlayerState() === window.YT.PlayerState.PLAYING) { p.pauseVideo(); flashIcon("pause"); }
    else { p.playVideo(); flashIcon("play"); }
    reveal();
  };
  const seek = (delta: number) => {
    const p = playerRef.current;
    if (!p?.seekTo) return;
    const dur = p.getDuration?.() || Infinity;
    p.seekTo(Math.min(Math.max(0, (p.getCurrentTime?.() || 0) + delta), Math.max(0, dur - 1)), true);
    flashIcon(delta > 0 ? "fwd" : "back");
    reveal();
  };

  // ---- skip budget (counted on playing time, not playhead position) ----
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const duration = () => playerRef.current?.getDuration?.() ?? 0;
  const commit = (l: Ledger) => { saveLedger(l); setLedger({ ...l }); };
  const commitDeferred = (l: Ledger) => { saveLedger(l); queueMicrotask(() => setLedger({ ...l })); };

  // On arrival: settle the previous video (Home → different video is still a skip) and start tracking this one.
  useEffect(() => {
    if (!skip) { clearLedger(); return; }
    const l = loadLedger(skip);
    if (l.last && l.last.id !== current.id) {
      const verdict = leavingCounts(l.last, skip);
      if (verdict === "finished") l.skipsLeft = Math.min(skip.limit, l.skipsLeft + skip.regen);
      else if (verdict === "skip") {
        if (l.skipsLeft > 0) l.skipsLeft--;
        else if (!isLocked(l)) l.lockedUntil = Date.now() + skip.cooldownSec * 1000;
        if (l.skipsLeft === 0 && isLocked(l)) {
          // Out of skips: back to the one they left.
          const back = l.last.id, title = l.last.title;
          commitDeferred(l);
          queueMicrotask(() => setLockMsg(`Let's finish "${title}" first`));
          setTimeout(() => router.replace(`/watch/${back}`), 2500);
          return;
        }
      }
    }
    l.last = { id: current.id, title: current.title, watchedSec: 0, durationSec: 0, finished: false };
    commitDeferred(l);
    const t = setInterval(() => {
      const cur = loadLedger(skip);
      const s = session.current;
      if (cur.last?.id === current.id && !cur.last.finished && s?.videoId === current.id) {
        cur.last.watchedSec = s.clock.seconds(now());
        cur.last.durationSec = duration() || cur.last.durationSec;
        saveLedger(cur);
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, !!skip]);

  // Cooldown ticker.
  useEffect(() => {
    if (!skip || !ledger || !isLocked(ledger)) { queueMicrotask(() => setCooldownLeft(0)); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((ledger.lockedUntil - Date.now()) / 1000));
      setCooldownLeft(left);
      if (left === 0) { const l = loadLedger(skip); commit(l); setLockMsg(null); }
    };
    const t0 = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(t0); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger?.lockedUntil, !!skip]);

  // The video reached its end. Watched most of it → finished (skips come back). Jumped to the end → that
  // was a skip, charged like Next.
  useEffect(() => {
    endedRef.current = (id: string, dur: number) => {
      if (!skip) return;
      const l = loadLedger(skip);
      if (!l.last || l.last.id !== id) return;
      l.last.watchedSec = played();
      l.last.durationSec = dur || l.last.durationSec;
      const verdict = leavingCounts(l.last, skip);
      if (verdict === "finished") { l.skipsLeft = Math.min(skip.limit, l.skipsLeft + skip.regen); l.lockedUntil = 0; setLockMsg(null); }
      else if (verdict === "skip") { if (l.skipsLeft > 0) l.skipsLeft--; else if (!isLocked(l)) l.lockedUntil = Date.now() + skip.cooldownSec * 1000; }
      l.last.finished = true; // settled; nothing more to charge on arrival
      commit(l);
    };
  });

  /** Ask the server what's next for this child, right now. Nothing allowed (or time's up) → home. */
  const advance = async () => {
    try {
      const n = await nextVideo(current.id, order);
      if (!n) { router.push("/watch"); return; }
      if (n.id === current.id) setReplays((r) => r + 1);
      else setCurrent(n);
    } catch {
      router.push("/watch");
    }
  };
  useEffect(() => { advanceRef.current = () => { void advance(); }; });

  const goNext = () => {
    if (skip) {
      const l = loadLedger(skip);
      if (l.last?.id === current.id) { l.last.watchedSec = played(); l.last.durationSec = duration() || l.last.durationSec; }
      const verdict = leavingCounts(l.last, skip);
      if (verdict === "finished") { l.skipsLeft = Math.min(skip.limit, l.skipsLeft + skip.regen); if (l.last) l.last.finished = true; }
      else if (verdict === "skip") {
        if (isLocked(l) || l.skipsLeft === 0) {
          if (!isLocked(l)) l.lockedUntil = Date.now() + skip.cooldownSec * 1000;
          commit(l);
          setLockMsg("Let's finish this one first");
          reveal();
          return; // stay put; the video keeps playing
        }
        l.skipsLeft--;
        if (l.last) l.last.finished = true; // settled; don't double-charge on arrival
      }
      commit(l);
    }
    endSession(current.id, "skipped", playerRef.current?.getCurrentTime?.() ?? 0);
    void advance();
  };
  /** Return / Back / Home: leave the player, to Search if that's where the child came from. */
  const leave = () => {
    endSession(current.id, "left", playerRef.current?.getCurrentTime?.() ?? 0);
    if (fromSearch && window.history.length > 1) router.back();
    else router.push(fromSearch ? "/watch/search" : "/watch");
  };

  // Leaving any other way (closing the app, navigating away) ends the session as "left".
  useEffect(() => {
    const atSec = () => playerRef.current?.getCurrentTime?.() ?? 0;
    const onHide = () => { const s = session.current; if (s && !s.ended) endSession(s.videoId, "left", atSec(), true); };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); const s = session.current; if (s && !s.ended) endSession(s.videoId, "left", atSec()); };
  }, []);

  // Start with the controls showing and focus on Play/Pause.
  useEffect(() => {
    if (tv) playBtn.current?.focus({ preventScroll: true }); // the remote starts on Play/Pause; touch needs no focus
    queueMicrotask(reveal); // shown now; starts the hide timer
    const onMove = () => reveal();
    if (!tv) return;
    window.addEventListener("pointermove", onMove); // a motion remote / mouse brings the controls back
    return () => window.removeEventListener("pointermove", onMove);
  }, [reveal, tv]);

  // Keep the controls up while there's something to read.
  useEffect(() => {
    holdRef.current = paused || needsTap || !!lockMsg;
    if (holdRef.current) queueMicrotask(() => show(true));
    else queueMicrotask(reveal);
  }, [paused, needsTap, lockMsg, reveal, show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isBack(e)) { e.preventDefault(); e.stopPropagation(); leave(); return; }
      // Media keys (Samsung sends these when registered in the TV shell). They work whether or not controls show.
      if (e.key === "MediaPlayPause" || e.keyCode === 10252) { e.preventDefault(); togglePlay(); return; }
      if (e.key === "MediaPlay" || e.keyCode === 415) { e.preventDefault(); playerRef.current?.playVideo?.(); reveal(); return; }
      if (e.key === "MediaPause" || e.keyCode === 19) { e.preventDefault(); playerRef.current?.pauseVideo?.(); reveal(); return; }
      if (e.key === "MediaFastForward" || e.keyCode === 417) { e.preventDefault(); seek(10); return; }
      if (e.key === "MediaRewind" || e.keyCode === 412) { e.preventDefault(); seek(-10); return; }
      const dir = arrowDir(e);
      const ok = isEnter(e) || e.key === " " || e.keyCode === 32;
      if (!dir && !ok) return;
      if (!visibleRef.current) {
        // Hidden: the first key brings the controls back, onto Play/Pause. OK also pauses or plays.
        e.preventDefault(); e.stopPropagation();
        playBtn.current?.focus({ preventScroll: true });
        if (ok) togglePlay(); else reveal();
        return;
      }
      reveal();
      const btns = Array.from(document.querySelectorAll<HTMLElement>("[data-player-btn]"));
      if (!btns.includes(document.activeElement as HTMLElement)) { e.preventDefault(); playBtn.current?.focus({ preventScroll: true }); return; }
      if (dir === "left" || dir === "right") {
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLElement);
        btns[dir === "right" ? Math.min(btns.length - 1, i + 1) : Math.max(0, i - 1)]?.focus({ preventScroll: true });
      } else if (dir) e.preventDefault();
      // OK on a focused control: the button's own click.
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, current.id]);

  // Screen time: counts down PLAYING time from what the server said was left; at zero, home (which shows "all done").
  const [secondsLeft, setSecondsLeft] = useState<number | null>(remainingMinutes != null ? remainingMinutes * 60 : null);
  useEffect(() => {
    if (remainingMinutes == null) return;
    const t = setInterval(() => setSecondsLeft(remainingMinutes * 60 - screenClock.current.seconds(now())), 1000);
    return () => clearInterval(t);
  }, [remainingMinutes]);
  const timeUp = secondsLeft != null && secondsLeft <= 0;
  useEffect(() => { if (timeUp) router.push("/watch"); }, [timeUp, router]);
  const minutesLeft = secondsLeft != null ? Math.max(0, Math.ceil(secondsLeft / 60)) : null;

  const shown = visible || paused || needsTap || !!lockMsg;
  const backLabel = fromSearch ? "Back" : "Home";
  const nextLabel = cooldownLeft > 0 ? `Next in ${fmt(cooldownLeft)}` : "Next";
  const skipDots = skip && ledger && cooldownLeft === 0 ? (
    <span className="inline-flex gap-1 align-middle" aria-label={`${ledger.skipsLeft} skips left`}>
      {Array.from({ length: skip.limit }).map((_, k) => <span key={k} className={`inline-block rounded-full ${tv ? "h-[0.5vw] w-[0.5vw]" : "h-2 w-2"} ${k < ledger.skipsLeft ? "bg-current" : "bg-current opacity-25"}`} />)}
    </span>
  ) : null;
  const progress = pos.dur ? Math.min(1, pos.at / pos.dur) : 0;

  // TV: a focus ring on the one focused control. Touch: big targets, no ring needed for taps.
  const btn = tv
    ? "flex items-center justify-center gap-[0.6vw] rounded-full bg-[rgb(255_249_241/0.14)] font-extrabold text-[var(--kink)] outline-none transition-transform focus:scale-110 focus:bg-[rgb(255_249_241/0.24)] focus:shadow-[0_0_0_0.3vw_var(--kfocus)]"
    : "flex items-center justify-center gap-2 rounded-full bg-black/55 font-extrabold text-white outline-none active:scale-95 focus-visible:shadow-[0_0_0_4px_var(--kfocus)]";

  return (
    <main className={`kid-bf ${tv ? "tv" : "touch"} fixed inset-0 bg-black`} data-player>
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />

      {/* The stage: covers the iframe. TV/mouse click toggles play; a tap on touch shows or hides the controls. */}
      <button
        type="button" tabIndex={-1} aria-hidden
        onClick={() => (tv ? togglePlay() : shown && !holdRef.current ? hide() : reveal())}
        className="absolute inset-0 h-full w-full cursor-default bg-transparent outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
      />

      {minutesLeft != null && minutesLeft <= 5 && (
        <div role="status" className={`pointer-events-none absolute rounded-full bg-[var(--kfocus)] font-extrabold text-[#2a1206] shadow-lg ${tv ? "right-[4vw] top-[4vh] px-[1.4vw] py-[0.6vw] text-[1.4vw]" : "right-4 top-4 px-4 py-2 text-base"}`}>
          {minutesLeft} minute{minutesLeft === 1 ? "" : "s"} left today
        </div>
      )}

      {/* A brief flash after a key, or the autoplay hint. */}
      {(flash || needsTap) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4">
          {flash && (
            <div className={`flex items-center justify-center rounded-full bg-black/60 text-white ${tv ? "h-[8vw] w-[8vw]" : "h-28 w-28"}`}>
              {flash === "fwd" ? <IconFwd10 size={0} className="h-1/2 w-1/2" /> : flash === "back" ? <IconBack10 size={0} className="h-1/2 w-1/2" /> : flash === "pause" ? <IconPause size={0} className="h-1/2 w-1/2" /> : <IconPlay size={0} className="h-1/2 w-1/2" />}
            </div>
          )}
          {needsTap && <p className={`rounded-full bg-black/60 font-extrabold text-white ${tv ? "px-[2vw] py-[0.8vw] text-[2vw]" : "px-5 py-2 text-xl"}`}>{tv ? "Press OK to play" : "Tap Play to start"}</p>}
        </div>
      )}

      {/* Controls. Hidden ones stay in place (so focus has somewhere to be) but can't be tapped. */}
      <div data-controls={shown ? "shown" : "hidden"} className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} aria-hidden={!shown}>
        <div className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent ${tv ? "px-[5vw] pb-[6vh] pt-[4vh]" : "flex items-center gap-3 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]"}`}>
          {!tv && (
            <button data-player-btn type="button" onClick={leave} className={`${btn} ${shown ? "pointer-events-auto" : ""} h-14 shrink-0 pl-3 pr-5 text-lg`}>
              <IconBack size={26} />{backLabel}
            </button>
          )}
          <p className={`font-extrabold text-white line-clamp-1 ${tv ? "text-[2vw]" : "text-lg"}`}>{current.title}</p>
          {paused && !needsTap && <p className={`font-bold text-[var(--kmuted)] ${tv ? "mt-[0.5vh] text-[1.3vw]" : "hidden"}`}>Paused</p>}
        </div>

        {!tv && (
          <div className="absolute inset-0 flex items-center justify-center gap-8">
            <button data-player-btn type="button" onClick={() => seek(-10)} aria-label="Back 10 seconds" className={`${btn} ${shown ? "pointer-events-auto" : ""} h-16 w-16`}><IconBack10 size={34} /></button>
            <button ref={playBtn} data-player-btn type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"} className={`${btn} ${shown ? "pointer-events-auto" : ""} h-24 w-24 !bg-[var(--kink)] !text-[#082219]`}>
              {paused ? <IconPlay size={46} /> : <IconPause size={44} />}
            </button>
            <button data-player-btn type="button" onClick={() => seek(10)} aria-label="Forward 10 seconds" className={`${btn} ${shown ? "pointer-events-auto" : ""} h-16 w-16`}><IconFwd10 size={34} /></button>
          </div>
        )}

        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent ${tv ? "px-[5vw] pb-[5vh] pt-[10vh]" : "px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-14"}`}>
          {lockMsg && <p role="status" className={`mx-auto mb-3 w-fit rounded-full bg-[rgb(255_249_241/0.14)] font-extrabold text-white ${tv ? "px-[1.4vw] py-[0.5vw] text-[1.4vw]" : "px-4 py-1.5 text-base"}`}>{lockMsg}{cooldownLeft > 0 ? ` (next skip in ${fmt(cooldownLeft)})` : ""}</p>}
          <div className={`flex items-center ${tv ? "gap-[1vw] text-[1.2vw]" : "gap-3 text-sm"} font-bold text-white/80`}>
            <span className="tabular-nums">{fmt(pos.at)}</span>
            <div className={`flex-1 overflow-hidden rounded-full bg-white/20 ${tv ? "h-[0.5vw]" : "h-2"}`} role="progressbar" aria-label="How far into the video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full bg-[var(--kfocus)] transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="tabular-nums">{fmt(pos.dur)}</span>
          </div>
          {tv ? (
            <div className="mt-[3vh] flex items-center gap-[1.2vw]">
              <button data-player-btn type="button" onClick={leave} className={`${btn} h-[4.6vw] px-[2vw] text-[1.5vw]`}>
                {fromSearch ? <IconBack size={0} className="h-[1.8vw] w-[1.8vw]" /> : <IconHome size={0} className="h-[1.8vw] w-[1.8vw]" />}{backLabel}
              </button>
              <div className="mx-auto flex items-center gap-[1.2vw]">
                <button data-player-btn type="button" onClick={() => seek(-10)} aria-label="Back 10 seconds" className={`${btn} h-[4.6vw] w-[4.6vw]`}><IconBack10 size={0} className="h-[2.6vw] w-[2.6vw]" /></button>
                <button ref={playBtn} data-player-btn type="button" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"} className={`${btn} h-[6vw] w-[6vw] !bg-[var(--kink)] !text-[#082219]`}>
                  {paused ? <IconPlay size={0} className="h-[3vw] w-[3vw]" /> : <IconPause size={0} className="h-[2.8vw] w-[2.8vw]" />}
                </button>
                <button data-player-btn type="button" onClick={() => seek(10)} aria-label="Forward 10 seconds" className={`${btn} h-[4.6vw] w-[4.6vw]`}><IconFwd10 size={0} className="h-[2.6vw] w-[2.6vw]" /></button>
              </div>
              {playlist.length > 1 ? (
                <button data-player-btn type="button" onClick={goNext} className={`${btn} h-[4.6vw] max-w-[26vw] px-[2vw] text-[1.5vw] ${cooldownLeft > 0 ? "!text-[var(--kmuted)]" : ""}`}>
                  <span className="truncate">{nextLabel}{cooldownLeft === 0 && <span className="ml-[0.6vw] font-bold text-[var(--kmuted)]">{next.title}</span>}</span>
                  <IconNext size={0} className="h-[1.6vw] w-[1.6vw] shrink-0" />{skipDots}
                </button>
              ) : <span className="w-[10vw]" />}
            </div>
          ) : playlist.length > 1 && (
            <div className="mt-3 flex justify-end">
              <button data-player-btn type="button" onClick={goNext} className={`${btn} ${shown ? "pointer-events-auto" : ""} h-14 px-6 text-lg ${cooldownLeft > 0 ? "!text-white/60" : ""}`}>
                {nextLabel}<IconNext size={24} />{skipDots}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** A session id; crypto.randomUUID isn't available on plain-http TV browsers. */
function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
