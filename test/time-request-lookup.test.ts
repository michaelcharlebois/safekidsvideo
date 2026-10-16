import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve(import.meta.dirname, "../src/lib/more-time.ts"), "utf8");

describe("time request answer lookup", () => {
  it("looks up the exact request scoped to its family", () => {
    expect(src).toContain("const req = await getTimeRequest(familyId, requestId);");
    expect(src).toMatch(/\.eq\("family_id", familyId\)\.eq\("id", requestId\)\.maybeSingle\(\)/);
  });
  it("does not use the invalid year-zero date to find pending requests", () => {
    expect(src).not.toContain('"0000-01-01", now');
  });
  it("does not treat database errors as no outstanding requests", () => {
    expect(src).toContain("if (error) throw new Error(`Could not load time request:");
    expect(src).toContain("if (error) throw new Error(`Could not load time requests:");
  });
});
