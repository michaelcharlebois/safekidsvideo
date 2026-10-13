import { confirmCard } from "@/app/actions";
import { Button } from "@/components/ui";
import { CONCERN_LABELS, type ConcernFinding, type ConcernTag, type Confirmation, type TagVote } from "@/lib/types";

/**
 * The parent's verdict on a card, in the shape the reviewer learns from:
 * overall (accurate / too strict / too lenient), 👍/👎 per tag the AI raised, "missed" for
 * tags it didn't, the age range, and a note. Everything is optional except the verdict.
 */
export function FeedbackForm({
  videoId, present, absent, ageFit, mine, kidAge,
}: { videoId: string; present: ConcernFinding[]; absent: ConcernFinding[]; ageFit?: { min: number; max: number }; mine?: Confirmation; kidAge?: number }) {
  const vote = (t: ConcernTag): TagVote | undefined => mine?.tagVotes?.[t] ?? (mine?.tags?.includes(t) ? "missed" : undefined);
  return (
    <form action={confirmCard} className="mt-3 space-y-4">
      <input type="hidden" name="videoId" value={videoId} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="verdict" value="agree" variant="primary">The review is accurate</Button>
        <Button type="submit" name="verdict" value="too_strict" variant="secondary">Too strict</Button>
        <Button type="submit" name="verdict" value="too_lenient" variant="danger">Too lenient</Button>
      </div>

      <details className="rounded-xl border border-line p-3 text-sm" open={!!mine && mine.verdict !== "agree"}>
        <summary className="cursor-pointer font-bold">Tell the reviewer exactly what it got wrong (optional)</summary>
        <div className="mt-3 space-y-3">
          {present.length > 0 && (
            <div>
              <p className="text-sm font-bold text-forest">It flagged these — fair?</p>
              <ul className="mt-1 divide-y divide-line">
                {present.map((f) => (
                  <li key={f.tag} className="flex items-center justify-between gap-2 py-1.5">
                    <span><b>{CONCERN_LABELS[f.tag]}</b> <span className="text-muted">· intensity {f.intensity}{f.evidence ? ` · ${f.evidence}` : ""}</span></span>
                    <span className="flex shrink-0 gap-1">
                      <Radio name={`vote:${f.tag}`} value="agree" current={vote(f.tag)} label="👍 fair" />
                      <Radio name={`vote:${f.tag}`} value="overcall" current={vote(f.tag)} label="👎 over-called" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {absent.length > 0 && (
            <div>
              <p className="text-sm font-bold text-forest">It missed any of these?</p>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                {absent.map((f) => (
                  <label key={f.tag} className="flex items-center gap-2">
                    <input type="checkbox" name={`vote:${f.tag}`} value="missed" defaultChecked={vote(f.tag) === "missed"} className="accent-accent" />
                    {CONCERN_LABELS[f.tag]}
                  </label>
                ))}
              </div>
            </div>
          )}
          {ageFit && (
            <div>
              <p className="text-sm font-bold text-forest">Age range ({ageFit.min}–{ageFit.max})</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Radio name="ageVote" value="younger" current={mine?.ageVote} label="Fine for younger kids" />
                <Radio name="ageVote" value="right" current={mine?.ageVote} label="About right" />
                <Radio name="ageVote" value="older" current={mine?.ageVote} label="Needs older kids" />
              </div>
            </div>
          )}
        </div>
      </details>

      <textarea name="note" rows={2} defaultValue={mine?.note} placeholder="Two lines for other parents (optional) — this also teaches the reviewer" className="w-full rounded-xl border border-sand bg-surface px-3 py-2 text-sm outline-none focus:border-forest" />
      <label className="flex items-center gap-2 text-sm text-muted">
        My kid is <input type="number" name="kidAge" min={1} max={14} defaultValue={mine?.kidAge ?? kidAge} className="w-14 rounded-lg border border-line px-2 py-1" />
      </label>
    </form>
  );
}

function Radio({ name, value, current, label }: { name: string; value: string; current?: string; label: string }) {
  return (
    <label className="cursor-pointer">
      <input type="radio" name={name} value={value} defaultChecked={current === value} className="peer sr-only" />
      <span className="inline-block rounded-full border border-line px-2.5 py-1 text-xs font-bold peer-checked:border-forest peer-checked:bg-forest peer-checked:text-ivory peer-focus-visible:ring-2 peer-focus-visible:ring-forest">{label}</span>
    </label>
  );
}
