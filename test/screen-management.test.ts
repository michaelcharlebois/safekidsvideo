// Screens: device activity ("last active"), verified disconnects, and how a browser holding both a parent
// sign-in and a paired-screen cookie is treated. Runs lib/family.ts in Supabase mode against an in-memory
// stand-in for the PostgREST query builder (same filter semantics: eq / match / is / or / select).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const FAM = "f0000000-0000-4000-8000-000000000001", OTHER = "f0000000-0000-4000-8000-000000000002";
const MAYA = "p0000000-0000-4000-8000-0000000000a1", LEO = "p0000000-0000-4000-8000-0000000000a2";

// ---- the stand-in -----------------------------------------------------------
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const io = { writes: 0, failUpdate: null as null | "error" | "throw", failSelect: false };
function cond(row: Row, f: string): boolean { // "col.op.value"
  const [col, op, ...rest] = f.split("."); const val = rest.join(".");
  if (op === "is") return val === "null" ? row[col] == null : false;
  if (op === "lt") return row[col] != null && String(row[col]) < val;
  if (op === "eq") return String(row[col]) === val;
  throw new Error(`unsupported filter ${f}`);
}
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let mode: "select" | "update" | "insert" = "select", patch: Row = {}, single = false, returning = false;
  const b = {
    select() { if (mode === "select") mode = "select"; else returning = true; return b; },
    update(p: Row) { mode = "update"; patch = p; return b; },
    insert(p: Row) { mode = "insert"; patch = p; return b; },
    eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
    match(o: Row) { for (const [c, v] of Object.entries(o)) filters.push((r) => r[c] === v); return b; },
    is(c: string, v: null) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    or(s: string) { const parts = s.split(","); filters.push((r) => parts.some((p) => cond(r, p))); return b; },
    maybeSingle() { single = true; return b; },
    single() { single = true; return b; },
    then(res: (x: { data: unknown; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const rows = (tables[table] ??= []);
        if (mode === "insert") { const r = { id: `dev-${rows.length + 1}`, revoked_at: null, last_seen_at: null, ...patch }; rows.push(r); return { data: r, error: null }; }
        if (mode === "update") {
          if (io.failUpdate === "throw") throw new Error("network down");
          if (io.failUpdate === "error") return { data: null, error: { message: "database unavailable" } };
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          for (const r of hit) Object.assign(r, patch);
          io.writes += hit.length;
          return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        if (io.failSelect) return { data: null, error: { message: "database unavailable" } };
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      }).then(res, rej);
    },
  };
  return b;
}
const jar: Record<string, string> = {};
let signedIn: { id: string; email: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  supabaseEnabled: true,
  supabaseAdmin: () => ({ from }),
  supabaseAuthClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn } }) } }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n in jar ? { name: n, value: jar[n] } : undefined) }) }));
vi.mock("@/lib/db", () => ({
  DEFAULT_FAMILY_ID: "00000000-0000-0000-0000-000000000001", STORE_KIND: "supabase",
  db: { listProfiles: async (fid: string) => (fid === FAM ? [{ id: MAYA, familyId: FAM, name: "Maya", sort: 0 }, { id: LEO, familyId: FAM, name: "Leo", sort: 1 }] : []) },
}));

const fam = () => import("@/lib/family");
const device = (id: string, token: string, o: Row = {}) => ({ id, family_id: FAM, name: id, token_hash: sha(token), revoked_at: null, last_seen_at: null, assigned_profile_id: null, active_profile_id: null, ...o });
const row = (id: string) => tables.devices.find((d) => d.id === id)!;
const T0 = Date.parse("2026-10-16T03:00:00Z"); // 8:00 pm in Los Angeles

beforeEach(async () => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(jar)) delete jar[k];
  Object.assign(io, { writes: 0, failUpdate: null, failSelect: false });
  signedIn = null;
  tables.devices = [device("tv", "tok-tv"), device("tab", "tok-tab", { assigned_profile_id: MAYA }), device("theirs", "tok-theirs", { family_id: OTHER })];
  tables.families = [{ id: FAM, owner_user_id: "u1" }];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  (await fam()).__resetDeviceActivityCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("device activity (last active)", () => {
  it("a newly paired screen gets an accurate first activity time", async () => {
    tables.pairing_codes = [{ code: "12345678", family_id: FAM, used_at: null, expires_at: new Date(T0 + 600_000).toISOString() }];
    const r = await (await fam()).redeemPairingCode("12345678", "Kitchen tablet");
    expect("token" in r).toBe(true);
    const fresh = tables.devices.find((d) => d.name === "Kitchen tablet")!;
    expect(fresh.last_seen_at).toBe(new Date(T0).toISOString());
  });

  it("visiting the kid experience records activity — awaited, scoped to that screen", async () => {
    jar.skv_device = "tok-tv";
    const v = await (await fam()).resolveViewer();
    expect(v).toMatchObject({ role: "device", deviceId: "tv", familyId: FAM, shared: true });
    expect(row("tv").last_seen_at).toBe(new Date(T0).toISOString());
    expect(row("tab").last_seen_at).toBeNull();
    expect(row("theirs").last_seen_at).toBeNull();
    expect(io.writes).toBe(1);
  });

  it("repeat visits are throttled: one write per 5 minutes, then the next visit updates it", async () => {
    jar.skv_device = "tok-tv";
    const { resolveViewer, LAST_SEEN_EVERY_MS } = await fam();
    for (let i = 0; i < 10; i++) await resolveViewer();           // layout + page + actions in one burst
    await Promise.all(Array.from({ length: 5 }, () => resolveViewer()));
    expect(io.writes).toBe(1);
    vi.setSystemTime(T0 + LAST_SEEN_EVERY_MS - 1000);
    await resolveViewer();
    expect(io.writes).toBe(1);
    vi.setSystemTime(T0 + LAST_SEEN_EVERY_MS + 1000);
    await resolveViewer();
    expect(io.writes).toBe(2);
    expect(row("tv").last_seen_at).toBe(new Date(T0 + LAST_SEEN_EVERY_MS + 1000).toISOString());
  });

  it("another server instance doesn't write again: the UPDATE only matches a stale last_seen_at", async () => {
    const { recordDeviceActivity, __resetDeviceActivityCache } = await fam();
    row("tv").last_seen_at = new Date(T0 - 60_000).toISOString();               // written a minute ago elsewhere
    __resetDeviceActivityCache();
    // This instance read the row before that write (stale view: never seen) — the database still refuses.
    expect(await recordDeviceActivity({ id: "tv", family_id: FAM, last_seen_at: null })).toBe("written");
    expect(io.writes).toBe(0);
    expect(row("tv").last_seen_at).toBe(new Date(T0 - 60_000).toISOString());
  });

  it("only the authenticated, non-revoked screen of that family is updated", async () => {
    const { recordDeviceActivity } = await fam();
    await recordDeviceActivity({ id: "theirs", family_id: FAM, last_seen_at: null });  // id from another family
    row("tab").revoked_at = new Date(T0 - 1000).toISOString();
    await recordDeviceActivity({ id: "tab", family_id: FAM, last_seen_at: null });     // revoked
    expect(io.writes).toBe(0);
  });

  it("a failed or thrown activity write never blocks the screen, and the next request retries", async () => {
    jar.skv_device = "tok-tv";
    const { resolveViewer } = await fam();
    io.failUpdate = "error";
    expect(await resolveViewer()).toMatchObject({ role: "device", deviceId: "tv" });
    io.failUpdate = "throw";
    expect(await resolveViewer()).toMatchObject({ role: "device", deviceId: "tv" });
    io.failUpdate = null;
    await resolveViewer();
    expect(row("tv").last_seen_at).toBe(new Date(T0).toISOString());
  });

  it("activity is separate from viewing history (no watch rows written)", async () => {
    jar.skv_device = "tok-tv";
    await (await fam()).resolveViewer();
    expect(tables.watch_events ?? []).toEqual([]);
  });

  it("is recorded on every kid page before time limits are applied (so Time to rest and the limit screen count)", async () => {
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync("src/app/watch/layout.tsx", "utf8");
    expect(layout.indexOf("resolveViewer()")).toBeGreaterThan(-1);
    expect(layout.indexOf("resolveViewer()")).toBeLessThan(layout.indexOf("timeState("));
    for (const p of ["src/app/watch/[id]/page.tsx", "src/app/watch/page.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src.indexOf("resolveViewer()"), p).toBeLessThan(src.indexOf("timeState("));
    }
  });
});

describe("disconnecting a screen", () => {
  it("revokes exactly that screen, and its token stops working at once", async () => {
    const { revokeDevice, resolveViewer } = await fam();
    jar.skv_device = "tok-tv";
    expect((await resolveViewer()).role).toBe("device");
    expect(await revokeDevice(FAM, "tv")).toEqual({ name: "tv" });
    expect(row("tv").revoked_at).toBeTruthy();
    expect(row("tab").revoked_at).toBeNull();
    expect(await resolveViewer()).toEqual({ role: "none", familyId: null });
  });

  it("a database failure throws and leaves the screen connected", async () => {
    const { revokeDevice, DeviceRevokeFailed, resolveViewer } = await fam();
    io.failUpdate = "error";
    await expect(revokeDevice(FAM, "tv")).rejects.toBeInstanceOf(DeviceRevokeFailed);
    io.failUpdate = "throw";
    await expect(revokeDevice(FAM, "tv")).rejects.toThrow();
    expect(row("tv").revoked_at).toBeNull();
    io.failUpdate = null;
    jar.skv_device = "tok-tv";
    expect((await resolveViewer()).role).toBe("device"); // it really is still connected — and the UI says so
  });

  it("another family's screen can't be disconnected (and isn't reported as disconnected)", async () => {
    const { revokeDevice, DeviceRevokeFailed } = await fam();
    await expect(revokeDevice(FAM, "theirs")).rejects.toBeInstanceOf(DeviceRevokeFailed);
    expect(row("theirs").revoked_at).toBeNull();
  });

  it("disconnecting twice is fine (already revoked); a failed check afterwards isn't reported as success", async () => {
    const { revokeDevice, DeviceRevokeFailed } = await fam();
    await revokeDevice(FAM, "tv");
    expect(await revokeDevice(FAM, "tv")).toEqual({ name: "tv" });
    io.failSelect = true;
    await expect(revokeDevice(FAM, "tv")).rejects.toBeInstanceOf(DeviceRevokeFailed);
  });

  it("is still allowed while permission writes are paused (it only restricts)", async () => {
    process.env.BF_PERMISSION_WRITES_PAUSED = "1";
    try { expect(await (await fam()).revokeDevice(FAM, "tv")).toEqual({ name: "tv" }); } finally { delete process.env.BF_PERMISSION_WRITES_PAUSED; }
  });
});

describe("a browser with both a parent sign-in and a paired-screen cookie", () => {
  it("is the kid screen (a valid screen token wins over a leftover parent session), and its use is recorded", async () => {
    // Pairing and parent sign-in now each remove the other credential (test/session-isolation.test.ts); this
    // covers leftovers from before that. Failing toward the kid screen keeps a forgotten parent session on a
    // child's TV from granting parent access.
    jar.skv_device = "tok-tv";
    signedIn = { id: "u1", email: "parent@example.com" };
    const v = await (await fam()).resolveViewer();
    expect(v).toMatchObject({ role: "device", deviceId: "tv", familyId: FAM });
    expect(row("tv").last_seen_at).toBe(new Date(T0).toISOString());
  });

  it("with a revoked screen token, the parent session applies as before", async () => {
    jar.skv_device = "tok-tv";
    row("tv").revoked_at = new Date(T0 - 1000).toISOString();
    signedIn = { id: "u1", email: "parent@example.com" };
    expect(await (await fam()).resolveViewer()).toMatchObject({ role: "parent", familyId: FAM });
  });

  it("after signing out, the same browser is the paired screen again (and that use is recorded)", async () => {
    jar.skv_device = "tok-tv";
    signedIn = null;
    expect(await (await fam()).resolveViewer()).toMatchObject({ role: "device", deviceId: "tv" });
    expect(row("tv").last_seen_at).toBe(new Date(T0).toISOString());
  });

  it("a revoked screen cookie next to a parent sign-in gives no device access either way", async () => {
    jar.skv_device = "tok-tv";
    row("tv").revoked_at = new Date(T0).toISOString();
    expect((await (await fam()).resolveViewer()).role).toBe("none");
  });
});
