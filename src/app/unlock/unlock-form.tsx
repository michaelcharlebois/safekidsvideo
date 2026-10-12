"use client";

import { useActionState } from "react";
import { unlock } from "@/app/actions";
import { Button } from "@/components/ui";

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(unlock, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="pin"
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        autoFocus
        autoComplete="off"
        className="w-full rounded-xl border border-line bg-surface px-4 py-4 text-center text-3xl tracking-[0.5em] font-extrabold outline-none focus:border-accent"
        placeholder="••••"
        type="password"
      />
      {state?.error && <p className="text-bad text-sm font-bold">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Checking…" : "Unlock"}
      </Button>
    </form>
  );
}
