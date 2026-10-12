"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions";
import { Button } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  if (state && "sent" in state) {
    return (
      <div className="mt-6 rounded-xl bg-grass p-4 text-sm font-semibold">
        Check <b>{state.email}</b> for a sign-in link. You can close this tab.
      </div>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@example.com"
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-lg outline-none focus:border-accent"
      />
      {state && "error" in state && <p className="text-bad text-sm font-bold">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Sending…" : "Email me a link"}
      </Button>
    </form>
  );
}
