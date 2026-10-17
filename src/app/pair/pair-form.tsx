"use client";

import { useActionState, useEffect, type KeyboardEvent } from "react";
import { logDiag } from "@/lib/tv-diagnostics";
import { pairDevice } from "@/app/actions";
import { Button } from "@/components/ui";

/** Remote number keys arrive as key events but TV engines don't always type them — do it ourselves. */
function onDigitKey(e: KeyboardEvent<HTMLInputElement>) {
  const digit = /^\d$/.test(e.key) ? e.key : e.keyCode >= 48 && e.keyCode <= 57 ? String(e.keyCode - 48) : null;
  if (!digit) return;
  e.preventDefault();
  const el = e.currentTarget;
  if (el.value.length < el.maxLength) el.value += digit;
}

export function PairForm() {
  const [state, action, pending] = useActionState(pairDevice, null);
  // A failed pairing goes to the diagnostics (press 0 three times on this screen, or the server log).
  useEffect(() => { if (state?.error) logDiag("pairing", state.error); }, [state]);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input
        name="code"
        inputMode="numeric"
        pattern="\d{6,8}"
        maxLength={8}
        autoFocus
        autoComplete="one-time-code"
        placeholder="00000000"
        onKeyDown={onDigitKey}
        className="w-full rounded-xl border border-line bg-white/10 text-white px-4 py-4 text-center text-3xl tracking-[0.3em] font-extrabold outline-none focus:border-accent"
      />
      <input
        name="name"
        placeholder="Name this device (e.g. Living room TV)"
        className="w-full rounded-xl border border-line bg-white/10 text-white px-4 py-2 text-sm outline-none focus:border-accent"
      />
      {state?.error && <p className="text-bad text-sm font-bold">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Connecting…" : "Connect"}
      </Button>
    </form>
  );
}
