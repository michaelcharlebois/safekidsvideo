/**
 * Temporary, opt-in QA authentication for three existing synthetic families.
 * This is deliberately unavailable outside the exact, protected staging Preview.
 * Remove the flag and redeploy before production release.
 */
export const QA_FAMILIES = [
  {
    id: "solo",
    label: "Solo",
    description: "One child",
    email: "michael.charlebois+bfstaging1@gmail.com",
    familyId: "5a000000-0000-4000-8000-000000000001",
  },
  {
    id: "maya-leo",
    label: "Maya & Leo",
    description: "Two children",
    email: "michael.charlebois+bfstaging2@gmail.com",
    familyId: "5a000000-0000-4000-8000-000000000002",
  },
  {
    id: "ava-ben-cy",
    label: "Ava, Ben & Cy",
    description: "Three children",
    email: "michael.charlebois+bfstaging3@gmail.com",
    familyId: "5a000000-0000-4000-8000-000000000003",
  },
] as const;

export function qaFamilyFor(value: FormDataEntryValue | null) {
  return typeof value === "string" ? QA_FAMILIES.find((f) => f.id === value) : undefined;
}

/** Independent checks mean a mis-scoped feature flag alone can never enable QA login elsewhere. */
export function qaLoginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BF_QA_LOGIN_ENABLED === "1"
    && env.VERCEL_ENV === "preview"
    && env.VERCEL_GIT_COMMIT_REF === "feature/brightframe"
    && env.NEXT_PUBLIC_SUPABASE_URL === "https://ucjleowgjelwzpjkczim.supabase.co"
    && /^brightframe-staging-[a-z0-9-]+-michael-charlebois-projects\.vercel\.app$/.test(env.VERCEL_URL ?? "");
}
