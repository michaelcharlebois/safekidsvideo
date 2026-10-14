"use client";

import { useActionState, useState, useEffect, type ReactNode } from "react";
import { selectProfile } from "@/app/actions";

/** No PIN needed here (a parent's own browser): one tap picks. The server still decides (selectProfile). */
export function PickTile({ profileId, next, name, tv, children }: { profileId: string; next: string; name: string; tv: boolean; children: ReactNode }) {
  const [state, action, pending] = useActionState(selectProfile, null);
  return (
    <form action={action}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" disabled={pending} className={`flex w-full flex-col items-center outline-none ${tv ? "gap-[1.2vw] px-[1vw] py-[2vw]" : "gap-3 px-4 py-6"}`}>
        {children}
        <span className={tv ? "tv-title text-[1.8vw] font-extrabold" : "text-xl font-extrabold"}>{name}</span>
        {state?.error && <span role="alert" className="text-sm font-bold text-[var(--kfocus)]">{state.error}</span>}
      </button>
    </form>
  );
}

/**
 * Shared screen: a 4-digit PIN pad. Touch, the remote's arrows + OK, or its number keys. The check, and the
 * attempt lockout, happen on the server; a wrong PIN clears the dots and says so.
 */
export function PinPad({ profileId, next, tv }: { profileId: string; next: string; tv: boolean }) {
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
  const key = tv ? "bigbtn h-[5.4vw] w-[7vw] rounded-[1.2vw] text-[2.2vw] font-extrabold" : "bigbtn h-16 w-20 rounded-2xl text-2xl font-extrabold sm:h-[4.5rem] sm:w-24";
  return (
    <form action={action} className={`flex flex-col items-center ${tv ? "mt-[3vh] gap-[1.4vh]" : "mt-6 gap-3"}`}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="pin" value={pin} />
      <div className={`flex ${tv ? "gap-[1vw]" : "gap-3"}`} role="status" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => <span key={i} className={`rounded-full ${tv ? "h-[1.2vw] w-[1.2vw]" : "h-4 w-4"} ${i < pin.length ? "bg-[var(--kfocus)]" : "bg-[rgb(255_249_241/0.18)]"}`} />)}
      </div>
      <p role="alert" className={`min-h-[1.5em] font-bold text-[var(--kfocus)] ${tv ? "text-[1.4vw]" : "text-base"}`}>{state?.error ?? ""}</p>
      <div className={`flex flex-col ${tv ? "gap-[0.8vw]" : "gap-2"}`}>
        {rows.map((r, i) => (
          <div key={r.join("")} data-nav-row className={`flex ${tv ? "gap-[0.8vw]" : "gap-2"}`}>
            {r.map((k) =>
              k === "OK" ? (
                <button key={k} type="submit" disabled={pending || pin.length !== 4} className={`${key} bg-[var(--kfocus)] text-[#2a1206] disabled:opacity-40`}>OK</button>
              ) : (
                <button key={k} type="button" data-tv-start={i === 0 && k === "1" ? "" : undefined} aria-label={k === "⌫" ? "Delete a digit" : k}
                  onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : press(k))} className={`${key} bg-[rgb(255_249_241/0.1)]`}>{k}</button>
              ),
            )}
          </div>
        ))}
      </div>
    </form>
  );
}
