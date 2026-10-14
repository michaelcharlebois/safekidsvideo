// Staging rehearsal of 0018 + 0019 on a real Postgres server (needs PG_TEST_URL; run it with
// scripts/staging-db-check.sh). Builds a representative pre-0018 database — many families with 1–3
// kids, channels, added videos, old approvals, open-mode clearances, blocks, "keep hidden" rows,
// requests and checks with and without a child, devices — then applies the real migrations and checks
// every invariant against an independent re-computation of the attribution rule. Finally rolls back
// and compares the whitelist to the snapshot.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate, rollbackSql, sql } from "./db-helpers";

const PG_URL = process.env.PG_TEST_URL;

// Deterministic pseudo-random data.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const uuid = (prefix: string, n: number) => `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const vid = (n: number) => `v${n.toString(36).padStart(10, "0")}`;

type Fam = { id: string; user: string; kids: string[]; kidAge: number };
type Grant = { fam: string; kind: string; target: string };
type Ev = { fam: string; video: string; profile: string | null; status: string };

function generate(families = 60) {
  const r = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const fams: Fam[] = [];
  const grants: Grant[] = [];
  const requests: Ev[] = [];
  const checks: Ev[] = [];
  let k = 0;
  for (let f = 0; f < families; f++) {
    const nKids = r() < 0.45 ? 1 : r() < 0.7 ? 2 : 3;
    const fam: Fam = { id: uuid("fa", f), user: uuid("ee", f), kids: [], kidAge: 4 + Math.floor(r() * 5) };
    for (let i = 0; i < nKids; i++) fam.kids.push(uuid("cd", k++));
    fams.push(fam);
    grants.push({ fam: fam.id, kind: "channel", target: "UCchan0" }, { fam: fam.id, kind: "channel", target: `UCchan${1 + (f % 3)}` });
    for (let i = 0; i < 25; i++) {
      const v = vid(f * 100 + i);
      const roll = r();
      const kind = roll < 0.3 ? "override" : roll < 0.5 ? "auto" : roll < 0.6 ? "block" : roll < 0.7 ? "dismissed" : roll < 0.8 ? "video" : null;
      if (kind) grants.push({ fam: fam.id, kind, target: v });
      // request / check history, sometimes without a child (pre-profiles), sometimes from several kids
      const n = Math.floor(r() * 3);
      for (let j = 0; j < n; j++) {
        const who = r() < 0.15 ? null : pick(fam.kids);
        if (kind === "override" || r() < 0.2) requests.push({ fam: fam.id, video: v, profile: who, status: pick(["approved", "approved", "denied", "pending"]) });
        if (kind === "auto" || r() < 0.2) checks.push({ fam: fam.id, video: v, profile: who, status: pick(["passed", "passed", "blocked", "failed"]) });
      }
    }
  }
  return { fams, grants, requests, checks };
}

/** The attribution rule, re-implemented independently of the SQL. */
function expectedOwner(data: ReturnType<typeof generate>, g: Grant): string | null {
  const fam = data.fams.find((f) => f.id === g.fam)!;
  if (fam.kids.length === 1) return fam.kids[0];
  const src = g.kind === "override"
    ? data.requests.filter((e) => e.fam === g.fam && e.video === g.target && e.status === "approved")
    : data.checks.filter((e) => e.fam === g.fam && e.video === g.target && e.status === "passed");
  const who = new Set(src.map((e) => e.profile));
  if (src.length > 0 && who.size === 1 && !who.has(null)) return [...who][0];
  return null;
}

const lit = (s: string | null) => (s == null ? "null" : `'${s}'`);

describe.skipIf(!PG_URL)("staging rehearsal: 0018 + 0019 on representative data (real Postgres)", () => {
  const name = `bf_stage_${Date.now()}`;
  const data = generate();
  let admin: pg.Client;
  let db: pg.Client;
  let before: { family_id: string; kind: string; target_id: string; created_at: string }[];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(PG_URL!); url.pathname = `/${name}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await migrate((q) => db.query(q), "0017");

    const vids = new Set([...data.grants.filter((g) => !g.target.startsWith("UC")).map((g) => g.target), ...data.requests.map((e) => e.video), ...data.checks.map((e) => e.video)]);
    const stmts: string[] = [
      `insert into auth.users (id) values ${data.fams.map((f) => `(${lit(f.user)})`).join(",")};`,
      `insert into families (id, owner_user_id, pin_hash, kid_age) values ${data.fams.map((f) => `(${lit(f.id)}, ${lit(f.user)}, '1234', ${f.kidAge})`).join(",")};`,
      `delete from profiles;`,
      `insert into profiles (id, family_id, name, age, sort) values ${data.fams.flatMap((f) => f.kids.map((p, i) => `(${lit(p)}, ${lit(f.id)}, 'Kid${i}', ${i === 1 ? "null" : 5}, ${i})`)).join(",")};`,
      `insert into channels (id, title, created_at) values ('UCchan0','c0',now()),('UCchan1','c1',now()),('UCchan2','c2',now()),('UCchan3','c3',now());`,
      `insert into videos (id, channel_id, title, created_at) values ${[...vids].map((v) => `('${v}', 'UCchan0', 't', now())`).join(",")};`,
      `insert into whitelist (family_id, kind, target_id) values ${data.grants.map((g) => `(${lit(g.fam)}, '${g.kind}', '${g.target}')`).join(",")} on conflict do nothing;`,
      `insert into watch_requests (family_id, video_id, status, profile_id) select * from (values ${data.requests.map((e) => `(${lit(e.fam)}::uuid, '${e.video}', '${e.status}', ${lit(e.profile)}::uuid)`).join(",")}) v(f, vi, s, p) on conflict do nothing;`,
      `insert into kid_checks (family_id, video_id, outcome, profile_id) values ${data.checks.map((e) => `(${lit(e.fam)}, '${e.video}', '${e.status}', ${lit(e.profile)})`).join(",")};`,
      `insert into devices (family_id, token_hash, name) select id, 'tok-' || id, 'TV' from families;`,
    ];
    for (const s of stmts) await db.query(s);
    before = (await db.query("select family_id, kind, target_id, created_at::text from whitelist order by family_id, kind, target_id")).rows;

    // Requests that actually made it in (the pending-uniqueness index may have dropped duplicates).
    data.requests = (await db.query("select family_id as fam, video_id as video, profile_id as profile, status from watch_requests")).rows;
    await db.query(sql("0018_child_scope.sql"));
    await db.query(sql("0019_pin_attempts.sql"));
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`drop database if exists ${name}`);
    await admin?.end();
  });

  it("is a meaningful sample", () => {
    expect(data.fams.filter((f) => f.kids.length > 1).length).toBeGreaterThan(20);
    expect(before.filter((g) => g.kind === "override").length).toBeGreaterThan(200);
    expect(before.filter((g) => g.kind === "auto").length).toBeGreaterThan(100);
  });

  it("every old approval/clearance ends up attributed to exactly the expected child, or held — never both, never lost", async () => {
    const wl = (await db.query("select family_id, kind, target_id, profile_id from whitelist where kind in ('override','auto')")).rows;
    const held = (await db.query("select family_id, kind, target_id, candidate_profile_ids from legacy_grants")).rows;
    const old = before.filter((g) => g.kind === "override" || g.kind === "auto");
    expect(wl.length + held.length).toBe(old.length);
    let attributed = 0, ambiguous = 0;
    for (const g of old) {
      const want = expectedOwner(data, { fam: g.family_id, kind: g.kind, target: g.target_id });
      const inWl = wl.filter((w) => w.family_id === g.family_id && w.kind === g.kind && w.target_id === g.target_id);
      const inHeld = held.filter((h) => h.family_id === g.family_id && h.kind === g.kind && h.target_id === g.target_id);
      if (want) { attributed++; expect(inWl.map((w) => w.profile_id)).toEqual([want]); expect(inHeld).toEqual([]); }
      else {
        ambiguous++;
        expect(inWl).toEqual([]);
        expect(inHeld).toHaveLength(1);
        const kids = data.fams.find((f) => f.id === g.family_id)!.kids;
        expect(inHeld[0].candidate_profile_ids.length).toBeGreaterThan(0);
        for (const c of inHeld[0].candidate_profile_ids) expect(kids).toContain(c);
      }
    }
    expect(attributed).toBeGreaterThan(50);
    expect(ambiguous).toBeGreaterThan(20);
  });

  it("channels, added videos, blocks and keep-hidden rows are untouched and stay family-wide", async () => {
    const after = (await db.query("select family_id, kind, target_id, created_at::text, profile_id from whitelist where kind in ('channel','video','block','dismissed') order by family_id, kind, target_id")).rows;
    expect(after.every((r) => r.profile_id === null)).toBe(true);
    expect(after.map((r) => ({ family_id: r.family_id, kind: r.kind, target_id: r.target_id, created_at: r.created_at }))).toEqual(before.filter((g) => !["override", "auto"].includes(g.kind)));
  });

  it("every child-specific row belongs to a child of the same family", async () => {
    const bad = await db.query(`
      select 'whitelist' t, count(*) n from whitelist w join profiles p on p.id = w.profile_id where p.family_id <> w.family_id
      union all select 'devices', count(*) from devices d join profiles p on p.id in (d.assigned_profile_id, d.active_profile_id) where p.family_id <> d.family_id`);
    expect(bad.rows.every((r) => Number(r.n) === 0)).toBe(true);
    expect((await db.query("select count(*)::int n from profiles where age is null")).rows[0].n).toBe(0);
  });

  it("the app's upsert works for family-wide and child rows alike", async () => {
    const f = data.fams.find((x) => x.kids.length > 1)!;
    const up = (p: string | null) => db.query(
      `insert into whitelist (family_id, kind, target_id, profile_id) values ($1, 'block', 'vUpsert0000', $2) on conflict (family_id, kind, target_id, profile_id) do nothing`, [f.id, p]);
    await up(null); await up(null); await up(f.kids[0]); await up(f.kids[0]); await up(f.kids[1]);
    expect((await db.query("select count(*)::int n from whitelist where target_id = 'vUpsert0000'")).rows[0].n).toBe(3);
  });

  it("the PIN functions work on the migrated devices", async () => {
    const dev = (await db.query("select id from devices limit 1")).rows[0].id;
    const res = [];
    for (let i = 0; i < 7; i++) res.push((await db.query("select * from claim_pin_attempt($1, 5)", [dev])).rows[0].allowed);
    expect(res).toEqual([true, true, true, true, true, false, false]);
  });

  it("rolls back (0019 then 0018) to the pre-migration whitelist, keeping restrictions added since", async () => {
    await db.query(rollbackSql("0019_pin_attempts.down.sql"));
    await db.query(rollbackSql("0018_child_scope.down.sql"));
    const after = (await db.query("select family_id, kind, target_id, created_at::text from whitelist order by family_id, kind, target_id")).rows;
    // Exactly the pre-migration whitelist, plus the one restriction added after migrating (the upsert test's
    // block, for one child and family-wide): a rollback carries restrictions back family-wide, never looser.
    const added = after.filter((r) => r.target_id === "vUpsert0000");
    expect(added.map((r) => r.kind)).toEqual(["block"]);
    expect(after.filter((r) => r.target_id !== "vUpsert0000")).toEqual(before);
    expect((await db.query("select to_regclass('legacy_grants') r")).rows[0].r).toBeNull();
  });
});
