import { describe, expect, it } from "vitest";
import { authorizedCronRequest } from "../src/lib/cron-auth";
import { isLocalPath } from "../src/lib/paths";

describe("cron authentication", () => {
  it("refuses an unset secret, including a missing header", () => {
    expect(authorizedCronRequest(null, undefined)).toBe(false);
    expect(authorizedCronRequest(null, "")).toBe(false);
    expect(authorizedCronRequest("Bearer anything", undefined)).toBe(false);
  });
  it("requires an exact bearer token", () => {
    expect(authorizedCronRequest("Bearer secure-test-secret", "secure-test-secret")).toBe(true);
    expect(authorizedCronRequest("Bearer wrong", "secure-test-secret")).toBe(false);
    expect(authorizedCronRequest(null, "secure-test-secret")).toBe(false);
  });
});

describe("auth return path validation", () => {
  it("accepts internal paths", () => expect(isLocalPath("/parent?kid=sample")).toBe(true));
  it.each(["//attacker.test", "/\\attacker.test", "/x\\attacker.test", "/x\nattack", "https://attacker.test", ""])
    ("rejects unsafe path %j", (path) => expect(isLocalPath(path)).toBe(false));
});
