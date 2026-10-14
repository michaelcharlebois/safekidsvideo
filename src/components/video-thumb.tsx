"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/logo";

/**
 * A video thumbnail that falls back to a plain branded tile when the image can't load (offline, removed
 * video, blocked host). The fallback is the Brightframe mark on a neutral ground: never a made-up picture,
 * and the video's own data is untouched. `dark` suits the kid screen and the TV preview.
 */
export function VideoThumb({ src, className = "", width = 320, height = 180, dark = false, draggable }: {
  src?: string; className?: string; width?: number; height?: number; dark?: boolean; draggable?: boolean;
}) {
  const [failed, setFailed] = useState(!src);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError in React: check once on mount.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) queueMicrotask(() => setFailed(true));
  }, []);
  if (failed) {
    return (
      <span role="img" aria-label="No picture available" className={`flex items-center justify-center ${dark ? "bg-forest" : "bg-sand-soft"} ${className}`}>
        <BrandMark size={Math.max(18, Math.round(height / 5))} tone={dark ? "dark" : "color"} className="h-[32%] w-auto opacity-40" />
      </span>
    );
  }
  return <Image ref={img} src={src!} alt="" width={width} height={height} unoptimized draggable={draggable} onError={() => setFailed(true)} className={className} />;
}
