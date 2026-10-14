// Production-sized rehearsal of migrations 0018 → 0023 on a real Postgres server (scripts/staging-db-check.sh
// --scale). Generates a large pre-0018 database in SQL — BF_SCALE_FAMILIES families (default 2,000) with 1–3
// children, ~23 permission rows and ~100 viewing rows per child, requests, checks and devices — then applies
// each migration in order, timing it, checks that nothing is lost, and rolls everything back to an identical
// whitelist. Skipped unless PG_TEST_URL and BF_SCALE are set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { migrate, rollbackSql, sql } from "./db-helpers";

const PG_URL = process.env.PG_TEST_URL;
const N = Number(process.env.BF_SCALE_FAMILIES ?? 2000);
const MIGRATIONS = ["0018_child_scope", "0019_pin_attempts", "0020_watch_sessions", "0021_child_requests", "0022_time_requests", "0023_bedtime_extensions"];

describe.skipIf(!PG_URL || !process.env.BF_SCALE)(`migrations 0018–0023 at scale (${N} families)`, () => {
  const name = `bf_scale_${Date.now()}`;
  let admin: pg.Client, db: pg.Client;
  const timings: Record<string, number> = {};
  const count = async (q: string) => Number((await db.query(q)).rows[0].n);
  const wlHash = () => db.query(`select md5(string_agg(family_id || kind || target_id || created_at::text, ',' order by family_id, kind, target_id)) h, count(*)::int n from whitelist`).then((r) => r.rows[0]);
  let before: { h: string; n: number }, events0 = 0, overrides0 = 0;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(PG_URL!); url.pathname = `/${name}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await migrate((q) => db.query(q), "0017");
    const id = (p: string, expr: string) => `('${p}' || lpad(to_hex(${expr}), 6, '0') || '-0000-4000-8000-000000000000')::uuid`;
    await db.query(`
      delete from profiles;
      insert into auth.users (id) select ${id("ee", "g")} from generate_series(1, ${N}) g;
      insert into families (id, owner_user_id, pin_hash, kid_age) select ${id("fa", "g")}, ${id("ee", "g")}, 'x', 4 + g % 5 from generate_series(1, ${N}) g;
      -- 1–3 children per family (45% one child)
      insert into profiles (id, family_id, name, age, sort)
        select ${id("cd", "g * 4 + k")}, ${id("fa", "g")}, 'Kid' || k, 5, k
        from generate_series(1, ${N}) g, generate_series(0, 2) k
        where k < case when g % 20 < 9 then 1 when g % 20 < 15 then 2 else 3 end;
      insert into devices (family_id, token_hash, name) select id, 'tok-' || id, 'TV' from families;
      insert into channels (id, title, created_at) select 'UCchan' || c, 'c' || c, now() from generate_series(0, 49) c;
      insert into videos (id, channel_id, title, created_at) select 'v' || lpad(v::text, 10, '0'), 'UCchan' || (v % 50), 't', now() from generate_series(0, 19999) v;
      insert into whitelist (family_id, kind, target_id)
        select f.id, 'channel', 'UCchan' || c from families f, generate_series(0, 2) c on conflict do nothing;
      insert into whitelist (family_id, kind, target_id)
        select f.id, (array['override','auto','block','dismissed','video'])[1 + (i % 5)], 'v' || lpad(((abs(hashtext(f.id::text)) + i * 37) % 20000)::text, 10, '0')
        from families f, generate_series(0, 19) i on conflict do nothing;
      -- request and check history (some without a child, as before profiles existed)
      insert into watch_requests (family_id, video_id, status, profile_id)
        select w.family_id, w.target_id, (array['approved','denied','approved'])[1 + (abs(hashtext(w.target_id)) % 3)],
               case when abs(hashtext(w.target_id)) % 7 = 0 then null else (select p.id from profiles p where p.family_id = w.family_id order by p.sort limit 1) end
        from whitelist w where w.kind in ('override','auto');
      insert into kid_checks (family_id, video_id, outcome, profile_id)
        select w.family_id, w.target_id, 'passed', (select p.id from profiles p where p.family_id = w.family_id order by p.sort desc limit 1)
        from whitelist w where w.kind = 'auto';
      -- ~100 viewing rows per child over 30 days (the old player's shape: start, completion row, end row)
      insert into watch_events (family_id, video_id, profile_id, completed, outcome, ended_at_sec, started_at)
        select p.family_id, 'v' || lpad(((abs(hashtext(p.id::text)) + i) % 20000)::text, 10, '0'), p.id,
               i % 3 <> 0, case i % 3 when 2 then 'finished' else null end, case i % 3 when 2 then 180 else null end,
               now() - ((i / 3) * interval '7 hours')
        from profiles p, generate_series(0, 99) i;
      analyze;
    `);
    before = await wlHash();
    events0 = await count("select count(*) n from watch_events");
    overrides0 = await count("select count(*) n from whitelist where kind in ('override','auto')");
    for (const m of MIGRATIONS) {
      const t = Date.now();
      if (process.env.BF_SCALE_PROFILE && m === "0018_child_scope") {
        // Statement by statement (0018 has no $$ blocks), to find what's slow.
        const stmts = sql(`${m}.sql`).replace(/--[^\n]*/g, "").split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
        const each: [number, string][] = [];
        for (const st of stmts) { const t1 = Date.now(); await db.query(st); each.push([Date.now() - t1, st.replace(/\s+/g, " ").slice(0, 90)]); }
        console.log("0018 slowest statements:\n" + each.sort((x, y) => y[0] - x[0]).slice(0, 6).map(([ms, st]) => `  ${ms} ms  ${st}`).join("\n"));
      } else await db.query(sql(`${m}.sql`));
      timings[m] = Date.now() - t;
    }
  }, 30 * 60_000);

  afterAll(async () => {
    console.log(`scale rehearsal (${N} families): ${JSON.stringify(timings)} ms`);
    await db?.end();
    await admin?.query(`drop database if exists ${name}`);
    await admin?.end();
  });

  it("is production-sized", async () => {
    expect(await count("select count(*) n from profiles")).toBeGreaterThan(N * 1.5);
    expect(events0).toBeGreaterThan(N * 150);
    expect(before.n).toBeGreaterThan(N * 20);
  });

  it("each migration finishes in reasonable time (reported)", () => {
    for (const m of MIGRATIONS) expect(timings[m]).toBeLessThan(10 * 60_000);
  });

  it("no viewing row is lost or rewritten; old permissions are attributed or held, never dropped", async () => {
    expect(await count("select count(*) n from watch_events")).toBe(events0);
    expect(await count("select count(*) n from watch_events where session_id is not null or watched_sec is not null")).toBe(0);
    const attributed = await count("select count(*) n from whitelist where kind in ('override','auto')");
    const held = await count("select count(*) n from legacy_grants");
    expect(attributed + held).toBe(overrides0);
  });

  it("the new constraints hold on the migrated data and accept new rows", async () => {
    const f = (await db.query("select f.id, p.id pid from families f join profiles p on p.family_id = f.id limit 1")).rows[0];
    await db.query(`insert into time_requests (family_id, profile_id, day) values ($1, $2, current_date)`, [f.id, f.pid]);
    await expect(db.query(`insert into time_requests (family_id, profile_id, day) values ($1, $2, current_date)`, [f.id, f.pid])).rejects.toThrow(/duplicate|unique/i);
    await db.query(`insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at) values ($1, $2, current_date, '19:30', 30, current_date + interval '20 hours')`, [f.id, f.pid]);
    const s = "aaaaaaaa-0000-4000-8000-000000000001";
    await db.query(`insert into watch_events (family_id, video_id, profile_id, completed, session_id) values ($1, 'v0000000001', $2, false, $3)`, [f.id, f.pid, s]);
    await expect(db.query(`insert into watch_events (family_id, video_id, profile_id, completed, session_id) values ($1, 'v0000000001', $2, false, $3)`, [f.id, f.pid, s])).rejects.toThrow(/duplicate|unique/i);
  });

  it("rolls back 0023 → 0018 to the exact pre-migration whitelist", async () => {
    await db.query("delete from watch_events where session_id is not null");
    for (const m of [...MIGRATIONS].reverse()) await db.query(rollbackSql(`${m}.down.sql`));
    expect(await wlHash()).toEqual(before);
    expect(await count("select count(*) n from watch_events")).toBe(events0);
    expect((await db.query("select to_regclass('time_requests') r")).rows[0].r).toBeNull();
    expect((await db.query("select to_regclass('bedtime_extensions') r")).rows[0].r).toBeNull();
  });
});
