// Runs every real migration (0001 → 0018) in an in-memory Postgres (PGlite), seeds pre-0018 data,
// and checks the child-scoping backfill, the family-integrity constraints, the uniqueness/upsert
// behavior for family-wide vs child rows, and that the rollback restores the original whitelist.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIG = path.resolve(import.meta.dirname, "../supabase/migrations");
const ROLLBACK = path.resolve(import.meta.dirname, "../supabase/rollbacks/0018_child_scope.down.sql");
const files = readdirSync(MIG).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const before0018 = files.filter((f) => f < "0018");

const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
`;

// Families: A has two kids (ambiguity possible), B has one kid (always attributable).
const U1 = "00000000-0000-0000-0000-0000000000a1", U2 = "00000000-0000-0000-0000-0000000000b1";
const FA = "aaaaaaaa-0000-0000-0000-000000000001", FB = "bbbbbbbb-0000-0000-0000-000000000001";
const MAYA = "aaaaaaaa-0000-0000-0000-0000000000a1", LEO = "aaaaaaaa-0000-0000-0000-0000000000a2";
const SOLO = "bbbbbbbb-0000-0000-0000-0000000000b1";

async function freshDb() {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(SUPABASE_STUBS);
  for (const f of before0018) await pg.exec(readFileSync(path.join(MIG, f), "utf8"));
  // seed pre-0018 state
  await pg.exec(`
    insert into auth.users (id) values ('${U1}'), ('${U2}');
    insert into families (id, owner_user_id, pin_hash, kid_age) values ('${FA}', '${U1}', '1234', 7), ('${FB}', '${U2}', '1234', 5);
    delete from profiles;
    insert into profiles (id, family_id, name, age, sort) values ('${MAYA}', '${FA}', 'Maya', 6, 0), ('${LEO}', '${FA}', 'Leo', null, 1), ('${SOLO}', '${FB}', 'Solo', 5, 0);
    insert into channels (id, title, created_at) values ('UCx', 'x', now());
    insert into videos (id, channel_id, title, created_at) values
      ('vOverMaya00', 'UCx', 't', now()), ('vOverBoth00', 'UCx', 't', now()), ('vOverNone00', 'UCx', 't', now()),
      ('vAutoMaya00', 'UCx', 't', now()), ('vAutoNull00', 'UCx', 't', now()), ('vBlock00000', 'UCx', 't', now()),
      ('vSolo000000', 'UCx', 't', now());
    insert into whitelist (family_id, kind, target_id) values
      ('${FA}', 'channel', 'UCx'),
      ('${FA}', 'override', 'vOverMaya00'),   -- one approved request, from Maya → Maya
      ('${FA}', 'override', 'vOverBoth00'),   -- approved requests from Maya AND Leo → ambiguous
      ('${FA}', 'override', 'vOverNone00'),   -- no request at all (parent "allow" in old queue) → ambiguous
      ('${FA}', 'auto', 'vAutoMaya00'),       -- passing check by Maya → Maya
      ('${FA}', 'auto', 'vAutoNull00'),       -- passing check with no profile (pre-profiles) → ambiguous
      ('${FA}', 'block', 'vBlock00000'),      -- stays family-wide
      ('${FB}', 'override', 'vSolo000000');   -- one-child family → that child
    insert into watch_requests (family_id, video_id, status, profile_id) values
      ('${FA}', 'vOverMaya00', 'approved', '${MAYA}'),
      ('${FA}', 'vOverBoth00', 'approved', '${MAYA}'),
      ('${FA}', 'vOverBoth00', 'approved', '${LEO}');
    insert into kid_checks (family_id, video_id, outcome, profile_id) values
      ('${FA}', 'vAutoMaya00', 'passed', '${MAYA}'),
      ('${FA}', 'vAutoNull00', 'passed', null);
  `);
  return pg;
}

type Row = { kind: string; target_id: string; profile_id: string | null };
const rows = async (pg: PGlite, sql: string) => (await pg.query<Row>(sql)).rows;

describe("migration 0018 — child scope", () => {
  let pg: PGlite;
  let snapshotBefore: Row[];
  beforeAll(async () => {
    pg = await freshDb();
    snapshotBefore = await rows(pg, "select kind, target_id, null::uuid as profile_id from whitelist order by family_id, kind, target_id");
    await pg.exec(readFileSync(path.join(MIG, "0018_child_scope.sql"), "utf8"));
  });

  it("attributes only what is reliable", async () => {
    const got = await rows(pg, "select kind, target_id, profile_id from whitelist order by kind, target_id");
    expect(got).toEqual([
      { kind: "auto", target_id: "vAutoMaya00", profile_id: MAYA },
      { kind: "block", target_id: "vBlock00000", profile_id: null },
      { kind: "channel", target_id: "UCx", profile_id: null },
      { kind: "override", target_id: "vOverMaya00", profile_id: MAYA },
      { kind: "override", target_id: "vSolo000000", profile_id: SOLO },
    ]);
  });

  it("holds ambiguous approvals for review, with candidates, granting nothing", async () => {
    const held = (await pg.query<{ kind: string; target_id: string; candidate_profile_ids: string[] }>(
      "select kind, target_id, candidate_profile_ids from legacy_grants order by target_id")).rows;
    expect(held.map((h) => `${h.kind}:${h.target_id}`)).toEqual(["auto:vAutoNull00", "override:vOverBoth00", "override:vOverNone00"]);
    expect(held.find((h) => h.target_id === "vOverBoth00")!.candidate_profile_ids.sort()).toEqual([MAYA, LEO].sort());
    expect(held.find((h) => h.target_id === "vOverNone00")!.candidate_profile_ids).toEqual([MAYA, LEO]); // no signal → all kids, in order
    const leaked = await rows(pg, "select kind, target_id, profile_id from whitelist where target_id in ('vOverBoth00','vOverNone00','vAutoNull00')");
    expect(leaked).toEqual([]);
  });

  it("fills a missing child age from the family's legacy age", async () => {
    const { rows: r } = await pg.query<{ age: number }>(`select age from profiles where id = '${LEO}'`);
    expect(r[0].age).toBe(7);
  });

  it("refuses override/auto without a child", async () => {
    await expect(pg.exec(`insert into whitelist (family_id, kind, target_id) values ('${FA}', 'override', 'vX')`)).rejects.toThrow(/whitelist_child_kinds/);
  });

  it("refuses a child from another family", async () => {
    await expect(pg.exec(`insert into whitelist (family_id, kind, target_id, profile_id) values ('${FA}', 'override', 'vX', '${SOLO}')`)).rejects.toThrow(/whitelist_profile_family_fk/);
    await expect(pg.exec(`insert into watch_requests (family_id, video_id, profile_id) values ('${FA}', 'vSolo000000', '${SOLO}')`)).rejects.toThrow(/watch_requests_profile_family_fk/);
    await expect(pg.exec(`update devices set assigned_profile_id = '${SOLO}' where family_id = '${FA}'`)).resolves.toBeDefined(); // no rows, no error
    await pg.exec(`insert into devices (family_id, token_hash, name) values ('${FA}', 'h1', 'TV')`);
    await expect(pg.exec(`update devices set assigned_profile_id = '${SOLO}' where token_hash = 'h1'`)).rejects.toThrow(/devices_assigned_profile_fk/);
    await pg.exec(`update devices set active_profile_id = '${LEO}' where token_hash = 'h1'`);
  });

  it("dedupes family-wide rows (null child) and child rows independently", async () => {
    const ins = (p: string | null) =>
      pg.exec(`insert into whitelist (family_id, kind, target_id, profile_id) values ('${FA}', 'block', 'vDup', ${p ? `'${p}'` : "null"}) on conflict (family_id, kind, target_id, profile_id) do nothing`);
    await ins(null); await ins(null); await ins(MAYA); await ins(MAYA); await ins(LEO);
    const got = await rows(pg, "select kind, target_id, profile_id from whitelist where target_id = 'vDup' order by profile_id nulls first");
    expect(got.map((r) => r.profile_id)).toEqual([null, ...[MAYA, LEO].sort()]);
  });

  it("deleting a child removes their grants and unlinks their history, nothing else", async () => {
    await pg.exec(`insert into watch_events (family_id, video_id, profile_id) values ('${FA}', 'vOverMaya00', '${MAYA}')`);
    await pg.exec(`delete from profiles where id = '${MAYA}'`);
    expect(await rows(pg, `select kind, target_id, profile_id from whitelist where profile_id = '${MAYA}'`)).toEqual([]);
    const { rows: ev } = await pg.query<{ family_id: string; profile_id: string | null }>("select family_id, profile_id from watch_events");
    expect(ev).toEqual([{ family_id: FA, profile_id: null }]);
    expect((await rows(pg, "select kind, target_id, profile_id from whitelist where kind = 'channel'")).length).toBe(1);
  });

  it("rollback restores the pre-0018 whitelist exactly", async () => {
    const pg2 = await freshDb();
    await pg2.exec(readFileSync(path.join(MIG, "0018_child_scope.sql"), "utf8"));
    await pg2.exec(readFileSync(ROLLBACK, "utf8"));
    const after = await rows(pg2, "select kind, target_id, null::uuid as profile_id from whitelist order by family_id, kind, target_id");
    expect(after).toEqual(snapshotBefore);
    const { rows: cols } = await pg2.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'whitelist' order by ordinal_position");
    expect(cols.map((c) => c.column_name)).toEqual(["family_id", "kind", "target_id", "created_at"]);
    await expect(pg2.exec("select 1 from legacy_grants")).rejects.toThrow();
  });

  it("is safe to re-run the forward migration only once (fails loudly on a second run)", async () => {
    await expect(pg.exec(readFileSync(path.join(MIG, "0018_child_scope.sql"), "utf8"))).rejects.toThrow();
  });
});
