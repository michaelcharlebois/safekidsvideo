#!/usr/bin/env node
// Checks that a STAGING environment can't reach production: its Supabase project, keys, push, billing and
// jobs. Run it on your own computer with the same values you put in the Vercel staging project:
//
//   PROD_SUPABASE_URL=https://<prod-ref>.supabase.co \
//   PROD_VAPID_PUBLIC_KEY=<production's public VAPID key> \
//   STAGING_EMAIL_PATTERN='\+bfstaging@' \
//   node scripts/staging/isolation-check.mjs .env.staging
//
// PROD_SUPABASE_URL and PROD_VAPID_PUBLIC_KEY are public values (they ship to every browser). The script
// never needs or reads a production secret. It prints check names and PASS/FAIL only, never a value.
// Network: it calls the staging project, and production's URL only to confirm the staging keys are refused.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/staging/isolation-check.mjs <staging env file>"); process.exit(2); }
const env = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /^\s*[A-Z0-9_]+\s*=/.test(l)).map((l) => {
  const i = l.indexOf("="); let v = l.slice(i + 1).trim();
  if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
  return [l.slice(0, i).trim(), v];
}));
const PROD_URL = (process.env.PROD_SUPABASE_URL || "").replace(/\/$/, "");
const PROD_VAPID = process.env.PROD_VAPID_PUBLIC_KEY || "";
const EMAILS = new RegExp(process.env.STAGING_EMAIL_PATTERN || "\\+bfstaging@", "i");
if (!PROD_URL || !PROD_VAPID) { console.error("Set PROD_SUPABASE_URL and PROD_VAPID_PUBLIC_KEY (both public values)."); process.exit(2); }

let failed = 0;
const check = (name, ok, why = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && why ? "  — " + why : ""}`); };
const ref = (u) => { try { return new URL(u).hostname.split(".")[0]; } catch { return ""; } };

// ---- configuration (no network) ----
const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
check("Supabase URL is set and is a supabase.co project", /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url));
check("Supabase URL is not production's", url && ref(url) !== ref(PROD_URL));
check("server key and browser key are set", !!secret && !!publishable);
check("Stripe: no live keys (blank, or test mode)", !env.STRIPE_SECRET_KEY || /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY), "a live Stripe key would bill real cards");
check("Stripe: no live price or webhook without a test key", (!env.STRIPE_PRICE_ID && !env.STRIPE_WEBHOOK_SECRET) || /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || ""));
check("push: staging has its own VAPID key pair", !!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY !== PROD_VAPID, "production's keys would let staging push to real parents' phones");
check("jobs: CRON_SECRET is set (≥ 32 characters), so the job URLs aren't open", (env.CRON_SECRET || "").length >= 32);
check("AI spend: DAILY_REVIEW_BUDGET_USD is set and ≤ 2", env.DAILY_REVIEW_BUDGET_USD !== undefined && env.DAILY_REVIEW_BUDGET_USD !== "" && Number(env.DAILY_REVIEW_BUDGET_USD) > 0 && Number(env.DAILY_REVIEW_BUDGET_USD) <= 2);
check("AI spend: DISCOVERY_BUDGET_USD is set and ≤ 0.5", env.DISCOVERY_BUDGET_USD !== undefined && env.DISCOVERY_BUDGET_USD !== "" && Number(env.DISCOVERY_BUDGET_USD) <= 0.5);
check("demo access is off (DEMO_KEY blank)", !env.DEMO_KEY);
check("test-only switches are off (BF_FAKE_NOW, SIFT_LOCAL_DB, BF_PERMISSION_WRITES_PAUSED unset)", !env.BF_FAKE_NOW && !env.SIFT_LOCAL_DB && !env.BF_PERMISSION_WRITES_PAUSED);

// ---- the staging project (network) ----
const headers = (key) => (key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` });
const count = async (path) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers(secret), Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
  return Number((r.headers.get("content-range") || "*/NaN").split("/")[1]);
};
try {
  if (url && secret) {
    check("the staging server key works against the staging project", Number.isFinite(await count("families?select=id")));
    const users = [];
    for (let page = 1; page < 50; page++) {
      const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: headers(secret) });
      if (!r.ok) throw new Error(`auth admin HTTP ${r.status}`);
      const batch = (await r.json()).users || [];
      users.push(...batch);
      if (batch.length < 200) break;
    }
    const strangers = users.filter((u) => !EMAILS.test(u.email || ""));
    check(`synthetic data only: every sign-in (${users.length}) is a staging test address`, users.length > 0 && strangers.length === 0, `${strangers.length} account(s) don't match STAGING_EMAIL_PATTERN`);
    check("no push subscriptions yet (run this before testing push)", (await count("push_subscriptions?select=id")) === 0, "expected 0 before you test push; afterwards, only your own test phone");
    check("no billing customers", (await count("families?select=id&stripe_customer_id=not.is.null")) === 0);
    const tables = await Promise.all(["time_requests", "bedtime_extensions", "legacy_grants"].map((t) => fetch(`${url}/rest/v1/${t}?select=*&limit=0`, { headers: headers(secret) }).then((r) => r.ok)));
    console.log(`info  migrations 0018–0023 ${tables.every(Boolean) ? "appear applied" : "not (all) applied yet"}`);
  }
  // The staging keys must be refused by production.
  for (const [name, key] of [["server key", secret], ["browser key", publishable]]) {
    if (!key) continue;
    const r = await fetch(`${PROD_URL}/rest/v1/families?select=id&limit=1`, { headers: headers(key) });
    check(`the staging ${name} is refused by production`, r.status === 401 || r.status === 403, `production answered HTTP ${r.status}`);
  }
} catch (e) {
  check("network checks ran", false, String(e.message || e));
}

console.log(failed ? `\n${failed} check(s) failed — fix before testing on staging.` : "\nAll isolation checks passed.");
process.exit(failed ? 1 : 0);
