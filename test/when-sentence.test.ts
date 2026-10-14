// Home's rules sentence states tonight's effective times, so it never contradicts the Tonight card.
import { describe, expect, it } from "vitest";
import { whenSentence } from "@/lib/modes";

describe("whenSentence", () => {
  const s = { dailyMinutes: 45, bedtime: "19:30" };
  it("the usual rules when nothing changed today", () => {
    expect(whenSentence(s)).toBe("Up to 45 minutes a day, done by 7:30 pm");
    expect(whenSentence(s, { limitMinutes: 45, stopsLabel: "7:30 PM", extended: false })).toBe("Up to 45 minutes a day, done by 7:30 pm");
    expect(whenSentence({})).toBe("No daily limit or bedtime");
  });
  it("tonight's later bedtime leads, with the usual time alongside", () => {
    expect(whenSentence(s, { limitMinutes: 45, stopsLabel: "8:00 PM", extended: true })).toBe("Up to 45 minutes a day, done by 8:00 pm tonight (usually 7:30 pm)");
    expect(whenSentence({ bedtime: "21:53" }, { stopsLabel: "10:23 PM", extended: true })).toBe("Done by 10:23 pm tonight (usually 9:53 pm)");
  });
  it("extra minutes today show today's total", () => {
    expect(whenSentence(s, { limitMinutes: 60, stopsLabel: "7:30 PM", extended: false })).toBe("Up to 60 minutes today (usually 45), done by 7:30 pm");
  });
});
