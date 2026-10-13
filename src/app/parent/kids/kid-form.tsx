"use client";

import { useActionState } from "react";
import { deleteProfile, saveProfile } from "@/app/actions";
import { Button } from "@/components/ui";
import { AVATARS, type Profile } from "@/lib/types";

export function KidForm({ profile, canDelete }: { profile?: Profile; canDelete: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, null);
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="id" value={profile?.id ?? ""} />
      <div className="flex gap-2">
        <input name="name" required defaultValue={profile?.name} placeholder="Name" className="flex-1 rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-accent" />
        <input name="age" type="number" min={1} max={17} defaultValue={profile?.age ?? ""} placeholder="Age" className="w-20 rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-accent" />
      </div>
      <div>
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Avatar</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {AVATARS.map((a) => (
            <label key={a} className="cursor-pointer">
              <input type="radio" name="avatar" value={a} defaultChecked={(profile?.avatar ?? AVATARS[0]) === a} className="peer sr-only" />
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-2xl peer-checked:border-ink peer-checked:bg-ink/10">{a}</span>
            </label>
          ))}
        </div>
      </div>
      <input name="interests" defaultValue={profile?.interests.join(", ")} placeholder="Interests, comma-separated (dinosaurs, space, Bluey…)" className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
      {state && "error" in state && <p className="text-sm font-bold text-bad">{state.error}</p>}
      {state && "ok" in state && <p className="text-sm font-bold text-ok">Saved.</p>}
      <div className="flex items-center justify-between">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : profile ? "Save" : "Add kid"}</Button>
        {canDelete && profile && (
          <Button type="submit" formAction={deleteProfile} variant="ghost" className="text-bad">Remove</Button>
        )}
      </div>
    </form>
  );
}
