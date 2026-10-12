"use client";

import { useActionState } from "react";
import { signIn, verifyCode } from "@/app/actions";
import { Button } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  if (state && "sent" in state) return <CodeForm email={state.email} next={next} />;
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

function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState(verifyCode, null);
  return (
    <form action={action} className="mt-6 space-y-3">
      <div className="rounded-xl bg-grass p-3 text-sm font-semibold">
        We emailed a 6-digit code to <b>{email}</b>. Type it here.
      </div>
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        placeholder="000000"
        className="w-full rounded-xl border border-line bg-surface px-4 py-4 text-center text-3xl tracking-[0.4em] font-extrabold outline-none focus:border-accent"
      />
      {state?.error && <p className="text-bad text-sm font-bold">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Checking…" : "Sign in"}
      </Button>
    </form>
  );
}
