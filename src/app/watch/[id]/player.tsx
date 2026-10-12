"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recordWatch } from "@/app/actions";

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
 * - A transparent overlay covers the iframe's top strip so the title/channel links are not tappable.
 */
export function Player({ playlist, index }: { playlist: Item[]; index: number }) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const started = useRef<Set<string>>(new Set());
  const [i, setI] = useState(index);
  const current = playlist[i];
  const next = playlist[(i + 1) % playlist.length];

  useEffect(() => {
    const init = () => {
      if (!hostRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId: current.id,
        host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1, controls: 1, fs: 0, iv_load_policy: 3, disablekb: 1 },
        events: {
          onStateChange: (e: any) => {
            const id = e.target?.getVideoData?.()?.video_id;
            if (e.data === window.YT.PlayerState.PLAYING && id && !started.current.has(id)) {
              started.current.add(id);
              void recordWatch(id, false);
            }
            if (e.data === window.YT.PlayerState.ENDED) {
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

  return (
    <main className="flex-1 flex flex-col items-center px-3 pb-6">
      <div className="relative w-full max-w-4xl aspect-video overflow-hidden rounded-2xl bg-black shadow-lg">
        <div ref={hostRef} className="absolute inset-0 h-full w-full" />
        {/* Block the title bar / channel avatar / share links at the top of the embed. */}
        <div className="absolute inset-x-0 top-0 h-14" aria-hidden />
      </div>
      <p className="mt-3 text-lg font-extrabold text-center line-clamp-2">{current.title}</p>
      <div className="mt-4 flex gap-3">
        <button onClick={() => router.push("/watch")} className="rounded-full bg-surface px-6 py-3 text-lg font-extrabold shadow active:scale-95">
          ⌂ All videos
        </button>
        {playlist.length > 1 && (
          <button onClick={() => setI((x) => (x + 1) % playlist.length)} className="rounded-full bg-sun px-6 py-3 text-lg font-extrabold shadow active:scale-95">
            Next ▶ <span className="font-semibold text-muted hidden sm:inline">{next.title.slice(0, 24)}</span>
          </button>
        )}
      </div>
    </main>
  );
}
