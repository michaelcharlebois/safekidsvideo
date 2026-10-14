// Migration 0022 (PGlite): one pending more-time request per child per kind per day, across screens;
// children are separate; answered requests allow a new one; grants only on approval; rollback.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate, rollbackSql } from "./db-helpers";

const U = "00000000-0000-0000-0000-0000000000d1", U2 = "00000000-0000-0000-0000-0000000000d2";
const F = "dddddddd-0000-0000-0000-000000000001", F2 = "dddddddd-0000-0000-0000-000000000002";
const MAYA = "dddddddd-0000-0000-0000-0000000000a1", LEO = "dddddddd-0000-0000-0000-0000000000a2";
const ask = (p: string, day = "2026-10-13", fam = F) => `insert into time_requests (family_id, profile_id, day) values ('${fam}', '${p}', '${day}')`;

describe("0022 time requests (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0022");
    await db.exec(`insert into auth.users (id) values ('${U}'), ('${U2}');
      insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x'), ('${F2}', '${U2}', 'x');
      insert into profiles (id, family_id, name) values ('${MAYA}', '${F}', 'Maya'), ('${LEO}', '${F}', 'Leo');`);
  });
  it("one pending ask per child per day: a second (from any screen) is refused", async () => {
    await db.exec(ask(MAYA));
    await expect(db.exec(ask(MAYA))).rejects.toThrow(/duplicate|unique/i);
  });
  it("another child, or another day, is separate", async () => {
    await db.exec(ask(LEO));
    await db.exec(ask(MAYA, "2026-10-14"));
  });
  it("a child can't be filed under another family", async () => {
    await expect(db.exec(ask(MAYA, "2026-10-15", F2))).rejects.toThrow(/foreign key/i);
  });
  it("minutes are recorded only with an approval, and only 15/30/60", async () => {
    await expect(db.exec(`update time_requests set status = 'denied', resolved_at = now(), granted_minutes = 15 where profile_id = '${LEO}'`)).rejects.toThrow(/check/i);
    await expect(db.exec(`update time_requests set status = 'approved', resolved_at = now() where profile_id = '${LEO}'`)).rejects.toThrow(/check/i);
    await expect(db.exec(`update time_requests set status = 'approved', resolved_at = now(), granted_minutes = 45 where profile_id = '${LEO}'`)).rejects.toThrow(/check/i);
    await db.exec(`update time_requests set status = 'approved', resolved_at = now(), granted_minutes = 30 where profile_id = '${LEO}'`);
  });
  it("once answered, the child can ask again that day (e.g. the extra time ran out too)", async () => {
    await db.exec(ask(LEO));
  });
  it("only 'limit' requests exist (a bedtime kind needs its own approval)", async () => {
    await expect(db.exec(`insert into time_requests (family_id, profile_id, day, kind) values ('${F}', '${MAYA}', '2026-10-20', 'bedtime')`)).rejects.toThrow(/check/i);
  });
  it("rolls back cleanly", async () => {
    await db.exec(rollbackSql("0022_time_requests.down.sql"));
    const r = await db.query(`select 1 from information_schema.tables where table_name = 'time_requests'`);
    expect(r.rows).toHaveLength(0);
  });
});
