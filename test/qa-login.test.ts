import { describe, expect, it } from "vitest";
import { QA_FAMILIES, qaFamilyFor, qaLoginEnabled } from "../src/lib/qa-login";

const valid: NodeJS.ProcessEnv = {
  BF_QA_LOGIN_ENABLED: "1",
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feature/brightframe",
  NEXT_PUBLIC_SUPABASE_URL: "https://ucjleowgjelwzpjkczim.supabase.co",
  VERCEL_URL: "brightframe-staging-4ax82u92l-michael-charlebois-projects.vercel.app",
};

describe("QA login safety guard", () => {
  it("requires all staging guards", () => {
    expect(qaLoginEnabled(valid)).toBe(true);
    for (const key of Object.keys(valid)) {
      expect(qaLoginEnabled({ ...valid, [key]: undefined })).toBe(false);
    }
    expect(qaLoginEnabled({ ...valid, VERCEL_ENV: "production" })).toBe(false);
    expect(qaLoginEnabled({ ...valid, VERCEL_GIT_COMMIT_REF: "main" })).toBe(false);
  });
  it("accepts exactly the seeded families", () => {
    expect(QA_FAMILIES).toHaveLength(3);
    expect(qaFamilyFor("solo")?.label).toBe("Solo");
    expect(qaFamilyFor("unknown")).toBeUndefined();
    expect(qaFamilyFor(null)).toBeUndefined();
  });
});
