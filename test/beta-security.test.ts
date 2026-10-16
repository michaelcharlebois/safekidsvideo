import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("beta privacy and notification invariants", () => {
  it("removes anonymous access to raw parent feedback in migration 0024", () => {
    const sql = source("supabase/migrations/0024_feedback_privacy.sql");
    expect(sql).toContain('drop policy if exists "public read confirmations"');
    expect(sql).toContain('create policy "own confirmations read"');
    expect(sql).toMatch(/owner_user_id\s*=\s*auth\.uid\(\)/);
  });

  it("notification removal is restricted by family", () => {
    const push = source("src/lib/push.ts");
    expect(push).toMatch(/removeSubscription\(familyId: string, endpoint: string\)/);
    expect(push).toMatch(/delete\(\)\.eq\("endpoint", endpoint\)\.eq\("family_id", familyId\)/);
    expect(source("src/app/actions.ts")).toContain("await removeSubscription(fid, endpoint)");
  });

  it("notification subscriptions cannot be reassigned on an endpoint conflict", () => {
    const push = source("src/lib/push.ts");
    expect(push).not.toMatch(/from\("push_subscriptions"\)\.upsert\(/);
    expect(push).toContain("existing.family_id !== familyId");
    expect(push).toContain('.eq("endpoint", sub.endpoint).eq("family_id", familyId)');
  });
});
