import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { REASON } from "@/lib/gate";

/**
 * The one disclosure a parent sees before explicitly allowing a video with no eligible AI review
 * (none yet, low confidence, or incomplete). Used on the video page, the review queue, request
 * approvals and old-approval re-assignment, so the decision is always deliberate and worded the same.
 * `fields` are the hidden inputs that resubmit the same decision; confirm=1 is added here.
 */
export function UnreviewedConfirm({ childName, title, reason, action, fields, cancelHref }: {
  childName: string; title?: string; reason?: string;
  action: (form: FormData) => Promise<void>; fields: Record<string, string>; cancelHref: string;
}) {
  const headline =
    reason === REASON.lowConfidence ? "The review of this video wasn't confident enough."
    : reason === REASON.invalidReview ? "The review of this video came back incomplete."
    : "This video hasn't been reviewed yet.";
  return (
    <Card raised className="space-y-2 border-warn/40 bg-warn-soft p-4 sm:p-5">
      <p className="font-extrabold text-forest">{headline}</p>
      {title && <p className="text-sm font-bold line-clamp-2">{title}</p>}
      <p className="text-sm">
        Allowing it means {childName} can watch it before anyone has checked what&apos;s in it — the AI review and your
        filters won&apos;t apply. Only {childName} gets access, and you can undo this any time from the video&apos;s page.
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="confirm" value="1" />
          <Button type="submit">Allow anyway for {childName}</Button>
        </form>
        <Link href={cancelHref}><Button variant="ghost">Cancel</Button></Link>
      </div>
    </Card>
  );
}
