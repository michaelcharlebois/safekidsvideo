import { describe, expect, it } from "vitest";
import { chooseKidUi } from "@/lib/form-factor";

const SAMSUNG = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36";
const LG = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager";
const FIRE = "Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("kid interface choice", () => {
  it("TV engines get the TV interface (Samsung wrapper included)", () => {
    for (const ua of [SAMSUNG, LG, FIRE]) expect(chooseKidUi(ua)).toBe("tv");
  });
  it("tablets and phones get touch (width decides which layout)", () => {
    expect(chooseKidUi(IPAD)).toBe("touch");
    expect(chooseKidUi(IPHONE)).toBe("touch");
  });
  it("an explicit choice wins; junk is ignored", () => {
    expect(chooseKidUi(IPAD, "tv")).toBe("tv");
    expect(chooseKidUi(SAMSUNG, "phone")).toBe("phone");
    expect(chooseKidUi(IPHONE, "desktop")).toBe("touch");
  });
});
