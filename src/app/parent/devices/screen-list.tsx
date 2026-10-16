import { Button, buttonClass } from "@/components/ui";
import { lastActiveLabel } from "@/lib/last-active";

type FormAction = string | ((form: FormData) => void | Promise<void>);
export type ScreenRow = { id: string; name: string; last_seen_at: string | null; assigned_profile_id: string | null; active_profile_id: string | null };

/**
 * The Connected screens list. Disconnecting is a two-step, in-flow confirmation: "Disconnect" opens a panel
 * inside that screen's row (?confirm=<id>), naming the screen, with Cancel and Disconnect. It's part of the
 * row's layout, so the card can't clip it at any width, and it works without JavaScript.
 */
export function ScreenList({ screens, profiles, confirmId, now, tz, assignAction, disconnectAction }: {
  screens: ScreenRow[];
  profiles: { id: string; name: string }[];
  /** the screen whose disconnect confirmation is open (from the URL); ignored unless it's in `screens` */
  confirmId?: string;
  now: number;
  tz?: string;
  assignAction: FormAction;
  disconnectAction: FormAction;
}) {
  const multi = profiles.length > 1;
  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.name;
  return (
    <ul className="divide-y divide-sand">
      {screens.map((d) => {
        const confirming = confirmId === d.id;
        const owner = nameOf(d.assigned_profile_id);
        return (
          <li key={d.id} id={`screen-${d.id}`} data-screen={d.id} className="flex scroll-mt-24 flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
            <div className="min-w-0">
              <p className="font-bold text-forest">{d.name}</p>
              <p className="text-xs text-muted" data-last-active>
                {lastActiveLabel(d.last_seen_at, now, tz)}
                {!d.assigned_profile_id && multi && d.active_profile_id ? ` · watching as ${nameOf(d.active_profile_id)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {multi && (
                <form action={assignAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="deviceId" value={d.id} />
                  <label className="sr-only" htmlFor={`who-${d.id}`}>Who uses {d.name}</label>
                  <select id={`who-${d.id}`} name="profileId" defaultValue={d.assigned_profile_id ?? ""} className="h-9 rounded-full border border-sand bg-surface px-3 text-sm font-semibold">
                    <option value="">Shared (PIN to switch)</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s own</option>)}
                  </select>
                  <Button type="submit" variant="secondary" size="sm">Save</Button>
                </form>
              )}
              {!confirming && (
                <a href={`/parent/devices?confirm=${encodeURIComponent(d.id)}#screen-${d.id}`} className="rounded-full px-3 py-2 text-sm font-bold text-muted hover:bg-sand-soft hover:text-bad">
                  Disconnect<span className="sr-only"> {d.name}</span>
                </a>
              )}
            </div>
            {confirming && (
              <div role="group" aria-labelledby={`disconnect-${d.id}`} data-disconnect-confirm className="w-full basis-full rounded-xl border border-sand bg-sand-soft p-4">
                <p id={`disconnect-${d.id}`} className="font-bold text-ink">Disconnect &ldquo;{d.name}&rdquo;?</p>
                <p className="mt-1 text-muted">
                  {owner ? `It's ${owner}'s own screen. ` : ""}It stops working right away. To use it again, pair it with a new code.
                </p>
                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <a href={`/parent/devices#screen-${d.id}`} className={buttonClass("secondary", "md", "justify-center")}>Cancel</a>
                  <form action={disconnectAction}>
                    <input type="hidden" name="deviceId" value={d.id} />
                    <Button type="submit" variant="danger" size="md" className="w-full justify-center sm:w-auto">Disconnect screen</Button>
                  </form>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
