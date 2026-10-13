"use client";

import { useActionState } from "react";
import { deleteProfile, saveProfile } from "@/app/actions";
import { Button } from "@/components/ui";
import { AVATARS, type Profile } from "@/lib/types";

const field = "w-full rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest";

/** A child's profile: name, age, avatar, interests. (Age drives the AI review's age check.) */
export function KidForm({ profile, canDelete }: { profile?: Profile; canDelete: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  const id = profile?.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={profile?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <label className="space-y-1 text-sm font-bold text-forest">Name
          <input name="name" required defaultValue={profile?.name} autoComplete="off" className={field} />
        </label>
        <label className="space-y-1 text-sm font-bold text-forest">Age
          <input name="age" type="number" min={1} max={17} defaultValue={profile?.age ?? ""} className={field} />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-bold text-forest">Picture</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <label key={a} className="cursor-pointer">
              <input type="radio" name="avatar" value={a} defaultChecked={(profile?.avatar ?? AVATARS[0]) === a} className="peer sr-only" />
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-sand bg-surface text-2xl peer-checked:border-forest peer-checked:bg-sage-soft peer-checked:ring-2 peer-checked:ring-forest peer-focus-visible:ring-2 peer-focus-visible:ring-forest">{a}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1 text-sm font-bold text-forest">Interests
        <input id={`interests-${id}`} name="interests" defaultValue={profile?.interests.join(", ")} placeholder="Dinosaurs, space, drawing" className={field} />
        <span className="block text-xs font-normal text-muted">Separate with commas. Used to put favourites first on the home screen; never to choose what&apos;s allowed.</span>
      </label>
      {!profile && <p className="text-xs text-muted">New children start in Locked mode under age 5 and Ask first from 5. You can change it right after.</p>}
      {state && "error" in state && <p role="alert" className="text-sm font-bold text-bad">{state.error}</p>}
      {state && "ok" in state && <p role="status" className="text-sm font-bold text-ok">Saved.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : profile ? "Save profile" : "Add child"}</Button>
        {canDelete && profile && (
          <details className="text-sm">
            <summary className="cursor-pointer font-bold text-bad">Remove {profile.name}…</summary>
            <div className="mt-2 max-w-sm space-y-2 rounded-xl border border-bad/30 bg-bad-soft p-3">
              <p>This deletes {profile.name}&apos;s settings and the videos you allowed or blocked for {profile.name}. Viewing history is kept but no longer linked to {profile.name}.</p>
              <Button type="submit" formAction={deleteProfile} variant="danger" size="sm">Yes, remove {profile.name}</Button>
            </div>
          </details>
        )}
      </div>
    </form>
  );
}
