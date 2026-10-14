// Migration 0023 (PGlite): one live extension per child per night; 15/30/45/60 only; cutoff within the
// night; family consistency; one bedtime ask per child per night whatever its outcome; 45-minute grants
// only for bedtime; rollback.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate, rollbackSql } from "./db-helpers";

const U = "00000000-0000-0000-0000-0000000000b1", U2 = "00000000-0000-0000-0000-0000000000b2";
const F = "bbbbbbbb-0000-0000-0000-000000000001", F2 = "bbbbbbbb-0000-0000-0000-000000000002";
const MAYA = "bbbbbbbb-0000-0000-0000-0000000000a1", LEO = "bbbbbbbb-0000-0000-0000-0000000000a2";
const ext = (p: string, o: { night?: string; m?: number; cutoff?: string; fam?: string } = {}) =>
  `insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at) values ('${o.fam ?? F}', '${p}', '${o.night ?? "2026-10-13"}', '19:30', ${o.m ?? 30}, '${o.cutoff ?? "2026-10-14T03:00:00Z"}')`;
const ask = (p: string, kind = "bedtime", day = "2026-10-13") => `insert into time_requests (family_id, profile_id, kind, day) values ('${F}', '${p}', '${kind}', '${day}')`;

describe("0023 bedtime extensions (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0023");
    await db.exec(`insert into auth.users (id) values ('${U}'), ('${U2}');
      insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x'), ('${F2}', '${U2}', 'x');
      insert into profiles (id, family_id, name) values ('${MAYA}', '${F}', 'Maya'), ('${LEO}', '${F}', 'Leo');`);
  });
  it("one live extension per child per night", async () => {
    await db.exec(ext(MAYA));
    await expect(db.exec(ext(MAYA, { m: 60, cutoff: "2026-10-14T03:30:00Z" }))).rejects.toThrow(/duplicate|unique/i);
    await db.exec(ext(LEO));                                                  // another child
    await db.exec(ext(MAYA, { night: "2026-10-14", cutoff: "2026-10-15T03:00:00Z" })); // another night
  });
  it("cancelling frees the night for a new grant", async () => {
    await db.exec(`update bedtime_extensions set cancelled_at = now() where profile_id = '${MAYA}' and night = '2026-10-13'`);
    await db.exec(ext(MAYA, { m: 15, cutoff: "2026-10-14T02:45:00Z" }));
  });
  it("only 15/30/45/60, a cutoff within the night, a real HH:MM, the child's own family", async () => {
    await expect(db.exec(ext(MAYA, { night: "2026-10-20", m: 90, cutoff: "2026-10-21T04:00:00Z" }))).rejects.toThrow(/check/i);
    await expect(db.exec(ext(MAYA, { night: "2026-10-20", cutoff: "2026-11-01T03:00:00Z" }))).rejects.toThrow(/check/i);
    await expect(db.exec(`insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at) values ('${F}', '${MAYA}', '2026-10-21', '7:30pm', 15, '2026-10-22T03:00:00Z')`)).rejects.toThrow(/check/i);
    await expect(db.exec(ext(MAYA, { night: "2026-10-22", cutoff: "2026-10-23T03:00:00Z", fam: F2 }))).rejects.toThrow(/foreign key/i);
  });
  it("one bedtime ask per child per night, even after it was declined or fulfilled", async () => {
    await db.exec(ask(MAYA));
    await expect(db.exec(ask(MAYA))).rejects.toThrow(/duplicate|unique/i);
    await db.exec(`update time_requests set status = 'denied', resolved_at = now() where profile_id = '${MAYA}' and kind = 'bedtime'`);
    await expect(db.exec(ask(MAYA))).rejects.toThrow(/duplicate|unique/i);
    await db.exec(ask(LEO));
    await db.exec(ask(MAYA, "bedtime", "2026-10-14")); // the next night
  });
  it("daily-minute asks keep their own rule (one pending per day), and 45 minutes is only for bedtime", async () => {
    await db.exec(ask(MAYA, "limit"));
    await expect(db.exec(`update time_requests set status = 'approved', resolved_at = now(), granted_minutes = 45 where profile_id = '${MAYA}' and kind = 'limit'`)).rejects.toThrow(/check/i);
    await db.exec(`update time_requests set status = 'approved', resolved_at = now(), granted_minutes = 45 where profile_id = '${LEO}' and kind = 'bedtime'`);
  });
  it("rolls back cleanly (bedtime asks and extensions removed, 0022's rules restored)", async () => {
    await db.exec(rollbackSql("0023_bedtime_extensions.down.sql"));
    expect((await db.query(`select to_regclass('bedtime_extensions') r`)).rows[0]).toEqual({ r: null });
    expect((await db.query<{ n: number }>(`select count(*)::int n from time_requests where kind = 'bedtime'`)).rows[0].n).toBe(0);
    await expect(db.exec(ask(MAYA, "bedtime", "2026-10-30"))).rejects.toThrow(/check/i);
  });
});
