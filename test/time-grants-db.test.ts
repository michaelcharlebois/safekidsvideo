// 0023's grant functions: approving an ask and creating what it grants happen in ONE transaction, so an
// ask is never "approved" without its extension (or minutes). Retries and racing approvals settle to one
// grant; a direct grant answers the child's pending ask in the same write. Part 1 runs in PGlite; part 2
// runs the races on a real Postgres server, from separate connections (PG_TEST_URL).
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import pg from "pg";
import { migrate } from "./db-helpers";

const U = "00000000-0000-0000-0000-0000000000d1";
const F = "dddddddd-0000-0000-0000-000000000001";
const MAYA = "dddddddd-0000-0000-0000-0000000000a1", LEO = "dddddddd-0000-0000-0000-0000000000a2", ZOE = "dddddddd-0000-0000-0000-0000000000a3";
const NIGHT = "2026-10-13", CUT = (m: number) => new Date(Date.parse("2026-10-14T02:30:00Z") + m * 60000).toISOString();
const SEED = `insert into auth.users (id) values ('${U}'); insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x');
  insert into profiles (id, family_id, name) values ('${MAYA}', '${F}', 'Maya'), ('${LEO}', '${F}', 'Leo'), ('${ZOE}', '${F}', 'Zoe');`;
const askSql = (p: string, kind: string, day = NIGHT) => `insert into time_requests (family_id, profile_id, kind, day) values ('${F}', '${p}', '${kind}', '${day}') returning id`;
const approveBed = (req: string, m: number, night = NIGHT) => `select approve_bedtime_request('${F}', '${req}', ${m}, '${CUT(m)}', '19:30', '${night}') r`;
const grantBed = (p: string, m: number) => `select grant_bedtime_extension('${F}', '${p}', '${NIGHT}', '19:30', ${m}, '${CUT(m)}', null) r`;
const approveMin = (req: string, m: number, day = NIGHT) => `select approve_minutes_request('${F}', '${req}', ${m}, '${day}') r`;

describe("0023 grant functions (PGlite)", () => {
  let db: PGlite;
  const one = async <T = Record<string, unknown>>(q: string) => (await db.query<T>(q)).rows[0];
  const ask = async (p: string, kind: string, day?: string) => (await one<{ id: string }>(askSql(p, kind, day))).id;
  const live = (p: string) => db.query<{ extra_minutes: number; request_id: string | null }>(`select extra_minutes, request_id from bedtime_extensions where profile_id = '${p}' and cancelled_at is null`).then((r) => r.rows);
  const reqRow = (id: string) => one<{ status: string; granted_minutes: number | null }>(`select status, granted_minutes from time_requests where id = '${id}'`);
  beforeAll(async () => { db = new PGlite({ extensions: { pgcrypto } }); await migrate((q) => db.exec(q), "0023"); await db.exec(SEED); });

  it("approve: the extension and the answered ask appear together; a retry is 'gone' and changes nothing", async () => {
    const req = await ask(MAYA, "bedtime");
    expect((await one(approveBed(req, 30))).r).toBe("done");
    expect(await live(MAYA)).toEqual([{ extra_minutes: 30, request_id: req }]);
    expect(await reqRow(req)).toEqual({ status: "approved", granted_minutes: 30 });
    expect((await one(approveBed(req, 60))).r).toBe("gone");
    expect(await live(MAYA)).toEqual([{ extra_minutes: 30, request_id: req }]);
  });

  it("a failure while creating the extension leaves the ask pending (nothing claimed without a grant)", async () => {
    const req = await ask(LEO, "bedtime");
    await expect(db.query(approveBed(req, 90))).rejects.toThrow(/check/i);   // 90 isn't an allowed step → insert fails
    expect(await reqRow(req)).toEqual({ status: "pending", granted_minutes: null });
    expect(await live(LEO)).toEqual([]);
    expect((await one(approveBed(req, 15))).r).toBe("done");                 // a later retry still works
  });

  it("an ask from another night is 'expired', not granted", async () => {
    const req = await ask(ZOE, "bedtime", "2026-10-12");
    expect((await one(approveBed(req, 15))).r).toBe("expired");
    expect(await live(ZOE)).toEqual([]);
    expect((await reqRow(req)).status).toBe("pending");
  });

  it("a direct grant creates or replaces tonight's one extension and answers tonight's pending ask", async () => {
    const req = await ask(ZOE, "bedtime");
    const id = (await one<{ r: string }>(grantBed(ZOE, 45))).r;
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(await reqRow(req)).toEqual({ status: "approved", granted_minutes: 45 });
    expect((await one(approveBed(req, 60))).r).toBe("gone");                 // the ask was settled by the grant
    expect((await one<{ r: string }>(grantBed(ZOE, 60))).r).toBe(id);        // changed in place, still one
    expect(await live(ZOE)).toEqual([{ extra_minutes: 60, request_id: null }]);
    await expect(db.query(`select grant_bedtime_extension('${F}', '${U}', '${NIGHT}', '19:30', 15, '${CUT(15)}', null)`)).rejects.toThrow(/not a child/);
  });

  it("minutes: approve adds once (adding to today's, replacing yesterday's); retries are 'gone'; a direct grant answers the ask", async () => {
    await db.exec(`update profiles set bonus_minutes = 10, bonus_day = '2026-10-12' where id = '${MAYA}'`);
    const req = await ask(MAYA, "limit");
    expect((await one(approveMin(req, 15))).r).toBe("done");
    expect((await one(approveMin(req, 15))).r).toBe("gone");
    expect(await one(`select bonus_minutes, bonus_day::text d from profiles where id = '${MAYA}'`)).toEqual({ bonus_minutes: 15, d: NIGHT });
    const req2 = await ask(MAYA, "limit");
    await db.query(`select grant_minutes('${F}', '${MAYA}', 30, '${NIGHT}')`);
    expect(await reqRow(req2)).toEqual({ status: "approved", granted_minutes: 30 });
    expect((await one(`select bonus_minutes from profiles where id = '${MAYA}'`)).bonus_minutes).toBe(45);
    expect((await one(approveMin(req2, 15))).r).toBe("gone");
  });

  it("the functions can't be called by signed-in users or the public — only the server", async () => {
    const r = await db.query<{ f: string; anon: boolean; auth: boolean; svc: boolean }>(`
      select p.proname f, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
        from pg_proc p where p.proname in ('approve_bedtime_request', 'grant_bedtime_extension', 'approve_minutes_request', 'grant_minutes') order by 1`);
    expect(r.rows).toHaveLength(4);
    for (const x of r.rows) expect(x, x.f).toMatchObject({ anon: false, auth: false, svc: true });
  });
});

// Real Postgres: the races, from separate connections at once.
const URL = process.env.PG_TEST_URL;
describe.skipIf(!URL)("0023 grant functions (real Postgres, concurrent)", () => {
  it("racing approvals, retries and direct grants settle to one grant, with no deadlock", async () => {
    const admin = new pg.Client({ connectionString: URL });
    await admin.connect();
    const name = `tg_${Date.now()}`;
    await admin.query(`create database ${name}`);
    const url = URL!.replace(/\/postgres(\?|$)/, `/${name}$1`);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const pool = new pg.Pool({ connectionString: url, max: 12 });
    try {
      await migrate((q) => c.query(q), "0023");
      await c.query(SEED);
      const ask = async (p: string, kind: string) => (await c.query(askSql(p, kind))).rows[0].id as string;
      const results = (qs: string[]) => Promise.allSettled(qs.map((q) => pool.query(q)));
      const done = (s: PromiseSettledResult<pg.QueryResult>[]) => s.filter((x) => x.status === "fulfilled" && x.value.rows[0]?.r === "done").length;

      // 1. Ten approvals of one bedtime ask (two parents, retries): exactly one "done", one live extension.
      const a = await ask(MAYA, "bedtime");
      const r1 = await results(Array.from({ length: 10 }, (_, i) => approveBed(a, [15, 30, 45, 60][i % 4])));
      expect(r1.filter((x) => x.status === "rejected")).toEqual([]);
      expect(done(r1)).toBe(1);
      const e1 = (await c.query(`select extra_minutes from bedtime_extensions where profile_id = '${MAYA}' and cancelled_at is null`)).rows;
      expect(e1).toHaveLength(1);
      expect((await c.query(`select granted_minutes from time_requests where id = '${a}'`)).rows[0].granted_minutes).toBe(e1[0].extra_minutes);

      // 2. Approvals racing direct grants for the same child: no error or deadlock, one live extension, the ask approved.
      const b = await ask(LEO, "bedtime");
      const r2 = await results(Array.from({ length: 12 }, (_, i) => (i % 2 ? approveBed(b, 30) : grantBed(LEO, 60))));
      expect(r2.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      expect((await c.query(`select count(*)::int n from bedtime_extensions where profile_id = '${LEO}' and cancelled_at is null`)).rows[0].n).toBe(1);
      expect((await c.query(`select status from time_requests where id = '${b}'`)).rows[0].status).toBe("approved");

      // 3. Minutes: ten approvals add the minutes once; approvals racing direct grants don't deadlock.
      const m = await ask(ZOE, "limit");
      const r3 = await results(Array.from({ length: 10 }, () => approveMin(m, 15)));
      expect(done(r3)).toBe(1);
      expect((await c.query(`select bonus_minutes from profiles where id = '${ZOE}'`)).rows[0].bonus_minutes).toBe(15);
      const m2 = await ask(ZOE, "limit");
      const r4 = await results(Array.from({ length: 12 }, (_, i) => (i % 2 ? approveMin(m2, 15) : `select grant_minutes('${F}', '${ZOE}', 15, '${NIGHT}')`)));
      expect(r4.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      expect(done(r4)).toBeLessThanOrEqual(1);
      expect((await c.query(`select status from time_requests where id = '${m2}'`)).rows[0].status).toBe("approved");
    } finally {
      await pool.end();
      await c.end();
      await admin.query(`drop database ${name}`);
      await admin.end();
    }
  }, 60000);
});
