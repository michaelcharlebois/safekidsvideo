// Bedtime ("done for the day") and the one-night bedtime extension. Pure: everything is computed from the
// family's time zone, the child's recurring bedtime and tonight's extension (if any), so the server, the
// player and the tests agree.
//
// A NIGHT is named by the evening's family-local date and runs from 04:00 that day to 04:00 the next (the
// rollover). Bedtime runs from the scheduled time to the rollover; a bedtime after midnight (e.g. 00:30)
// belongs to the night before. All comparisons are between absolute instants, so daylight-saving nights and
// devices that sleep and wake get the right answer from the clock alone.
//
// An extension is the specific cutoff a parent authorized for one child for one night (cutoff_at). It is not
// moved if the recurring bedtime changes later: tonight's bedtime starts at the LATER of the scheduled time
// and the authorized cutoff. It expires on its own at the rollover. It never adds daily minutes, and extra
// minutes never lift bedtime.

export const ROLLOVER_MIN = 4 * 60;
export const EXTENSION_STEPS = [15, 30, 45, 60] as const;
export type ExtensionMinutes = (typeof EXTENSION_STEPS)[number];
export const isExtensionMinutes = (m: number): m is ExtensionMinutes => (EXTENSION_STEPS as readonly number[]).includes(m);

export type BedtimeExtension = {
  id: string; familyId: string; profileId: string;
  night: string;          // YYYY-MM-DD, the evening's local date
  baseBedtime: string;    // HH:MM the scheduled bedtime was when granted
  extraMinutes: ExtensionMinutes;
  cutoffAt: string;       // ISO instant: the cutoff the parent authorized
  requestId?: string; grantedBy?: string;
  createdAt: string; updatedAt?: string; cancelledAt?: string;
};

const TZ = (tz?: string) => tz || "America/Los_Angeles";

/** Wall-clock date and minute-of-day of an instant in a time zone. */
export function wallClock(d: Date, tz?: string): { date: string; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function offsetMs(utcMs: number, tz?: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ(tz), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant at which the local wall clock in `tz` reads `date` + `minutes` (minutes may exceed a day).
 * On a daylight-saving gap the nonexistent time resolves to the shifted hour; on an overlap, the first one.
 */
export function zonedInstant(date: string, minutes: number, tz?: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const a = naive - offsetMs(naive, tz);
  const b = naive - offsetMs(a, tz);
  const reads = (t: number) => t + offsetMs(t, tz) === naive; // the wall clock at t is the one asked for
  const ok = [a, b].filter(reads);
  if (ok.length) return new Date(Math.min(...ok)); // an overlap has two readings: the first
  return new Date(Math.max(a, b));                  // a gap has none: the time just after it
}

/** The night an instant belongs to (before 04:00 it's still the previous evening's night). */
export function nightOf(now: Date, tz?: string): string {
  const w = wallClock(now, tz);
  return w.min >= ROLLOVER_MIN ? w.date : addDays(w.date, -1);
}

const parseHHMM = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
};

/** Scheduled bedtime and rollover instants for a night. A bedtime before 04:00 falls after midnight. */
export function nightWindow(night: string, bedtime: string, tz?: string): { scheduled: Date; end: Date } | null {
  const b = parseHHMM(bedtime);
  if (b == null) return null;
  return { scheduled: zonedInstant(night, b < ROLLOVER_MIN ? b + 1440 : b, tz), end: zonedInstant(addDays(night, 1), ROLLOVER_MIN, tz) };
}

/** The cutoff a parent would authorize with `minutes` past tonight's scheduled bedtime (never past 03:59). */
export function extensionCutoff(night: string, bedtime: string, minutes: ExtensionMinutes, tz?: string): Date | null {
  const w = nightWindow(night, bedtime, tz);
  if (!w) return null;
  return new Date(Math.min(w.scheduled.getTime() + minutes * 60_000, w.end.getTime() - 60_000));
}

export type BedtimeNow = {
  night: string;
  /** No bedtime set: none of the rest applies (an extension is ignored). */
  scheduled: Date | null;
  /** When videos stop tonight: the later of the scheduled bedtime and an authorized cutoff. */
  stopsAt: Date | null;
  end: Date | null;
  extension: BedtimeExtension | null;
  inBedtime: boolean;
};

/** Where this child stands right now with respect to bedtime. */
export function bedtimeNow(now: Date, bedtime: string | undefined, tz: string | undefined, extensions: BedtimeExtension[] = []): BedtimeNow {
  const night = nightOf(now, tz);
  const w = bedtime ? nightWindow(night, bedtime, tz) : null;
  if (!w) return { night, scheduled: null, stopsAt: null, end: null, extension: null, inBedtime: false };
  const extension = extensions.find((e) => e.night === night && !e.cancelledAt) ?? null;
  const cutoff = extension ? new Date(extension.cutoffAt) : null;
  const stopsAt = cutoff && cutoff > w.scheduled ? new Date(Math.min(cutoff.getTime(), w.end.getTime())) : w.scheduled;
  return { night, scheduled: w.scheduled, stopsAt, end: w.end, extension, inBedtime: now >= stopsAt && now < w.end };
}

/** Choices a parent sees tonight: each the actual cutoff, and whether it's already passed. */
export function extensionChoices(now: Date, bedtime: string | undefined, tz?: string) {
  const night = nightOf(now, tz);
  if (!bedtime) return [];
  return EXTENSION_STEPS.map((m) => {
    const cutoff = extensionCutoff(night, bedtime, m, tz)!;
    return { minutes: m, cutoff, passed: cutoff <= now };
  });
}

export const clockTime = (d: Date, tz?: string) => d.toLocaleTimeString("en-US", { timeZone: TZ(tz), hour: "numeric", minute: "2-digit" });
