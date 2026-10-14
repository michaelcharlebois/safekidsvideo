import "server-only";
import { localDay } from "@/lib/checkin";
import { serverNow } from "@/lib/clock";
import { minutesUsedToday } from "@/lib/screentime";
import { bedtimeNow, clockTime, extensionChoices, nightOf, type BedtimeExtension } from "@/lib/bedtime";
import { listExtensions } from "@/lib/bedtime-store";
import type { FamilySettings } from "@/lib/types";

/** What a parent needs to answer an ask or extend bedtime for one child, tonight: actual clock times. */
export type ChildTime = {
  usedMinutes: number; limitMinutes?: number; limitReached: boolean;
  bedtime?: string; bedtimeLabel?: string;
  /** When videos stop tonight (scheduled, or the authorized cutoff), as a clock time. */
  stopsLabel?: string;
  extension: BedtimeExtension | null;
  inBedtime: boolean;
  /** 15/30/45/60 past tonight's bedtime, each with its actual cutoff ("8:00 PM") and whether it's passed. */
  choices: { minutes: number; label: string; passed: boolean }[];
};

export async function childTime(familyId: string, s: FamilySettings, tz?: string, now = serverNow()): Promise<ChildTime> {
  const today = localDay(tz, now);
  const bonus = s.bonusDay === today ? s.bonusMinutes ?? 0 : 0;
  const limit = s.dailyMinutes ? s.dailyMinutes + bonus : undefined;
  const used = await minutesUsedToday(familyId, s.profileId, tz, now);
  const b = bedtimeNow(now, s.bedtime, tz, s.bedtime && s.profileId ? (await listExtensions(familyId, nightOf(now, tz))).filter((e) => e.profileId === s.profileId) : []);
  return {
    usedMinutes: used, limitMinutes: limit, limitReached: limit != null && used >= limit,
    bedtime: s.bedtime, bedtimeLabel: b.scheduled ? clockTime(b.scheduled, tz) : undefined,
    stopsLabel: b.stopsAt ? clockTime(b.stopsAt, tz) : undefined,
    extension: b.extension, inBedtime: b.inBedtime,
    choices: extensionChoices(now, s.bedtime, tz).map((c) => ({ minutes: c.minutes, label: clockTime(c.cutoff, tz), passed: c.passed })),
  };
}

/** The notice after a parent's answer (?time=…). */
export function timeNotice(code: string, name?: string): string | null {
  const who = name ?? "They";
  if (code === "declined") return `Declined. ${who} won't be able to ask again today.`;
  if (code === "ext-declined") return `Not tonight. ${who} won't be able to ask again tonight.`;
  if (code === "ext-cancelled") return "Tonight's later bedtime is cancelled. Bedtime is back to the usual time.";
  const m = /^(added|ext)-(\d+)$/.exec(code);
  if (!m) return null;
  return m[1] === "added" ? `Added ${m[2]} minutes for today.` : `Done: videos can play ${m[2]} minutes past bedtime tonight.`;
}
