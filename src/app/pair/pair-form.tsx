"use client";

import { useActionState } from "react";
import { pairDevice } from "@/app/actions";
import { Button } from "@/components/ui";

export function PairForm() {
  const [state, action, pending] = useActionState(pairDevice, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input
        name="code"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoFocus
        autoComplete="one-time-code"
        placeholder="000000"
        className="w-full rounded-xl border border-line bg-surface px-4 py-4 text-center text-3xl tracking-[0.4em] font-extrabold outline-none focus:border-accent"
      />
      <input
        name="name"
        placeholder="Name this device (e.g. Living room iPad)"
        className="w-full rounded-xl border border-line bg-surface px-4 py-2 text-sm outline-none focus:border-accent"
      />
      {state?.error && <p className="text-bad text-sm font-bold">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}
