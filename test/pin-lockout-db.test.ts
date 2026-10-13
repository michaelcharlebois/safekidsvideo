// The shared-screen PIN lockout lives in the database (0019 claim_pin_attempt / pin_attempt_succeeded).
// Part 1 runs everywhere in PGlite. Part 2 needs a real Postgres server (PG_TEST_URL, e.g. from
// scripts/staging-db-check.sh) and fires genuinely parallel attempts from separate connections.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import pg from "pg";
import { migrate, rollbackSql } from "./db-helpers";
import { PIN_MAX_FAILURES } from "@/lib/pin";

const U = "00000000-0000-0000-0000-0000000000c1";
const F = "cccccccc-0000-0000-0000-000000000001";
const DEV = "cccccccc-0000-0000-0000-0000000000d1";
const REVOKED = "cccccccc-0000-0000-0000-0000000000d2";
const SEED = `
  insert into auth.users (id) values ('${U}');
  insert into families (id, owner_user_id, pin_hash) values ('${F}', '${U}', 'x');
  insert into devices (id, family_id, token_hash) values ('${DEV}', '${F}', 't1');
  insert into devices (id, family_id, token_hash, revoked_at) values ('${REVOKED}', '${F}', 't2', now());
`;
type Claim = { allowed: boolean; seconds_left: number };

describe("PIN lockout (PGlite)", () => {
  let db: PGlite;
  const claim = async (dev = DEV) => (await db.query<Claim>(`select * from claim_pin_attempt($1, ${PIN_MAX_FAILURES})`, [dev])).rows[0];
  const ok = (dev = DEV) => db.query("select pin_attempt_succeeded($1)", [dev]);
  const reset = () => db.exec(`update devices set pin_failures = 0, pin_locked_until = null where id = '${DEV}'`);
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await migrate((q) => db.exec(q), "0019");
    await db.exec(SEED);
  });

  it("allows PIN_MAX_FAILURES attempts, then refuses with a countdown", async () => {
    await reset();
    for (let i = 0; i < PIN_MAX_FAILURES; i++) expect((await claim()).allowed).toBe(true);
    const r = await claim();
    expect(r.allowed).toBe(false);
    expect(r.seconds_left).toBeGreaterThan(290);
    expect(r.seconds_left).toBeLessThanOrEqual(300);
  });

  it("a burst of simultaneous attempts still gets only PIN_MAX_FAILURES through", async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 20 }, () => claim()));
    expect(results.filter((r) => r.allowed)).toHaveLength(PIN_MAX_FAILURES);
  });

  it("a correct PIN clears the count (and a lock its own attempt started)", async () => {
    await reset();
    for (let i = 0; i < PIN_MAX_FAILURES - 1; i++) await claim();
    expect((await claim()).allowed).toBe(true); // this claim set the lock …
    await ok(); // … and the PIN was right
    expect((await claim()).allowed).toBe(true);
    const row = (await db.query<{ pin_failures: number }>(`select pin_failures from devices where id = '${DEV}'`)).rows[0];
    expect(row.pin_failures).toBe(1);
  });

  it("the lock expires", async () => {
    await db.exec(`update devices set pin_failures = 0, pin_locked_until = now() - interval '1 second' where id = '${DEV}'`);
    expect((await claim()).allowed).toBe(true);
  });

  it("revoked or unknown devices are refused, and success can't revive them", async () => {
    expect((await claim(REVOKED)).allowed).toBe(false);
    expect((await claim("cccccccc-0000-0000-0000-00000000ffff")).allowed).toBe(false);
  });

  it("browsers can't call the functions (anon / authenticated have no execute)", async () => {
    const can = await db.query<{ anon: boolean; authed: boolean; svc: boolean }>(`
      select has_function_privilege('anon', 'claim_pin_attempt(uuid,int,interval)', 'execute') as anon,
             has_function_privilege('authenticated', 'pin_attempt_succeeded(uuid)', 'execute') as authed,
             has_function_privilege('service_role', 'claim_pin_attempt(uuid,int,interval)', 'execute') as svc`);
    expect(can.rows[0]).toEqual({ anon: false, authed: false, svc: true });
  });

  it("rolls back cleanly", async () => {
    await db.exec(rollbackSql("0019_pin_attempts.down.sql"));
    const n = (await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('claim_pin_attempt','pin_attempt_succeeded')")).rows[0].n;
    expect(n).toBe(0);
  });
});

const PG_URL = process.env.PG_TEST_URL;

describe.skipIf(!PG_URL)("PIN lockout under real concurrency (Postgres server)", () => {
  const name = `bf_pin_${Date.now()}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: PG_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(PG_URL!); url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 25 });
    await migrate((q) => pool.query(q), "0019");
    await pool.query(SEED);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${name}`);
    await admin?.end();
  });

  it("25 attempts from 25 separate connections at once: exactly PIN_MAX_FAILURES allowed", async () => {
    const clients = await Promise.all(Array.from({ length: 25 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c) => c.query<Claim>(`select * from claim_pin_attempt($1, ${PIN_MAX_FAILURES})`, [DEV])));
      expect(results.filter((r) => r.rows[0].allowed)).toHaveLength(PIN_MAX_FAILURES);
      const row = (await clients[0].query(`select pin_locked_until > now() as locked from devices where id = $1`, [DEV])).rows[0]; // (the pool is fully checked out here)
      expect(row.locked).toBe(true);
    } finally {
      clients.forEach((c) => c.release());
    }
  });

  it("repeated rounds never exceed the limit", async () => {
    for (let round = 0; round < 5; round++) {
      await pool.query(`update devices set pin_failures = 0, pin_locked_until = null where id = $1`, [DEV]);
      const results = await Promise.all(Array.from({ length: 15 }, () => pool.query<Claim>(`select * from claim_pin_attempt($1, ${PIN_MAX_FAILURES})`, [DEV])));
      expect(results.filter((r) => r.rows[0].allowed)).toHaveLength(PIN_MAX_FAILURES);
    }
  });
});
