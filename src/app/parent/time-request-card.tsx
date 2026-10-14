import { answerTimeRequestAction, bedtimeExtensionAction, grantMoreTime } from "@/app/actions";
import { Button, Card } from "@/components/ui";
import { IconClock, IconMoon } from "@/components/icons";
import { GRANT_MINUTES, type TimeRequest } from "@/lib/time-requests";
import type { ChildTime } from "@/lib/tonight";

type Child = { id: string; name: string; avatar: string };
const Hidden = ({ f }: { f: Record<string, string | number> }) => <>{Object.entries(f).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;

/** Explicit extra minutes for today, for when a later bedtime alone wouldn't bring videos back. */
function AddMinutes({ child, next }: { child: Child; next: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {GRANT_MINUTES.map((m) => (
        <form key={m} action={grantMoreTime}><Hidden f={{ profileId: child.id, minutes: m, next }} /><Button type="submit" size="sm" variant="secondary">Add {m} min today</Button></form>
      ))}
    </div>
  );
}

/**
 * A child's stored ask. Minutes: +15/+30/+60 for today only (the daily limit doesn't change); bedtime still
 * applies. Bedtime: each choice shows the actual cutoff ("Until 8:00 PM") before the parent confirms; it's
 * tonight only and adds no minutes — if the minutes are used up too, the card says so and offers them
 * separately. Not today / Not tonight declines; the child can't ask again that day / night.
 */
export function TimeRequestCard({ req, child, next, tz, ctx }: { req: TimeRequest; child: Child; next: string; tz?: string; ctx: ChildTime }) {
  const at = new Date(req.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || "America/Los_Angeles" });
  const bed = req.kind === "bedtime";
  const answer = (decision: "approve" | "deny", minutes?: number) => ({ requestId: req.id, kind: req.kind, decision, next, ...(minutes ? { minutes } : {}) });
  return (
    <Card raised className="space-y-3 border-apricot/60 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-apricot-soft text-apricot-ink">{bed ? <IconMoon /> : <IconClock />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-forest"><span aria-hidden>{child.avatar} </span>{child.name} {bed ? "is asking to stay up a little later tonight" : "is asking for more time today"}</p>
          <p className="text-sm text-muted">
            Asked at {at}.{" "}
            {bed
              ? <>Bedtime is {ctx.bedtimeLabel}. A later bedtime is for tonight only and doesn&apos;t add viewing minutes.</>
              : <>{ctx.limitMinutes ? `Watched ${ctx.usedMinutes} of ${ctx.limitMinutes} minutes. ` : ""}Extra time is for today only{ctx.bedtimeLabel ? `, and bedtime (${ctx.bedtimeLabel}) still applies` : ""}.</>}
          </p>
        </div>
      </div>
      {bed ? (
        <>
          {ctx.limitReached && (
            <p className="rounded-xl bg-apricot-soft/60 px-3 py-2 text-sm text-forest">
              {child.name} has also used all {ctx.limitMinutes} minutes for today, so a later bedtime alone won&apos;t bring videos back. Add minutes too if you want them to watch.
            </p>
          )}
          <p className="text-sm font-bold text-forest">Let {child.name} watch until…</p>
          <div className="flex flex-wrap gap-2">
            {ctx.choices.filter((c) => !c.passed).map((c) => (
              <form key={c.minutes} action={answerTimeRequestAction}><Hidden f={answer("approve", c.minutes)} />
                <Button type="submit" size="sm" aria-label={`Let ${child.name} watch until ${c.label} tonight`}>{c.label} tonight</Button>
              </form>
            ))}
            <form action={answerTimeRequestAction}><Hidden f={answer("deny")} /><Button type="submit" size="sm" variant="quiet">Not tonight</Button></form>
          </div>
          {ctx.limitReached && <AddMinutes child={child} next={next} />}
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {GRANT_MINUTES.map((m) => (
            <form key={m} action={answerTimeRequestAction}><Hidden f={answer("approve", m)} /><Button type="submit" size="sm">+{m} min</Button></form>
          ))}
          <form action={answerTimeRequestAction}><Hidden f={answer("deny")} /><Button type="submit" size="sm" variant="quiet">Not today</Button></form>
        </div>
      )}
    </Card>
  );
}

/**
 * Tonight's bedtime for one child, on the parent's Home: the usual time, or the later cutoff already
 * granted, with direct controls — each choice labelled with its actual cutoff — and Cancel.
 */
export function TonightCard({ child, next, ctx }: { child: Child; next: string; ctx: ChildTime }) {
  if (!ctx.bedtime) return null;
  const open = ctx.choices.filter((c) => !c.passed);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sand-soft text-forest"><IconMoon size={18} /></span>
        <p className="min-w-0 flex-1 text-sm text-forest">
          {ctx.extension
            ? <><b>{child.name} can watch until {ctx.stopsLabel} tonight</b> <span className="text-muted">(usual bedtime {ctx.bedtimeLabel})</span></>
            : <>Bedtime tonight: <b>{ctx.bedtimeLabel}</b>{ctx.inBedtime ? " — it's bedtime now" : ""}</>}
        </p>
        {ctx.extension && (
          <form action={bedtimeExtensionAction}><Hidden f={{ profileId: child.id, cancel: "1", next }} /><Button type="submit" size="sm" variant="quiet">Cancel tonight&apos;s extension</Button></form>
        )}
      </div>
      {open.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-bold text-forest underline decoration-sand underline-offset-4">{ctx.extension ? "Change tonight's time" : `Let ${child.name} stay up later tonight`}</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {open.map((c) => (
              <form key={c.minutes} action={bedtimeExtensionAction}><Hidden f={{ profileId: child.id, minutes: c.minutes, next }} />
                <Button type="submit" size="sm" variant="secondary">Let {child.name} watch until {c.label} tonight</Button>
              </form>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Tonight only. It doesn&apos;t add viewing minutes{ctx.limitReached ? `, and ${child.name} has used today's minutes` : ""}. The usual bedtime setting doesn&apos;t change.</p>
        </details>
      )}
    </Card>
  );
}
