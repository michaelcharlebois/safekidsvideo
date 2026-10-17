// A browser is a parent's or a kid screen, never both. Runs the real server actions and auth routes in
// Supabase mode against stand-ins for the auth server (sessions tracked per browser, so sign-out scope is
// real) and PostgREST. A "browser" is one cookie jar shared by all its tabs; the parent's phone is another.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const FAM = "f0000000-0000-4000-8000-000000000001";
const PARENT = "u0000000-0000-4000-8000-000000000001";
const MAYA = "p0000000-0000-4000-8000-0000000000a1", LEO = "p0000000-0000-4000-8000-0000000000a2";
const AUTH = "sb-stagingref-auth-token";

// ---- browsers (cookie jars) ----
type Jar = Map<string, string>;
const browsers: Record<string, Jar> = {};
let current = "laptop";
const jar = () => (browsers[current] ??= new Map());
const as = async <T>(b: string, f: () => Promise<T>) => { const prev = current; current = b; try { return await f(); } finally { current = prev; } };

// ---- auth server ----
const sessions = new Map<string, { user: string; revoked: boolean }>();
const otp = new Map<string, string>(); // code or token_hash → user
const authFail = { logout: false };
function startSession(user: string) {
  const id = randomUUID(); sessions.set(id, { user, revoked: false });
  jar().set(AUTH, id); jar().set(`${AUTH}.1`, "second-chunk"); // a large session is split across cookies
  return id;
}
const authClient = () => ({
  auth: {
    getUser: async () => { const s = sessions.get(jar().get(AUTH) ?? ""); return { data: { user: s && !s.revoked ? { id: s.user, email: "parent@example.com" } : null } }; },
    verifyOtp: async (p: { token?: string; token_hash?: string }) => {
      const user = otp.get(p.token ?? p.token_hash ?? ""); if (!user) return { data: { user: null }, error: { message: "invalid" } };
      startSession(user); return { data: { user: { id: user } }, error: null };
    },
    exchangeCodeForSession: async (code: string) => { const user = otp.get(code); if (!user) return { error: { message: "bad code" } }; startSession(user); return { error: null }; },
    signOut: async ({ scope = "global" }: { scope?: string } = {}) => {
      const id = jar().get(AUTH); const s = id ? sessions.get(id) : undefined;
      let error = null;
      if (s) {
        if (authFail.logout) error = { message: "auth server unavailable" };
        else if (scope === "global") for (const x of sessions.values()) { if (x.user === s.user) x.revoked = true; }
        else if (scope === "local") s.revoked = true;
      }
      jar().delete(AUTH); // like @supabase/ssr, but leaving the ".1" chunk behind to prove the app cleans it up
      return { error };
    },
  },
});

// ---- PostgREST ----
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const fail = { devices: false };
function from(table: string) {
  const fs: ((r: Row) => boolean)[] = [];
  let mode = "select", patch: Row = {}, single = false, ret = false;
  const b = {
    select() { if (mode !== "select") ret = true; return b; },
    update(p: Row) { mode = "update"; patch = p; return b; }, insert(p: Row) { mode = "insert"; patch = p; return b; },
    eq(c: string, v: unknown) { fs.push((r) => r[c] === v); return b; },
    match(o: Row) { for (const [c, v] of Object.entries(o)) fs.push((r) => r[c] === v); return b; },
    is(c: string) { fs.push((r) => r[c] == null); return b; },
    or(s: string) { const parts = s.split(","); fs.push((r) => parts.some((p) => { const [c, op, ...v] = p.split("."); return op === "is" ? r[c] == null : op === "lt" ? r[c] != null && String(r[c]) < v.join(".") : false; })); return b; },
    gt() { return b; }, order() { return b; },
    maybeSingle() { single = true; return b; }, single() { single = true; return b; },
    then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => {
        const rows = (tables[table] ??= []);
        if (table === "devices" && fail.devices) return { data: null, error: { message: "database unavailable" } };
        if (mode === "insert") { const r = { id: randomUUID(), revoked_at: null, last_seen_at: null, assigned_profile_id: null, active_profile_id: null, ...patch }; rows.push(r); return { data: r, error: null }; }
        const hit = rows.filter((r) => fs.every((f) => f(r)));
        if (mode === "update") { for (const r of hit) Object.assign(r, patch); return { data: ret ? hit : null, error: null }; }
        return { data: single ? (hit[0] ?? null) : hit, error: null };
      }).then(res, rej);
    },
  };
  return b;
}
const admin = {
  from,
  rpc: async (fn: string) => (fn === "claim_pin_attempt" ? { data: [{ allowed: true, seconds_left: 0 }], error: null } : { data: null, error: null }),
  auth: { admin: {
    getUserById: async (id: string) => ({ data: { user: { id, email: "michael.charlebois+bfstaging2@gmail.com" } }, error: null }),
    generateLink: async () => { const h = randomUUID(); otp.set(h, PARENT); return { data: { user: { id: PARENT }, properties: { hashed_token: h } }, error: null }; },
  } },
};

vi.mock("@/lib/supabase/server", () => ({ supabaseEnabled: true, supabaseAdmin: () => admin, supabaseAuthClient: async () => authClient() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar().has(n) ? { name: n, value: jar().get(n)! } : undefined),
    getAll: () => [...jar()].map(([name, value]) => ({ name, value })),
    set: (n: string, v: string) => { jar().set(n, v); },
    delete: (n: string) => { jar().delete(n); },
  }),
  headers: async () => new Headers({ host: "localhost" }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => {
  const profiles = [{ id: MAYA, familyId: FAM, name: "Maya", sort: 0 }, { id: LEO, familyId: FAM, name: "Leo", sort: 1 }];
  return {
    DEFAULT_FAMILY_ID: "00000000-0000-0000-0000-000000000001", STORE_KIND: "supabase",
    db: {
      listProfiles: async (f: string) => (f === FAM ? profiles : []),
      getProfile: async (id: string) => profiles.find((p) => p.id === id) ?? null,
      getSettings: async () => ({ familyId: FAM, pinHash: "2580", flagThreshold: 3 }),
    },
  };
});

const go = async (f: () => Promise<unknown>) => { try { await f(); return undefined; } catch (e) { return (e as { to?: string }).to; } };
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const actions = () => import("@/app/actions");
const viewer = async () => (await import("@/lib/family")).resolveViewer();
const signInHere = async () => { otp.set("123456", PARENT); return go(async () => (await actions()).verifyCode(null, form({ email: "parent@example.com", code: "123456", next: "/parent" }))); };
const makeCode = (code = "12345678", expires = Date.now() + 600_000) => { tables.pairing_codes.push({ code, family_id: FAM, used_at: null, expires_at: new Date(expires).toISOString() }); return code; };
const pair = (code: string) => go(async () => { const r = await (await actions()).pairDevice(null, form({ code, name: "Living room TV" })); if (r) throw Object.assign(new Error("returned"), { to: `returned:${r.error}` }); });
const authCookies = () => [...jar().keys()].filter((k) => k.startsWith("sb-"));

beforeEach(async () => {
  for (const k of Object.keys(browsers)) delete browsers[k];
  for (const k of Object.keys(tables)) delete tables[k];
  sessions.clear(); otp.clear(); authFail.logout = false; fail.devices = false; current = "laptop";
  tables.families = [{ id: FAM, owner_user_id: PARENT }];
  tables.devices = []; tables.pairing_codes = [];
  (await import("@/lib/family")).__resetDeviceActivityCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.BF_QA_LOGIN_ENABLED; });

describe("pairing a browser where a parent is signed in", () => {
  it("1. the browser becomes kid-only: parent session ended here, every auth cookie gone, screen cookie set", async () => {
    await signInHere();
    expect((await viewer()).role).toBe("parent");
    expect(await pair(makeCode())).toBe("/watch");
    expect(authCookies()).toEqual([]);                 // including the leftover ".1" chunk
    expect(jar().has("skv_device")).toBe(true);
    expect(await viewer()).toMatchObject({ role: "device", familyId: FAM, deviceName: "Living room TV" });
    expect(tables.devices[0].last_seen_at).toBeTruthy(); // the screen works normally: first activity recorded
  });

  it("2. the parent stays signed in on their phone (sign-out here is local, not global)", async () => {
    await as("phone", signInHere);
    await signInHere();
    await pair(makeCode());
    expect(await as("phone", viewer)).toMatchObject({ role: "parent", familyId: FAM });
    expect([...sessions.values()].filter((s) => !s.revoked)).toHaveLength(1);
  });

  it("…and the old session can't be replayed: it was revoked on the auth server, not just dropped from the browser", async () => {
    const id = await (async () => { await signInHere(); return jar().get(AUTH)!; })();
    await pair(makeCode());
    expect(sessions.get(id)!.revoked).toBe(true);
    jar().set(AUTH, id); jar().delete("skv_device");   // someone re-adds the old cookie
    expect((await viewer()).role).toBe("none");
  });

  it("…even if the auth server can't be reached, the parent cookies are cleared from this browser", async () => {
    await signInHere();
    authFail.logout = true;
    await pair(makeCode());
    expect(authCookies()).toEqual([]);
    expect((await viewer()).role).toBe("device");
  });

  it("3. a wrong or expired code leaves the parent signed in, and creates no screen", async () => {
    await signInHere();
    expect(await pair("99999999")).toMatch(/^returned:That code isn't right/);
    expect(await pair(makeCode("87654321", Date.now() - 1000))).toMatch(/^returned:That code expired/);
    expect(await pair("12")).toMatch(/^returned:Enter the 8-digit code/);
    expect((await viewer()).role).toBe("parent");
    expect(authCookies()).toContain(AUTH);
    expect(jar().has("skv_device")).toBe(false);
    expect(tables.devices).toHaveLength(0);
  });

  it("tabs share the browser's cookies: after pairing in one tab, the other tab's next request is the kid screen", async () => {
    await signInHere();                                // tab 1: parent dashboard open
    await pair(makeCode());                            // tab 2: /pair, same browser (same jar)
    const tab1 = await go(async () => (await actions()).newPairingCode(form({}))); // tab 1 submits a parent action
    expect(tab1).toBe("/login?next=/parent");
    expect((await viewer()).role).toBe("device");
  });
});

describe("4. a paired screen can't use parent pages or actions", () => {
  it("parent-only server actions redirect to sign-in and change nothing", async () => {
    await pair(makeCode());
    const a = await actions();
    for (const [name, run] of [
      ["new pairing code", () => a.newPairingCode(form({}))],
      ["disconnect a screen", () => a.unpairDevice(form({ deviceId: String(tables.devices[0].id) }))],
      ["assign a screen", () => a.assignDeviceAction(form({ deviceId: String(tables.devices[0].id), profileId: MAYA }))],
      ["save settings", () => a.saveSettings(form({ profileId: MAYA, section: "time", dailyMinutes: "600" }))],
    ] as const) expect(await go(run as () => Promise<unknown>), name).toBe("/login?next=/parent");
    expect(tables.pairing_codes).toHaveLength(1);
    expect(tables.devices[0].revoked_at).toBeNull();
  });

  it("the family PIN doesn't grant parent access with accounts on (unlock is local-only)", async () => {
    await pair(makeCode());
    expect(await go(async () => (await actions()).unlock(null, form({ pin: "2580", next: "/parent" })))).toBe("/login");
    jar().set("skv_parent", "1");                      // the local-mode PIN cookie means nothing here
    expect((await viewer()).role).toBe("device");
  });

  it("a leftover parent session next to a valid screen token: the screen wins (and switching children needs the PIN)", async () => {
    await pair(makeCode());
    startSession(PARENT);                              // e.g. an older browser that had both
    expect((await viewer()).role).toBe("device");
    expect(await go(async () => (await actions()).newPairingCode(form({})))).toBe("/login?next=/parent");
    const r = await (await actions()).selectProfile(null, form({ profileId: LEO, next: "/watch" })).catch((e) => e.to);
    expect(r).toEqual({ error: "That PIN isn't right." }); // before: the parent branch switched children without a PIN
  });

  it("if the screen token can't be checked, nothing is granted (no fall-through to a leftover parent session)", async () => {
    await pair(makeCode());
    startSession(PARENT);
    fail.devices = true;
    expect((await viewer()).role).toBe("none");
  });
});

describe("5. a parent signing in on a paired screen", () => {
  it("email code: the screen is disconnected (record revoked, cookie removed) and the parent is told why", async () => {
    await pair(makeCode());
    const to = await signInHere();
    expect(to).toBe("/parent/devices?converted=Living%20room%20TV");
    expect(jar().has("skv_device")).toBe(false);
    expect(tables.devices[0].revoked_at).toBeTruthy();
    expect((await viewer()).role).toBe("parent");
  });

  it("magic link (/auth/callback) and token link (/auth/confirm) do the same", async () => {
    for (const route of ["callback", "confirm"] as const) {
      for (const k of Object.keys(browsers)) delete browsers[k];
      tables.devices = []; tables.pairing_codes = [];
      await pair(makeCode());
      otp.set("link-1", PARENT);
      const { GET } = await import(`@/app/auth/${route}/route`);
      const q = route === "callback" ? "code=link-1" : "token_hash=link-1&type=magiclink";
      const res: Response = await GET(new Request(`http://localhost/auth/${route}?${q}&next=/parent/review`) as never);
      expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search, route).toBe("/parent/devices?converted=Living%20room%20TV");
      expect(jar().has("skv_device"), route).toBe(false);
      expect(tables.devices[0].revoked_at, route).toBeTruthy();
      expect((await viewer()).role, route).toBe("parent");
    }
  });

  it("a failed sign-in changes nothing: the screen stays connected and working", async () => {
    await pair(makeCode());
    expect(await go(async () => (await actions()).verifyCode(null, form({ email: "parent@example.com", code: "000000", next: "/parent" })))).toBeUndefined();
    const { GET } = await import("@/app/auth/confirm/route");
    await GET(new Request("http://localhost/auth/confirm?token_hash=forged&type=magiclink") as never);
    expect(jar().has("skv_device")).toBe(true);
    expect(tables.devices[0].revoked_at).toBeNull();
    expect((await viewer()).role).toBe("device");
  });

  it("if the disconnect fails, the cookie is still removed and the parent is told to disconnect it on Screens", async () => {
    await pair(makeCode());
    otp.set("123456", PARENT);
    const real = from; let calls = 0;
    admin.from = (t: string) => { if (t === "devices" && ++calls > 1) { fail.devices = true; } return real(t); };
    const to = await go(async () => (await actions()).verifyCode(null, form({ email: "parent@example.com", code: "123456", next: "/parent" })));
    admin.from = real; fail.devices = false;
    expect(decodeURIComponent(to!)).toMatch(/^\/parent\/devices\?error=This browser was the kid screen/);
    expect(jar().has("skv_device")).toBe(false);       // never both credentials
    expect((await viewer()).role).toBe("parent");
  });

  it("only the screen this browser holds is disconnected; other screens are untouched", async () => {
    await as("tv2", () => pair(makeCode("11112222")));
    await pair(makeCode());
    await signInHere();
    const [tv2, here] = [tables.devices.find((d) => d.token_hash !== sha(String(browsers.laptop?.get("skv_device") ?? ""))), tables.devices];
    expect(here.filter((d) => d.revoked_at)).toHaveLength(1);
    expect(tv2?.revoked_at ?? null).toBeNull();
    expect((await as("tv2", viewer)).role).toBe("device");
  });

  it("a stale (already disconnected) screen cookie is just removed on sign-in, with no notice", async () => {
    await pair(makeCode());
    tables.devices[0].revoked_at = new Date().toISOString();
    expect(await signInHere()).toBe("/parent");
    expect(jar().has("skv_device")).toBe(false);
  });
});

describe("6. revoked screen tokens stay invalid", () => {
  it("after a parent disconnects it from their phone, and after a sign-in took it over", async () => {
    await pair(makeCode());
    const token = jar().get("skv_device")!;
    await as("phone", signInHere);
    await as("phone", async () => go(async () => (await actions()).unpairDevice(form({ deviceId: String(tables.devices[0].id) }))));
    expect((await viewer()).role).toBe("none");
    jar().set("skv_device", token);
    expect((await viewer()).role).toBe("none");
  });
});

describe("sign out", () => {
  it("signs out this browser only; the phone stays signed in", async () => {
    await as("phone", signInHere);
    await signInHere();
    expect(await go(async () => (await actions()).signOut())).toBe("/");
    expect(authCookies()).toEqual([]);
    expect((await viewer()).role).toBe("none");
    expect((await as("phone", viewer)).role).toBe("parent");
  });
});

describe("8. staging QA one-click sign-in", () => {
  const STAGING = { BF_QA_LOGIN_ENABLED: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/brightframe", NEXT_PUBLIC_SUPABASE_URL: "https://ucjleowgjelwzpjkczim.supabase.co", VERCEL_URL: "brightframe-staging-abc123-michael-charlebois-projects.vercel.app" };
  it("is off unless every staging check passes", async () => {
    const { qaLoginEnabled } = await import("@/lib/qa-login");
    expect(qaLoginEnabled(STAGING as never)).toBe(true);
    for (const k of Object.keys(STAGING)) expect(qaLoginEnabled({ ...STAGING, [k]: "x" } as never), k).toBe(false);
    expect(qaLoginEnabled({ ...STAGING, VERCEL_ENV: "production" } as never)).toBe(false);
  });
  it("on staging, it follows the same rule: a paired screen is disconnected, with the notice", async () => {
    const saved = { ...process.env }; Object.assign(process.env, STAGING);
    try {
      tables.families = [{ id: "5a000000-0000-4000-8000-000000000002", owner_user_id: PARENT }, ...tables.families];
      tables.devices = []; tables.pairing_codes = [];
      await pair(makeCode());
      const { qaSignIn } = await import("@/app/qa-login-action");
      expect(await go(() => qaSignIn(form({ family: "maya-leo" })))).toBe("/parent/devices?converted=Living%20room%20TV");
      expect(jar().has("skv_device")).toBe(false);
      expect((await viewer()).role).toBe("parent");
    } finally { process.env = saved; }
  });
});
