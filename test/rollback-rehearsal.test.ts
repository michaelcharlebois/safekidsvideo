// Coordinated rollback rehearsal (PGlite): migrate 0001 → 0023, make the kinds of permission changes parents
// make after release, then roll back 0023 → 0018 in order — as the production rollback would, with writes
// paused. The previous build only reads family-wide permissions, so the rollback must never widen what any
// child can watch compared with the moment it ran, and must report what it couldn't carry back.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate, rollbackSql, sql } from "./db-helpers";

const U1 = "00000000-0000-0000-0000-0000000000c1", U2 = "00000000-0000-0000-0000-0000000000c2";
const F = "cccccccc-0000-0000-0000-000000000001";   // two children
const F1 = "cccccccc-0000-0000-0000-000000000002";  // one child
const MAYA = "cccccccc-0000-0000-0000-0000000000a1", LEO = "cccccccc-0000-0000-0000-0000000000a2", SOLO = "cccccccc-0000-0000-0000-0000000000a3";
const V = (n: number) => `vid0000000${n}`;

describe("coordinated rollback 0023 → 0018 (PGlite)", () => {
  let db: PGlite;
  const rows = async (q: string) => (await db.query<Record<string, unknown>>(q)).rows;
  const wl = async (fam: string) => (await rows(`select kind, target_id from whitelist where family_id = '${fam}' order by kind, target_id`)).map((r) => `${r.kind}:${r.target_id}`);

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0017");
    await db.exec(`
      insert into auth.users (id) values ('${U1}'), ('${U2}');
      insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U1}', 'x'), ('${F1}', '${U2}', 'x');
      delete from profiles;
      insert into profiles (id, family_id, name, age, sort) values ('${MAYA}', '${F}', 'Maya', 6, 0), ('${LEO}', '${F}', 'Leo', 4, 1), ('${SOLO}', '${F1}', 'Solo', 6, 0);
      insert into videos (id, title) select 'vid0000000' || g, 't' from generate_series(1, 9) g;
      -- before release: family-wide permissions only
      insert into whitelist (family_id, kind, target_id) values
        ('${F}', 'channel', 'UCkeep'), ('${F}', 'channel', 'UCgone'),
        ('${F}', 'override', '${V(1)}'),   -- Maya asked: attributed to Maya by 0018
        ('${F}', 'override', '${V(2)}'),   -- no child recorded: held in legacy_grants
        ('${F}', 'override', '${V(3)}'),   -- held, and the parent will dismiss it
        ('${F}', 'block', '${V(4)}'),
        ('${F1}', 'override', '${V(5)}');  -- one-child family: attributed to Solo
      insert into watch_requests (family_id, video_id, status, profile_id) values ('${F}', '${V(1)}', 'approved', '${MAYA}'), ('${F}', '${V(2)}', 'approved', null), ('${F}', '${V(3)}', 'approved', null);
    `);
    for (const m of ["0018_child_scope", "0019_pin_attempts", "0020_watch_sessions", "0021_child_requests", "0022_time_requests", "0023_bedtime_extensions"]) await db.exec(sql(`${m}.sql`));

    // After release, parents and children use the new permissions:
    await db.exec(`
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'block', '${V(6)}', '${LEO}');      -- Never for Leo
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'dismissed', '${V(7)}', '${MAYA}');  -- Keep hidden for Maya
      delete from whitelist where family_id = '${F}' and kind = 'channel' and target_id = 'UCgone';                      -- channel removed
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'override', '${V(8)}', '${MAYA}');    -- new allow for Maya
      update legacy_grants set resolved_at = now(), resolution = 'dismissed' where family_id = '${F}' and target_id = '${V(3)}';
      insert into watch_requests (family_id, video_id, status, profile_id, created_at) values ('${F}', '${V(9)}', 'pending', '${MAYA}', now() - interval '5 minutes');
      insert into watch_requests (family_id, video_id, status, profile_id, created_at) values ('${F}', '${V(9)}', 'pending', '${LEO}', now()); -- both children asked; Maya first
      insert into time_requests (family_id, profile_id, kind, day) values ('${F}', '${MAYA}', 'bedtime', '2026-10-13');
      insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at) values ('${F}', '${MAYA}', '2026-10-13', '19:30', 30, '2026-10-14T03:00:00Z');
    `);
    for (const m of ["0023_bedtime_extensions", "0022_time_requests", "0021_child_requests", "0020_watch_sessions", "0019_pin_attempts", "0018_child_scope"]) await db.exec(rollbackSql(`${m}.down.sql`));
  });

  it("pre-release permissions come back family-wide where nothing was taken away", async () => {
    const f = await wl(F);
    expect(f).toContain("channel:UCkeep");
    expect(f).toContain(`override:${V(1)}`); // Maya's old approval
    expect(f).toContain(`override:${V(2)}`); // still held (undecided) → as before
    expect(f).toContain(`block:${V(4)}`);
    expect(await wl(F1)).toEqual([`override:${V(5)}`]);
  });

  it("never widens: a removed channel and a dismissed old approval stay gone", async () => {
    const f = await wl(F);
    expect(f).not.toContain("channel:UCgone");
    expect(f).not.toContain(`override:${V(3)}`);
  });

  it("restrictions made after release return family-wide (stricter, never looser)", async () => {
    const f = await wl(F);
    expect(f).toContain(`block:${V(6)}`);
    expect(f).toContain(`dismissed:${V(7)}`);
  });

  it("allows made after release are dropped (they were for one child) and reported for the parent to redo", async () => {
    expect(await wl(F)).not.toContain(`override:${V(8)}`);
    const report = await rows(`select kind, target_id, profile_id, note from rollback_0018_report order by target_id`);
    expect(report).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "override", target_id: V(8), profile_id: MAYA }),
      expect.objectContaining({ kind: "channel", target_id: "UCgone" }),
      expect.objectContaining({ kind: "override", target_id: V(3) }),
    ]));
  });

  it("duplicate pending requests (one per child) merge to one per family, the rest reported", async () => {
    expect((await rows(`select profile_id from watch_requests where video_id = '${V(9)}' and status = 'pending'`))).toEqual([{ profile_id: MAYA }]);
    expect((await rows(`select profile_id from rollback_0021_report`))).toEqual([{ profile_id: LEO }]);
  });

  it("the schema is back to its pre-0018 shape", async () => {
    for (const t of ["legacy_grants", "time_requests", "bedtime_extensions", "whitelist_pre_0018"]) expect((await rows(`select to_regclass('${t}') r`))[0].r).toBeNull();
    expect(await rows(`select 1 from information_schema.columns where table_name = 'whitelist' and column_name = 'profile_id'`)).toHaveLength(0);
    expect(await rows(`select 1 from information_schema.columns where table_name = 'watch_events' and column_name in ('session_id', 'watched_sec')`)).toHaveLength(0);
  });
});
