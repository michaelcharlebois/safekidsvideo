import { describe, expect, it } from "vitest";
import { hashPin, LEGACY_DEFAULT_PIN, newPinProblem, pinIsSet, verifyPin } from "@/lib/pin";
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
  it("the old default PIN doesn't count as set — plain or hashed; a chosen one does", () => {
    expect(pinIsSet(LEGACY_DEFAULT_PIN)).toBe(false);
    expect(pinIsSet(undefined)).toBe(false);
    expect(pinIsSet(hashPin("1234"))).toBe(false);
    expect(pinIsSet(hashPin("2580"))).toBe(true);
    expect(pinIsSet("9876")).toBe(true);
  });
  it("a parent can't choose 1234 (or a non-4-digit PIN) as a new PIN", () => {
    expect(newPinProblem("1234")).toMatch(/other than 1234/);
    expect(newPinProblem("123")).toMatch(/4 digits/);
    expect(newPinProblem("12a4")).toMatch(/4 digits/);
    expect(newPinProblem("2580")).toBeNull();
  });
  // Lockout is enforced in the database: see test/pin-lockout-db.test.ts.
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
