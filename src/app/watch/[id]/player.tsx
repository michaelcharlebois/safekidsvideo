"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recordWatch } from "@/app/actions";
import { arrowDir, isBack, isEnter } from "../remote-nav";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

type Item = { id: string; title: string };

/**
 * Locked player built on the YouTube IFrame API.
 * - No search, no comments, no sidebar — the iframe is all the kid gets.
 * - When a video ends we immediately move to the next APPROVED video, so YouTube's
 *   end-screen suggestions never get a chance to render.
 * - A transparent "stage" covers the whole iframe. It keeps keyboard focus in OUR page
 *   (a focused iframe swallows every remote key) and blocks the embed's title/logo links.
 *   The stage is the kid's control surface: OK/tap = play-pause, ◀ ▶ = skip 10s,
 *   ▼ = Home/Next buttons, Return = home.
 */
export function Player({ playlist, index, remainingMinutes }: { playlist: Item[]; index: number; remainingMinutes?: number }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLButtonElement>(null);
  const homeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<any>(null);
  const started = useRef<Set<string>>(new Set());
  const [i, setI] = useState(index);
  const [paused, setPaused] = useState(false);
  const [needsTap, setNeedsTap] = useState(false); // autoplay was blocked
  const [flash, setFlash] = useState<"play" | "pause" | "fwd" | "back" | null>(null);
  const [progress, setProgress] = useState(0);
  const current = playlist[i];
  const next = playlist[(i + 1) % playlist.length];

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
            if (e.data === S.PLAYING) {
              setNeedsTap(false); setPaused(false);
              if (id && !started.current.has(id)) { started.current.add(id); void recordWatch(id, false); }
            }
            if (e.data === S.PAUSED) setPaused(true);
            if (e.data === S.ENDED) {
              if (id) void recordWatch(id, true);
              setI((x) => (x + 1) % playlist.length);
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

  useEffect(() => {
    if (playerRef.current?.loadVideoById && playerRef.current.getVideoData?.()?.video_id !== current.id) {
      playerRef.current.loadVideoById(current.id);
      window.history.replaceState(null, "", `/watch/${current.id}`);
    }
  }, [current.id]);

  // Controls overlay: shows on any key/pointer activity, hides after 3s (never while paused).
  const [showUi, setShowUi] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poke = useCallback(() => {
    setShowUi(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 3000);
  }, []);
  useEffect(() => {
    hideTimer.current = setTimeout(() => setShowUi(false), 3000);
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    return () => {
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [poke]);

  // Progress bar ticks while the UI is visible.
  useEffect(() => {
    if (!showUi && !paused) return;
    const tick = () => {
      const p = playerRef.current;
      const d = p?.getDuration?.() || 0;
      setProgress(d ? (p.getCurrentTime?.() || 0) / d : 0);
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [showUi, paused]);

  const flashIcon = (f: NonNullable<typeof flash>) => {
    setFlash(f);
    setTimeout(() => setFlash(null), 600);
  };
  const togglePlay = () => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    if (p.getPlayerState() === window.YT.PlayerState.PLAYING) { p.pauseVideo(); flashIcon("pause"); }
    else { p.playVideo(); flashIcon("play"); }
  };
  const seek = (delta: number) => {
    const p = playerRef.current;
    if (!p?.seekTo) return;
    p.seekTo(Math.max(0, (p.getCurrentTime?.() || 0) + delta), true);
    flashIcon(delta > 0 ? "fwd" : "back");
    poke();
  };
  const goNext = () => setI((x) => (x + 1) % playlist.length);
  const goHome = () => router.push("/watch");

  // Keep focus on the stage; the whole remote works from there.
  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      poke();
      if (isBack(e)) { e.preventDefault(); goHome(); return; }
      const onStage = document.activeElement === stageRef.current;
      const dir = arrowDir(e);
      if (onStage) {
        if (isEnter(e) || e.key === " " || e.keyCode === 32) { e.preventDefault(); togglePlay(); return; }
        if (dir === "right") { e.preventDefault(); seek(10); return; }
        if (dir === "left") { e.preventDefault(); seek(-10); return; }
        if (dir === "down") { e.preventDefault(); homeRef.current?.focus({ preventScroll: true }); return; }
        if (dir === "up") { e.preventDefault(); return; }
      } else {
        // On the Home/Next buttons: left/right between them, up back to the stage.
        if (dir === "up") { e.preventDefault(); stageRef.current?.focus({ preventScroll: true }); return; }
        if (dir === "left" || dir === "right") {
          e.preventDefault();
          const btns = Array.from(document.querySelectorAll<HTMLElement>("[data-player-btn]"));
          const idx = btns.indexOf(document.activeElement as HTMLElement);
          const n = btns[dir === "right" ? Math.min(btns.length - 1, idx + 1) : Math.max(0, idx - 1)];
          n?.focus({ preventScroll: true });
        }
      }
      // Media keys (Samsung sends these when registered in the TV shell).
      if (e.key === "MediaPlayPause" || e.keyCode === 10252) togglePlay();
      if (e.key === "MediaPlay" || e.keyCode === 415) playerRef.current?.playVideo?.();
      if (e.key === "MediaPause" || e.keyCode === 19) playerRef.current?.pauseVideo?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poke, playlist.length]);

  // Screen-time countdown: counts down wall-clock minutes from what the server said was left; at zero, home (which shows "all done").
  const [secondsLeft, setSecondsLeft] = useState<number | null>(remainingMinutes != null ? remainingMinutes * 60 : null);
  useEffect(() => {
    if (secondsLeft == null) return;
    const t = setInterval(() => setSecondsLeft((s) => (s == null ? s : s - 1)), 1000);
    return () => clearInterval(t);
  }, [secondsLeft == null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (secondsLeft != null && secondsLeft <= 0) router.push("/watch");
  }, [secondsLeft, router]);
  const minutesLeft = secondsLeft != null ? Math.ceil(secondsLeft / 60) : null;

  const uiVisible = showUi || paused || needsTap;

  return (
    <main className="fixed inset-0 bg-black">
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />

      {/* The stage: invisible, focusable, covers the iframe. Tap/OK toggles play. */}
      <button
        ref={stageRef}
        type="button"
        aria-label={paused ? "Play" : "Pause"}
        onClick={togglePlay}
        className="absolute inset-0 h-full w-full cursor-default bg-transparent outline-none"
        style={{ WebkitTapHighlightColor: "transparent" }}
      />

      {minutesLeft != null && minutesLeft <= 5 && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-[var(--kfocus)] px-4 py-2 text-lg font-extrabold text-[#0b1020] shadow-lg">
          ⏰ {minutesLeft} minute{minutesLeft === 1 ? "" : "s"} left
        </div>
      )}

      {/* Big centre feedback: autoplay hint, paused badge, or a brief flash after a key. */}
      {(needsTap || paused || flash) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex h-32 w-32 items-center justify-center rounded-full bg-black/60 text-6xl text-white shadow-2xl">
            {flash === "fwd" ? "⏩" : flash === "back" ? "⏪" : flash === "pause" ? "⏸" : "▶"}
          </div>
          {needsTap && <p className="absolute mt-44 text-2xl font-extrabold text-white drop-shadow">Press OK to play</p>}
        </div>
      )}

      <div className={`absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/90 to-transparent px-4 pb-6 pt-16 transition-opacity duration-300 ${uiVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <p className="text-lg font-extrabold text-center line-clamp-1 text-white/80">{current.title}</p>
        <div className="h-1.5 w-full max-w-3xl overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-[var(--kfocus)] transition-[width] duration-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="flex gap-4">
          <button ref={homeRef} data-player-btn onClick={goHome} className="bigbtn rounded-full bg-white/15 px-7 py-4 text-xl font-extrabold text-white active:scale-95">
            🏠 Home
          </button>
          {playlist.length > 1 && (
            <button data-player-btn onClick={goNext} className="bigbtn rounded-full bg-[var(--kfocus)] px-7 py-4 text-xl font-extrabold text-[#0b1020] active:scale-95">
              Next ▶ <span className="hidden sm:inline font-bold opacity-70">{next.title.slice(0, 22)}</span>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
