// Sectioned settings saves: each section changes only its own fields.
import { describe, expect, it } from "vitest";
import { applySettingsForm, FAMILY_WIDE, sectionsOf } from "@/lib/settings-form";
import { maya } from "./fixtures";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const base = maya({
  mode: "open", kidsOnlySearch: true, dailyCheckLimit: 12, blockedTags: ["violence", "scary_imagery"], blockedFormats: ["gameplay_commentary"],
  kidAge: 6, dailyMinutes: 45, bedtime: "19:30", skipLimit: 3, skipRegen: 1, skipCooldownSec: 120, freePeekSec: 30,
  boosts: { formats: { song: 2 }, pace: -1, learning: 1 }, flagThreshold: 3, pinHash: "s1$x$y",
});

describe("sectioned settings saves", () => {
  it("saving screen time leaves filters, mode, skips, boosts and the PIN alone", () => {
    const f = form([["section", "time"], ["dailyMinutes", "60"], ["bedtime", "20:00"]]);
    const out = applySettingsForm(base, f, sectionsOf(f));
    expect(out).toEqual({ ...base, dailyMinutes: 60, bedtime: "20:00", hideUnreviewed: true });
  });

  it("clearing the daily limit and bedtime in the time section removes them", () => {
    const f = form([["section", "time"], ["dailyMinutes", ""], ["bedtime", ""]]);
    const out = applySettingsForm(base, f, sectionsOf(f));
    expect(out.dailyMinutes).toBeUndefined();
    expect(out.bedtime).toBeUndefined();
    expect(out.blockedTags).toEqual(base.blockedTags);
  });

  it("saving content rules replaces tags/formats/age only", () => {
    const f = form([["section", "content"], ["block:monsters", "on"], ["blockfmt:vlog_challenge", "on"], ["kidAge", "7"]]);
    const out = applySettingsForm(base, f, sectionsOf(f));
    expect(out).toEqual({ ...base, blockedTags: ["monsters"], blockedFormats: ["vlog_challenge"], kidAge: 7, hideUnreviewed: true });
  });

  it("saving the viewing mode doesn't touch time or filters", () => {
    const f = form([["section", "access"], ["mode", "locked"], ["dailyCheckLimit", "5"]]);
    const out = applySettingsForm(base, f, sectionsOf(f));
    expect(out).toEqual({ ...base, mode: "locked", kidsOnlySearch: false, dailyCheckLimit: 5, hideUnreviewed: true });
  });

  it("an unknown mode keeps the current one", () => {
    const f = form([["section", "access"], ["mode", "anything"]]);
    expect(applySettingsForm(base, f, sectionsOf(f)).mode).toBe("open");
  });

  it("family settings change only the family-wide fields", () => {
    const f = form([["section", "family"], ["flagThreshold", "5"]]);
    const out = applySettingsForm(base, f, sectionsOf(f), "s1$new$hash");
    expect(out).toEqual({ ...base, flagThreshold: 5, pinHash: "s1$new$hash", hideUnreviewed: true });
    expect(FAMILY_WIDE).toEqual(["pinHash", "flagThreshold"]);
  });

  it("a form with no section is the old all-in-one form (every section applies)", () => {
    expect(sectionsOf(form([["mode", "open"]]))).toEqual(["access", "content", "time", "skips", "arrange", "family"]);
    expect(sectionsOf(form([["section", "time"], ["section", "bogus"]]))).toEqual(["time"]);
  });

  it("turning skip limits off clears the limit but keeps the other skip fields valid", () => {
    const f = form([["section", "skips"]]);
    const out = applySettingsForm(base, f, sectionsOf(f));
    expect(out.skipLimit).toBeUndefined();
    expect(out.blockedTags).toEqual(base.blockedTags);
  });
});
