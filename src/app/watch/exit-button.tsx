"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

/**
 * Hold-to-exit: a 1.5s press on a small, unlabeled control, then the PIN screen.
 * Kids tap; they rarely hold. Good enough for a 4-year-old, not a 10-year-old.
 */
export function ExitButton() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    timer.current = setTimeout(() => router.push("/unlock?next=/parent"), 1500);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      aria-label="Parents: press and hold"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className="h-9 w-9 rounded-full border border-line bg-surface/70 text-muted text-xs font-bold"
    >
      ⚙
    </button>
  );
}
