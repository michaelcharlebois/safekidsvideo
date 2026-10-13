"use client";

import { useState } from "react";
import type { FamilyMode } from "@/lib/types";

export type ModeCopy = { mode: FamilyMode; title: string; tagline: string; watch: string; ask: string };

/**
 * The three viewing modes as radio cards. The chosen mode always shows its full description; on a phone
 * the other two show just their name and tagline, with "What this means" to expand them without choosing
 * (on wider screens everything is shown). Choosing only takes effect when the section is saved.
 */
export function ModePicker({ modes, current }: { modes: ModeCopy[]; current: FamilyMode }) {
  const [chosen, setChosen] = useState<FamilyMode>(current);
  const [open, setOpen] = useState<Set<FamilyMode>>(new Set());
  return (
    <fieldset>
      <legend className="sr-only">Viewing mode</legend>
      <div className="grid gap-3 md:grid-cols-3">
        {modes.map((m) => {
          const isChosen = chosen === m.mode;
          const expanded = isChosen || open.has(m.mode);
          return (
            <label key={m.mode} className="relative cursor-pointer">
              <input type="radio" name="mode" value={m.mode} checked={isChosen} onChange={() => setChosen(m.mode)} className="peer sr-only" />
              <span className="flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border border-sand bg-surface p-4 peer-checked:border-forest peer-checked:bg-sage-soft peer-checked:ring-2 peer-checked:ring-forest peer-focus-visible:ring-2 peer-focus-visible:ring-forest">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-forest">{m.title}</span>
                  {isChosen && <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-bold text-ivory">{m.mode === current ? "Current" : "Selected"}</span>}
                </span>
                <span className="text-xs font-semibold text-muted">{m.tagline}</span>
                <span className={`${expanded ? "block" : "hidden"} space-y-1.5 md:block`}>
                  <span className="block text-sm text-ink">{m.watch}</span>
                  <span className="block text-sm text-muted">{m.ask}</span>
                </span>
                {!isChosen && (
                  // A button inside a label doesn't select the radio: peeking never changes the choice.
                  <button type="button" aria-expanded={expanded} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(m.mode)) n.delete(m.mode); else n.add(m.mode); return n; })}
                    className="self-start text-xs font-bold text-forest underline decoration-sand underline-offset-4 md:hidden">
                    {expanded ? "Hide details" : "What this means"}
                  </button>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {chosen !== current && <p className="mt-2 text-sm font-bold text-apricot-ink" role="status">Not saved yet. Save viewing mode to switch.</p>}
    </fieldset>
  );
}
