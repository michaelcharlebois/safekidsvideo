import { answerTimeRequestAction } from "@/app/actions";
import { Button, Card } from "@/components/ui";
import { IconClock } from "@/components/icons";
import { GRANT_MINUTES, type TimeRequest } from "@/lib/time-requests";

/**
 * A child's stored "more time" ask, for today. Approve adds 15, 30 or 60 minutes for today only (the daily
 * limit itself doesn't change); Not today declines, and the child can't ask again today. Bedtime still
 * applies either way.
 */
export function TimeRequestCard({ req, child, next, tz, usedMinutes, limitMinutes }: {
  req: TimeRequest; child: { name: string; avatar: string }; next: string; tz?: string; usedMinutes?: number; limitMinutes?: number;
}) {
  const at = new Date(req.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || "America/Los_Angeles" });
  return (
    <Card raised className="flex flex-wrap items-center gap-3 border-apricot/60 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-apricot-soft text-apricot-ink"><IconClock /></span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-bold text-forest"><span aria-hidden>{child.avatar} </span>{child.name} is asking for more time today</p>
        <p className="text-sm text-muted">
          Asked at {at}{usedMinutes != null && limitMinutes ? `. Watched ${usedMinutes} of ${limitMinutes} minutes.` : "."} Extra time is for today only, and bedtime still applies.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {GRANT_MINUTES.map((m) => (
          <form key={m} action={answerTimeRequestAction}>
            <input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="decision" value="approve" />
            <input type="hidden" name="minutes" value={m} /><input type="hidden" name="next" value={next} />
            <Button type="submit" size="sm">+{m} min</Button>
          </form>
        ))}
        <form action={answerTimeRequestAction}>
          <input type="hidden" name="requestId" value={req.id} /><input type="hidden" name="decision" value="deny" /><input type="hidden" name="next" value={next} />
          <Button type="submit" size="sm" variant="quiet">Not today</Button>
        </form>
      </div>
    </Card>
  );
}
