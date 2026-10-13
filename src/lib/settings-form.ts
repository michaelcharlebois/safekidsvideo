// Turning a settings form into saved settings — one section at a time. The Kids & settings pages save
// each section separately (viewing mode, content rules, screen time…), so a section's form only carries
// its own fields. Applying a field that isn't in the form would wipe it (an absent checkbox reads as "off",
// an absent number as "no limit"), so ONLY the named sections are applied; everything else is kept.
// Pure, so it's tested directly.
import { CONCERN_TAGS, FORMATS, type ConcernTag, type FamilyMode, type FamilySettings, type VideoFormat } from "@/lib/types";

export const SETTINGS_SECTIONS = ["access", "content", "time", "skips", "arrange", "family"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Which settings are the child's own, and which apply to the whole family (stored once, on the family). */
export const FAMILY_WIDE: (keyof FamilySettings)[] = ["pinHash", "flagThreshold"];

type FormLike = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

const clampBoost = (v: FormDataEntryValue | null) => Math.max(-2, Math.min(2, Math.round(Number(v ?? 0)) || 0));

/** The sections a form says it carries; none named = the legacy all-in-one form (every section). */
export function sectionsOf(form: FormLike): SettingsSection[] {
  const named = form.getAll("section").map(String).filter((s): s is SettingsSection => (SETTINGS_SECTIONS as readonly string[]).includes(s));
  return named.length ? [...new Set(named)] : [...SETTINGS_SECTIONS];
}

/**
 * New settings = current settings with the named sections replaced from the form. `pinHash` is passed in
 * already hashed (or undefined for "unchanged") because hashing and the 1234 rule live in the action.
 */
export function applySettingsForm(current: FamilySettings, form: FormLike, sections: SettingsSection[], pinHash?: string): FamilySettings {
  const on = (name: string) => form.get(name) === "on";
  const num = (name: string) => Number(form.get(name));
  const next: FamilySettings = { ...current, hideUnreviewed: true }; // not a choice any more: unreviewed never plays automatically
  const has = (s: SettingsSection) => sections.includes(s);

  if (has("access")) {
    const m = String(form.get("mode") ?? "");
    next.mode = (["locked", "open", "open_ask"].includes(m) ? m : current.mode) as FamilyMode;
    next.kidsOnlySearch = on("kidsOnlySearch");
    next.dailyCheckLimit = Math.min(200, num("dailyCheckLimit")) || current.dailyCheckLimit;
  }
  if (has("content")) {
    next.blockedTags = CONCERN_TAGS.filter((t) => on(`block:${t}`)) as ConcernTag[];
    next.blockedFormats = FORMATS.filter((f) => on(`blockfmt:${f}`)) as VideoFormat[];
    const age = num("kidAge");
    next.kidAge = age >= 1 && age <= 17 ? age : current.kidAge;
  }
  if (has("time")) {
    next.dailyMinutes = num("dailyMinutes") > 0 ? Math.min(600, num("dailyMinutes")) : undefined;
    const bed = String(form.get("bedtime") ?? "");
    next.bedtime = /^\d{2}:\d{2}$/.test(bed) ? bed : undefined;
  }
  if (has("skips")) {
    next.skipLimit = on("skipsOn") ? Math.max(1, Math.min(20, num("skipLimit") || 3)) : undefined;
    next.skipRegen = Math.max(0, Math.min(5, form.get("skipRegen") != null ? num("skipRegen") : current.skipRegen ?? 1));
    next.skipCooldownSec = Math.max(30, Math.min(900, (num("skipCooldownMin") || 2) * 60));
    next.freePeekSec = Math.max(0, Math.min(120, form.get("freePeekSec") != null ? num("freePeekSec") : current.freePeekSec ?? 30));
  }
  if (has("arrange")) {
    next.boosts = {
      ...current.boosts,
      formats: Object.fromEntries(FORMATS.map((f) => [f, clampBoost(form.get(`boost:${f}`))]).filter(([, n]) => n !== 0)) as Record<VideoFormat, number>,
      pace: clampBoost(form.get("boost:pace")),
      learning: clampBoost(form.get("boost:learning")),
    };
  }
  if (has("family")) {
    if (pinHash) next.pinHash = pinHash;
    const t = num("flagThreshold");
    if (t >= 1 && t <= 50) next.flagThreshold = t;
  }
  return next;
}
