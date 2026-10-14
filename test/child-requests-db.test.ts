// Migration 0021 (PGlite): one pending request per CHILD per video; a repeat ask by the same child is
// refused; two children can ask for the same video; older unattributed requests stay one per video.
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { migrate, rollbackSql } from "./db-helpers";

const U = "00000000-0000-0000-0000-0000000000f1";
const F = "ffffffff-0000-0000-0000-000000000001";
const MAYA = "ffffffff-0000-0000-0000-0000000000a1", LEO = "ffffffff-0000-0000-0000-0000000000a2";
const ask = (p: string | null) => `insert into watch_requests (family_id, video_id, profile_id) values ('${F}', 'vid00000001', ${p ? `'${p}'` : "null"})`;

describe("0021 child-scoped requests (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0021");
    await db.exec(`insert into auth.users (id) values ('${U}'); insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x');
      insert into profiles (id, family_id, name) values ('${MAYA}', '${F}', 'Maya'), ('${LEO}', '${F}', 'Leo'); insert into videos (id, title) values ('vid00000001', 'A video');`);
  });
  it("two children can each have a pending request for the same video", async () => {
    await db.exec(ask(MAYA));
    await db.exec(ask(LEO));
  });
  it("a child's repeat ask is refused while the first is pending", async () => {
    await expect(db.exec(ask(MAYA))).rejects.toThrow(/duplicate|unique/i);
  });
  it("older requests with no child stay one per video", async () => {
    await db.exec(ask(null));
    await expect(db.exec(ask(null))).rejects.toThrow(/duplicate|unique/i);
  });
  it("once answered, the child can ask again later", async () => {
    await db.exec(`update watch_requests set status = 'denied' where profile_id = '${MAYA}'`);
    await db.exec(ask(MAYA));
  });
  it("rollback restores the old index when there's no conflict", async () => {
    await db.exec(`delete from watch_requests where profile_id = '${LEO}' or profile_id is null`);
    await db.exec(rollbackSql("0021_child_requests.down.sql"));
    const r = await db.query(`select indexname from pg_indexes where tablename = 'watch_requests' and indexname = 'watch_requests_pending_idx'`);
    expect(r.rows).toHaveLength(1);
  });
});
