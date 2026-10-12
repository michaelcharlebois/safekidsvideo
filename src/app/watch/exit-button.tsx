"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Parent exit from kid mode. Two gestures, both unlikely from a small kid:
 *  - press and hold for 1.5s
 *  - five quick taps
 * touch-action:none stops iOS from turning the hold into a text-selection gesture.
 */
export function ExitButton({ target }: { target: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taps = useRef<number[]>([]);
  const [holding, setHolding] = useState(false);

  const go = () => router.push(target);
  const start = () => {
    setHolding(true);
    timer.current = setTimeout(go, 1500);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) go();
  };

  return (
    <button
      aria-label="Grown-ups: press and hold"
      title="Grown-ups: press and hold"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onClick={tap}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
      className={`h-9 w-9 rounded-full text-xs font-bold transition ${holding ? "bg-[var(--kfocus)] text-[#0b1020] scale-110" : "bg-white/5 text-white/30"}`}
    >
      ⚙
    </button>
  );
}
