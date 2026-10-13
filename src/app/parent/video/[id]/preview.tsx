"use client";

import Image from "next/image";
import { useState } from "react";
import { IconPlay } from "@/components/icons";

/**
 * The YouTube player, loaded only when the parent asks for it. On a phone the page leads with the
 * decision, so the preview is a compact thumbnail until tapped (and no third-party player loads unasked).
 */
export function VideoPreview({ id, title, thumbnailUrl, duration }: { id: string; title: string; thumbnailUrl?: string; duration?: number }) {
  const [on, setOn] = useState(false);
  if (on) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-forest-900">
        <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1`} title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setOn(true)} className="group relative block aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-forest-900 text-left">
      <Image src={thumbnailUrl ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" fill unoptimized className="object-cover opacity-90 transition-opacity group-hover:opacity-100" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex items-center gap-2 rounded-full bg-ivory/95 px-4 py-2 text-sm font-bold text-forest shadow-[var(--shadow-raised)]"><IconPlay size={16} />Watch it yourself</span>
      </span>
      {duration ? <span className="absolute bottom-2 right-2 rounded-md bg-forest-900/85 px-1.5 py-0.5 text-xs font-bold text-ivory">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}</span> : null}
    </button>
  );
}
