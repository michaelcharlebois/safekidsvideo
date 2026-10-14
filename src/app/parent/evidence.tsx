import type { Evidence } from "@/lib/explain";

const toSeconds = (ts: string) => { const p = ts.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0); };

/** Compact evidence: what, how strong, when, and who said so. */
export function EvidenceList({ items, videoId }: { items: Evidence[]; videoId: string }) {
  return (
    <ul className="space-y-1.5" aria-label="Why it's held back">
      {items.slice(0, 3).map((e) => (
        <li key={e.label} className="rounded-xl border border-sand bg-surface px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-bold text-forest">{e.label}</span>
            {e.severity && <span className={`rounded-full px-2 text-xs font-bold ${e.severity === "Strong" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>{e.severity}</span>}
            {e.timestamp && (
              <a href={`https://www.youtube.com/watch?v=${videoId}&t=${toSeconds(e.timestamp)}s`} target="_blank" rel="noreferrer" className="text-xs font-bold text-forest underline decoration-sand underline-offset-2">at {e.timestamp}</a>
            )}
            <span className="ml-auto text-xs text-muted">
              {e.source === "ai" ? (e.parents ? `AI review, and ${e.parents} parents` : "AI review") : e.source === "parents" ? `Flagged by ${e.parents} other parent${e.parents === 1 ? "" : "s"}` : "Your settings"}
            </span>
          </div>
          {e.evidence && <p className="mt-0.5 text-muted line-clamp-2">{e.evidence}</p>}
        </li>
      ))}
      {items.length > 3 && <li className="text-xs text-muted">{items.length - 3} more on the video&apos;s page</li>}
    </ul>
  );
}

