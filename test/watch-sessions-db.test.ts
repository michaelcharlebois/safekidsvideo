// Migration 0020 against real SQL (PGlite): one start and one end row per session; retries are refused;
// older rows without a session id are untouched; the rollback is clean.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import pg from "pg";
import { migrate, rollbackSql } from "./db-helpers";

const U = "00000000-0000-0000-0000-0000000000e1";
const F = "eeeeeeee-0000-0000-0000-000000000001";
const P = "eeeeeeee-0000-0000-0000-0000000000a1";
const S = "eeeeeeee-0000-4000-8000-0000000000f1";
const row = (extra = "") => `insert into watch_events (family_id, profile_id, video_id, completed${extra ? ", outcome, ended_at_sec" : ""}, session_id) values ('${F}', '${P}', 'vid00000001', ${extra ? "true, " + extra : "false"}, '${S}')`;

describe("0020 watch sessions (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0020");
    await db.exec(`
      insert into auth.users (id) values ('${U}');
      insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x');
      insert into profiles (id, family_id, name) values ('${P}', '${F}', 'Maya');
      insert into videos (id, title) values ('vid00000001', 'A video');
    `);
  });

  it("a session has one start row: a retried start is refused", async () => {
    await db.exec(row());
    await expect(db.exec(row())).rejects.toThrow(/duplicate|unique/i);
  });

  it("…and one end row: a second end is refused", async () => {
    await db.exec(row("'finished', 600"));
    await expect(db.exec(row("'skipped', 30"))).rejects.toThrow(/duplicate|unique/i);
    const n = await db.query<{ n: number }>(`select count(*)::int n from watch_events where session_id = '${S}'`);
    expect(n.rows[0].n).toBe(2);
  });

  it("older rows without a session id are unaffected", async () => {
    await db.exec(`insert into watch_events (family_id, profile_id, video_id, completed) values ('${F}', '${P}', 'vid00000001', false), ('${F}', '${P}', 'vid00000001', false)`);
    const n = await db.query<{ n: number }>(`select count(*)::int n from watch_events where session_id is null`);
    expect(n.rows[0].n).toBe(2);
  });

  it("rolls back cleanly", async () => {
    await db.exec(rollbackSql("0020_watch_sessions.down.sql"));
    const c = await db.query(`select 1 from information_schema.columns where table_name = 'watch_events' and column_name = 'session_id'`);
    expect(c.rows).toHaveLength(0);
  });
});

// Real Postgres (PG_TEST_URL from scripts/staging-db-check.sh): the same start row sent many times at once,
// from separate connections, is stored once.
const URL = process.env.PG_TEST_URL;
describe.skipIf(!URL)("0020 watch sessions (real Postgres, concurrent retries)", () => {
  it("parallel retries of one session's start and end store exactly one of each", async () => {
    const admin = new pg.Client({ connectionString: URL });
    await admin.connect();
    const dbName = `ws_${Date.now()}`;
    await admin.query(`create database ${dbName}`);
    const url = URL!.replace(/\/postgres(\?|$)/, `/${dbName}$1`);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await migrate((q) => c.query(q), "0020");
      await c.query(`insert into auth.users (id) values ('${U}'); insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x');
        insert into profiles (id, family_id, name) values ('${P}', '${F}', 'Maya'); insert into videos (id, title) values ('vid00000001', 'A video');`);
      const pool = new pg.Pool({ connectionString: url, max: 8 });
      const tries = (sql: string) => Promise.allSettled(Array.from({ length: 12 }, () => pool.query(sql)));
      await tries(row());
      await tries(row("'finished', 600"));
      await pool.end();
      const r = await c.query(`select count(*) filter (where outcome is null)::int s, count(*) filter (where outcome is not null)::int e from watch_events where session_id = '${S}'`);
      expect(r.rows[0]).toEqual({ s: 1, e: 1 });
    } finally {
      await c.end();
      await admin.query(`drop database ${dbName}`);
      await admin.end();
    }
  });
});
