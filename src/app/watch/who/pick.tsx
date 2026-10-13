"use client";

import { useActionState, useState, useEffect } from "react";
import { selectProfile } from "@/app/actions";

/** No PIN needed (parent preview, single-child family): one tap picks. */
export function PickTile({ profileId, next, avatar, name }: { profileId: string; next: string; avatar: string; name: string }) {
  const [state, action, pending] = useActionState(selectProfile, null);
  return (
    <form action={action}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" disabled={pending} className="flex w-full flex-col items-center gap-3 px-4 py-6 outline-none">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-6xl">{avatar}</span>
        <span className="text-xl font-extrabold">{name}</span>
        {state?.error && <span className="text-sm font-bold text-[var(--kfocus)]">{state.error}</span>}
      </button>
    </form>
  );
}

/** Shared screen: a 4-digit PIN pad. Works with touch, the remote's arrows + OK, or the remote's number keys. */
export function PinPad({ profileId, next }: { profileId: string; next: string }) {
  const [state, action, pending] = useActionState(selectProfile, null);
  const [pin, setPin] = useState("");
  const press = (d: string) => setPin((p) => (p.length < 4 ? p + d : p));

  // Remote number keys / keyboard digits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = /^\d$/.test(e.key) ? e.key : e.keyCode >= 48 && e.keyCode <= 57 ? String(e.keyCode - 48) : null;
      if (d) { e.preventDefault(); setPin((p) => (p.length < 4 ? p + d : p)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // A wrong PIN clears the dots.
  useEffect(() => { if (state?.error) queueMicrotask(() => setPin("")); }, [state]);

  const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["⌫", "0", "OK"]];
  return (
    <form action={action} className="mt-6 flex flex-col items-center gap-3">
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="pin" value={pin} />
      <div className="flex gap-3" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`h-5 w-5 rounded-full ${i < pin.length ? "bg-[var(--kfocus)]" : "bg-white/15"}`} />)}
      </div>
      {state?.error && <p className="font-bold text-[var(--kfocus)]">{state.error}</p>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.join("")} data-nav-row className="flex gap-2">
            {r.map((k) =>
              k === "OK" ? (
                <button key={k} type="submit" disabled={pending || pin.length !== 4} className="bigbtn h-16 w-20 rounded-2xl bg-[var(--kfocus)] text-2xl font-extrabold text-[#0b1020] disabled:opacity-40">OK</button>
              ) : (
                <button key={k} type="button" onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))} className="bigbtn h-16 w-20 rounded-2xl bg-white/10 text-2xl font-extrabold">{k}</button>
              ),
            )}
          </div>
        ))}
      </div>
    </form>
  );
}
