"use client";

import { useActionState } from "react";
import { addByUrl } from "@/app/actions";
import { Button } from "@/components/ui";

export function AddForm() {
  const [state, action, pending] = useActionState(addByUrl, null);
  return (
    <form action={action} className="mt-3 flex flex-col sm:flex-row gap-2">
      <input
        name="url"
        required
        placeholder="https://www.youtube.com/watch?v=…  or  @SuperSimpleSongs"
        className="flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm outline-none focus:border-accent"
      />
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Approve"}</Button>
      {state && (
        <p className={`sm:basis-full text-sm font-bold ${state.ok ? "text-ok" : "text-bad"}`}>{state.ok ? state.message : state.error}</p>
      )}
    </form>
  );
}
