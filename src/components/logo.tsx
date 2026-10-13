import Link from "next/link";

/**
 * The Sift mark: a sieve — a navy rounded square with three sunshine bars, the bottom one
 * letting a single dot through. Reads at 16px as a favicon and at 96px on a TV.
 */
export function SiftMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" fill="#141a3a" />
      <rect x="7" y="9" width="18" height="3" rx="1.5" fill="#ffcf3f" />
      <rect x="7" y="15" width="18" height="3" rx="1.5" fill="#ffcf3f" />
      <rect x="7" y="21" width="7" height="3" rx="1.5" fill="#ffcf3f" />
      <rect x="18" y="21" width="7" height="3" rx="1.5" fill="#ffcf3f" />
      <circle cx="16" cy="27" r="2" fill="#ffcf3f" />
    </svg>
  );
}

export function Wordmark({ href = "/", size = 28, light = false }: { href?: string; size?: number; light?: boolean }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 font-display text-[1.35em] leading-none tracking-tight ${light ? "text-white" : "text-ink"}`} style={{ fontSize: size * 0.85 }}>
      <SiftMark size={size} />
      <span>Sift</span>
    </Link>
  );
}
