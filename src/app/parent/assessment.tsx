import { reviewEligibility, REASON } from "@/lib/gate";
import { CONCERN_LABELS, FORMAT_LABELS, type ContentCard, type VideoWithCard } from "@/lib/types";
import { Notice, Tag } from "@/components/ui";

const INTENSITY = ["", "Mild", "Moderate", "Strong"] as const;
const toSeconds = (ts: string) => { const p = ts.split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0); };

/** Plain-language line about whether the AI review can be relied on at all (never "safe"). */
export function eligibilityNote(card: ContentCard | undefined): string | null {
  const e = reviewEligibility(card);
  if (e.eligible) return null;
  if (card?.reviewer?.model === "sample") return "This is a sample card, not a real AI review.";
  if (e.reason === REASON.lowConfidence) return `The AI review wasn't confident enough (${Math.round((card?.confidence ?? 0) * 100)}%) to rely on.`;
  if (e.reason === REASON.invalidReview) return "The AI review came back incomplete, so it can't be relied on.";
  return "This video hasn't had an AI review yet.";
}

/**
 * The AI's assessment of a video — an assessment with uncertainty, not a verdict. Used on the Review inbox
 * (compact) and the video page (full). Findings come straight from the card; nothing is inferred here.
 */
export function Assessment({ v, compact = false }: { v: VideoWithCard; compact?: boolean }) {
  const c = v.card;
  const note = eligibilityNote(c);
  const findings = Array.isArray(c?.concerns) ? c.concerns.filter((f) => f.present).sort((a, b) => b.intensity - a.intensity) : [];
  const absent = Array.isArray(c?.concerns) ? c.concerns.filter((f) => !f.present) : [];
  if (!c) return <Notice tone="warn">{note}</Notice>;
  const usable = !note;
  return (
    <div className="space-y-3 text-sm">
      {note && <Notice tone="warn">{note}</Notice>}
      {usable && (
        <div className="flex flex-wrap gap-1.5">
          <Tag>AI suggests ages {c.ageFit.min}–{c.ageFit.max}</Tag>
          <Tag>{FORMAT_LABELS[c.format] ?? "Other"}</Tag>
          <Tag>{c.pace === "frenetic" ? "Fast-paced" : c.pace === "moderate" ? "Moderate pace" : "Calm pace"}</Tag>
          {!compact && <Tag>Educational {c.educationalValue}/5</Tag>}
          <Tag>{Math.round(c.confidence * 100)}% confident</Tag>
        </div>
      )}
      {!compact && usable && c.synopsis && <p className="text-ink">{c.synopsis}</p>}
      {usable && c.parentRecommendation && (
        <p className="rounded-xl bg-sand-soft px-3 py-2 text-ink"><span className="font-bold text-forest">Reviewer&apos;s note: </span>{c.parentRecommendation}</p>
      )}
      {usable && (findings.length ? (
        <ul className="divide-y divide-sand rounded-xl border border-sand">
          {(compact ? findings.slice(0, 4) : findings).map((f) => (
            <li key={f.tag} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2">
              <span className="font-bold text-forest">{CONCERN_LABELS[f.tag]}</span>
              <span className={`rounded-full px-2 text-xs font-bold ${f.intensity >= 2 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>{INTENSITY[f.intensity]}</span>
              {f.timestamp && (
                <a href={`https://www.youtube.com/watch?v=${v.id}&t=${toSeconds(f.timestamp)}s`} target="_blank" rel="noreferrer" className="text-xs font-bold text-forest underline decoration-sand underline-offset-2">
                  at {f.timestamp}
                </a>
              )}
              {(v.confirmations.flaggedTags[f.tag] ?? 0) > 0 && <span className="text-xs text-muted">also flagged by {v.confirmations.flaggedTags[f.tag]} parent{v.confirmations.flaggedTags[f.tag] === 1 ? "" : "s"}</span>}
              {f.evidence && <span className="basis-full text-muted">{f.evidence}</span>}
            </li>
          ))}
          {compact && findings.length > 4 && <li className="px-3 py-2 text-xs text-muted">{findings.length - 4} more on the video&apos;s page</li>}
        </ul>
      ) : (
        <p className="text-muted">The AI didn&apos;t find any of the {Array.isArray(c.concerns) ? c.concerns.length : 0} things it checks for.</p>
      ))}
      {!compact && usable && absent.length > 0 && findings.length > 0 && (
        <p className="text-xs text-muted">Not found: {absent.map((f) => CONCERN_LABELS[f.tag]).join(", ")}.</p>
      )}
    </div>
  );
}
