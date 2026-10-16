"use client";

import { useState } from "react";

const parse = (time: string | undefined) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!match) return { enabled: false, hour: "8", minute: "00", period: "PM" };
  const h = Number(match[1]);
  return { enabled: true, hour: String(h % 12 || 12), minute: match[2], period: h < 12 ? "AM" : "PM" };
};

/** Friendly 12-hour control; the server still receives the original 24-hour HH:MM field. */
export function BedtimePicker({ initial, timezone }: { initial?: string; timezone: string }) {
  const seed = parse(initial);
  const [enabled, setEnabled] = useState(seed.enabled);
  const [hour, setHour] = useState(seed.hour);
  const [minute, setMinute] = useState(seed.minute);
  const [period, setPeriod] = useState(seed.period);
  const hour24 = Number(hour) % 12 + (period === "PM" ? 12 : 0);
  const value = enabled ? `${String(hour24).padStart(2, "0")}:${minute}` : "";
  const cls = "rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm font-semibold text-forest";
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="font-bold text-forest">Done for the day at</legend>
      <p className="text-muted">The kid screen stops until 4 am. Time zone: {timezone}.</p>
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-[var(--forest)]" />
        Set an evening cutoff
      </label>
      <input type="hidden" name="bedtime" value={value} />
      {enabled && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Cutoff time">
          <label className="sr-only" htmlFor="bedtime-hour">Hour</label>
          <select id="bedtime-hour" value={hour} onChange={(e) => setHour(e.target.value)} className={cls}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <span aria-hidden>:</span>
          <label className="sr-only" htmlFor="bedtime-minute">Minute</label>
          <select id="bedtime-minute" value={minute} onChange={(e) => setMinute(e.target.value)} className={cls}>
            {["00", "15", "30", "45"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <label className="sr-only" htmlFor="bedtime-period">AM or PM</label>
          <select id="bedtime-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={cls}>
            <option value="AM">AM</option><option value="PM">PM</option>
          </select>
        </div>
      )}
    </fieldset>
  );
}
