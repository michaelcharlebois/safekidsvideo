// Coordinated rollback rehearsal (PGlite): migrate 0001 → 0023, make the permission changes parents make
// after release, then roll back 0023 → 0018 in order — as the production rollback would, with writes
// paused. The previous build reads only family-wide permissions (a row applies to every child), so the
// invariant is about EFFECTIVE permissions: after the rollback, no child may watch anything they couldn't
// watch immediately before it. This test evaluates every child × every video before and after.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate, rollbackSql, sql } from "./db-helpers";

const U1 = "00000000-0000-0000-0000-0000000000c1", U2 = "00000000-0000-0000-0000-0000000000c2";
const F = "cccccccc-0000-0000-0000-000000000001";   // two children
const F1 = "cccccccc-0000-0000-0000-000000000002";  // one child
const MAYA = "cccccccc-0000-0000-0000-0000000000a1", LEO = "cccccccc-0000-0000-0000-0000000000a2", SOLO = "cccccccc-0000-0000-0000-0000000000a3";
const V = (n: number) => `vid00000${String(n).padStart(3, "0")}`;
// video → channel (the rest belong to no approved channel)
const CHANNEL_OF: Record<string, string> = { [V(6)]: "UCkeep", [V(9)]: "UCkeep", [V(13)]: "UCgone", [V(14)]: "UCgone" };
const VIDEOS = Array.from({ length: 14 }, (_, i) => V(i + 1));
const CHILDREN: Record<string, string[]> = { [F]: [MAYA, LEO], [F1]: [SOLO] };

type Row = { family_id: string; kind: string; target_id: string; profile_id: string | null };
/** What a child may watch, by the app's gate order (block → override → keep-hidden → library / clearance). Reviews are the same before and after, so they're left out. */
function allowed(rows: Row[], family: string, child: string, video: string, familyWideOnly: boolean): boolean {
  const mine = rows.filter((r) => r.family_id === family && (r.profile_id == null || (!familyWideOnly && r.profile_id === child)));
  const has = (kind: string, target: string) => mine.some((r) => r.kind === kind && r.target_id === target);
  if (has("block", video)) return false;
  if (has("override", video)) return true;
  if (has("dismissed", video)) return false;
  return has("video", video) || (CHANNEL_OF[video] != null && has("channel", CHANNEL_OF[video])) || has("auto", video);
}
const effective = (rows: Row[], familyWideOnly: boolean) =>
  Object.entries(CHILDREN).flatMap(([fam, kids]) => kids.flatMap((kid) => VIDEOS.filter((v) => allowed(rows, fam, kid, v, familyWideOnly)).map((v) => `${kid}:${v}`)));

describe("coordinated rollback 0023 → 0018 (PGlite): effective permissions never widen", () => {
  let db: PGlite;
  let before: string[], after: string[];
  const rows = async (q: string) => (await db.query<Record<string, unknown>>(q)).rows;

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0017");
    await db.exec(`
      insert into auth.users (id) values ('${U1}'), ('${U2}');
      insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U1}', 'x'), ('${F1}', '${U2}', 'x');
      delete from profiles;
      insert into profiles (id, family_id, name, age, sort) values ('${MAYA}', '${F}', 'Maya', 6, 0), ('${LEO}', '${F}', 'Leo', 4, 1), ('${SOLO}', '${F1}', 'Solo', 6, 0);
      insert into videos (id, title) select 'vid00000' || lpad(g::text, 3, '0'), 't' from generate_series(1, 14) g;
      -- Before release: family-wide permissions only.
      insert into whitelist (family_id, kind, target_id) values
        ('${F}', 'channel', 'UCkeep'), ('${F}', 'channel', 'UCgone'),
        ('${F}', 'override', '${V(1)}'),   -- Maya asked: 0018 attributes it to Maya only
        ('${F}', 'override', '${V(2)}'),   -- no child recorded: held, granting nobody
        ('${F}', 'override', '${V(3)}'),   -- held; the parent dismisses it after release
        ('${F}', 'block', '${V(4)}'),      -- family-wide restriction
        ('${F}', 'dismissed', '${V(9)}'),  -- family-wide Keep hidden
        ('${F1}', 'override', '${V(5)}');  -- one-child family: attributed to Solo
      insert into watch_requests (family_id, video_id, status, profile_id) values
        ('${F}', '${V(1)}', 'approved', '${MAYA}'), ('${F}', '${V(2)}', 'approved', null), ('${F}', '${V(3)}', 'approved', null);
    `);
    for (const m of ["0018_child_scope", "0019_pin_attempts", "0020_watch_sessions", "0021_child_requests", "0022_time_requests", "0023_bedtime_extensions"]) await db.exec(sql(`${m}.sql`));

    // After release, parents use per-child permissions:
    await db.exec(`
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'block', '${V(6)}', '${LEO}');       -- Never for Leo (V6 is in UCkeep)
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'dismissed', '${V(7)}', '${MAYA}');   -- Keep hidden for Maya
      delete from whitelist where family_id = '${F}' and kind = 'channel' and target_id = 'UCgone';                       -- a channel removed
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'override', '${V(8)}', '${MAYA}');     -- a new allow for Maya
      update legacy_grants set resolved_at = now(), resolution = 'dismissed' where family_id = '${F}' and target_id = '${V(3)}';
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'override', '${V(11)}', '${MAYA}'), ('${F}', 'override', '${V(11)}', '${LEO}');
      delete from whitelist where family_id = '${F}' and target_id = '${V(11)}' and profile_id = '${LEO}';                 -- then removed from one child
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'override', '${V(12)}', '${MAYA}'), ('${F}', 'override', '${V(12)}', '${LEO}'); -- allowed for both
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F}', 'video', '${V(10)}', '${LEO}');        -- a video added to Leo's library only
      insert into whitelist (family_id, kind, target_id, profile_id) values ('${F1}', 'override', '${V(13)}', '${SOLO}');   -- one-child family: a new allow
      insert into watch_requests (family_id, video_id, status, profile_id, created_at) values ('${F}', '${V(14)}', 'pending', '${MAYA}', now() - interval '5 minutes');
      insert into watch_requests (family_id, video_id, status, profile_id, created_at) values ('${F}', '${V(14)}', 'pending', '${LEO}', now());
      insert into time_requests (family_id, profile_id, kind, day) values ('${F}', '${MAYA}', 'bedtime', '2026-10-13');
      insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at) values ('${F}', '${MAYA}', '2026-10-13', '19:30', 30, '2026-10-14T03:00:00Z');
    `);
    before = effective((await rows(`select family_id, kind, target_id, profile_id from whitelist`)) as Row[], false);
    for (const m of ["0023_bedtime_extensions", "0022_time_requests", "0021_child_requests", "0020_watch_sessions", "0019_pin_attempts", "0018_child_scope"]) await db.exec(rollbackSql(`${m}.down.sql`));
    after = effective((await rows(`select family_id, kind, target_id, null::uuid as profile_id from whitelist`)) as Row[], true);
  });

  it("THE INVARIANT: every child × video allowed after the rollback was allowed immediately before it", () => {
    expect(after.filter((x) => !before.includes(x))).toEqual([]);
    expect(before.length).toBeGreaterThan(after.length); // some per-child allows had to be dropped
  });

  it("an old approval attributed only to Maya doesn't become Leo's too (it's dropped, and reported)", () => {
    expect(after).not.toContain(`${LEO}:${V(1)}`);
    expect(after).not.toContain(`${MAYA}:${V(1)}`);
  });

  it("a held historical approval granting nobody stays granting nobody; one dismissed after release too", () => {
    for (const kid of [MAYA, LEO]) { expect(after).not.toContain(`${kid}:${V(2)}`); expect(after).not.toContain(`${kid}:${V(3)}`); }
  });

  it("an approval removed from one child isn't restored for anyone; one both children still have is", () => {
    for (const kid of [MAYA, LEO]) expect(after).not.toContain(`${kid}:${V(11)}`);
    for (const kid of [MAYA, LEO]) expect(after).toContain(`${kid}:${V(12)}`);
  });

  it("one-child family: the child's approvals (old and new) carry back exactly", () => {
    expect(after).toContain(`${SOLO}:${V(5)}`);
    expect(after).toContain(`${SOLO}:${V(13)}`);
    expect(before.filter((x) => x.startsWith(SOLO)).sort()).toEqual(after.filter((x) => x.startsWith(SOLO)).sort());
  });

  it("restrictions stay restrictive: family-wide ones, and per-child ones made family-wide", () => {
    for (const kid of [MAYA, LEO]) {
      expect(after).not.toContain(`${kid}:${V(4)}`); // family-wide block
      expect(after).not.toContain(`${kid}:${V(9)}`); // family-wide Keep hidden (V9 is in UCkeep)
      expect(after).not.toContain(`${kid}:${V(6)}`); // Never for Leo → for everyone
    }
  });

  it("removed sources stay removed; a per-child library video isn't widened", () => {
    for (const kid of [MAYA, LEO]) { expect(after).not.toContain(`${kid}:${V(13)}`); expect(after).not.toContain(`${kid}:${V(10)}`); }
  });

  it("everything dropped is reported for a parent to restore by hand", async () => {
    const report = (await rows(`select target_id, profile_id from rollback_0018_report`)).map((r) => `${r.target_id}:${r.profile_id ?? "-"}`);
    for (const x of [`${V(1)}:${MAYA}`, `${V(8)}:${MAYA}`, `${V(11)}:${MAYA}`, `${V(10)}:${LEO}`, `${V(2)}:-`]) expect(report).toContain(x);
  });

  it("duplicate pending requests (one per child) merge to one per family, the rest reported", async () => {
    expect(await rows(`select profile_id from watch_requests where video_id = '${V(14)}' and status = 'pending'`)).toEqual([{ profile_id: MAYA }]);
    expect(await rows(`select profile_id from rollback_0021_report`)).toEqual([{ profile_id: LEO }]);
  });

  it("the schema is back to its pre-0018 shape", async () => {
    for (const t of ["legacy_grants", "time_requests", "bedtime_extensions", "whitelist_pre_0018"]) expect((await rows(`select to_regclass('${t}') r`))[0].r).toBeNull();
    expect(await rows(`select 1 from information_schema.columns where table_name = 'whitelist' and column_name = 'profile_id'`)).toHaveLength(0);
  });
});
