import { describe, expect, it } from "vitest";
import { afterPinAttempt, hashPin, LEGACY_DEFAULT_PIN, PIN_LOCK_MS, PIN_MAX_FAILURES, pinIsSet, pinLocked, verifyPin } from "@/lib/pin";
import { pickKid } from "@/lib/kid-pick";

describe("family PIN", () => {
  it("hashes and verifies; never stores the PIN", () => {
    const h = hashPin("4821");
    expect(h).not.toContain("4821");
    expect(verifyPin("4821", h)).toBe(true);
    expect(verifyPin("4822", h)).toBe(false);
    expect(hashPin("4821")).not.toBe(h); // salted
  });
  it("accepts a legacy plain PIN, rejects junk", () => {
    expect(verifyPin("5555", "5555")).toBe(true);
    expect(verifyPin("abcd", "abcd")).toBe(false);
    expect(verifyPin("", hashPin("1111"))).toBe(false);
  });
  it("the old default PIN doesn't count as set; a chosen one does", () => {
    expect(pinIsSet(LEGACY_DEFAULT_PIN)).toBe(false);
    expect(pinIsSet(undefined)).toBe(false);
    expect(pinIsSet(hashPin("1234"))).toBe(true);
    expect(pinIsSet("9876")).toBe(true);
  });
  it("locks after repeated failures, then unlocks", () => {
    let s = { failures: 0, lockedUntil: null as string | null };
    const t0 = Date.parse("2026-10-13T12:00:00Z");
    for (let i = 0; i < PIN_MAX_FAILURES - 1; i++) s = { failures: afterPinAttempt(s, false, t0).failures, lockedUntil: null };
    expect(pinLocked(s, t0)).toBe(0);
    s = afterPinAttempt(s, false, t0) as typeof s;
    expect(pinLocked(s, t0)).toBe(PIN_LOCK_MS / 1000);
    expect(pinLocked(s, t0 + PIN_LOCK_MS + 1)).toBe(0);
    expect(afterPinAttempt(s, true, t0)).toEqual({ failures: 0, lockedUntil: null });
  });
});

describe("which child is this screen for", () => {
  const two = [{ id: "maya" }, { id: "leo" }];
  it("a personal device is always its child, whatever was picked", () => expect(pickKid(two, "leo", "maya")).toBe("leo"));
  it("one-child family: that child", () => expect(pickKid([{ id: "solo" }], null, null)).toBe("solo"));
  it("shared screen: the PIN-picked child", () => expect(pickKid(two, null, "maya")).toBe("maya"));
  it("shared screen, nobody picked: nobody (fail closed)", () => expect(pickKid(two, null, null)).toBeUndefined());
  it("a pick from another family is ignored", () => expect(pickKid(two, null, "stranger")).toBeUndefined());
  it("a stale assignment to a deleted child falls back to the PIN rules", () => expect(pickKid(two, "gone", null)).toBeUndefined());
});
