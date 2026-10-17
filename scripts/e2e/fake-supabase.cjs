/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script, run outside the app build */
// A tiny local stand-in for a Supabase project, for end-to-end tests of the real app in account mode with no
// network: the auth endpoints the app uses (verify, user, logout, token refresh) with sessions tracked on the
// "server" (so sign-out scope is real), and an in-memory PostgREST (filters eq/neq/is/in/gt/gte/lt/lte/or,
// select, order, limit; insert/update/delete with return=representation; object responses; rpc).
//   node scripts/e2e/fake-supabase.cjs <port> <state.json>
// The test reads and changes state through GET/POST /__state, and mints sign-in links with POST /__otp.
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const [, , PORT = "54400", STATE = ""] = process.argv;

const db = STATE && fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const sessions = {}; // id → { user, revoked }
const otps = {};     // token_hash or email code → user id
const log = [];      // what the auth server was asked to do
const users = { "u0000000-0000-4000-8000-000000000001": { id: "u0000000-0000-4000-8000-000000000001", email: "parent@example.com" } };

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function issue(userId, sessionId = randomUUID()) {
  sessions[sessionId] ??= { user: userId, revoked: false };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { ...users[userId], aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" },
    user_metadata: { padding: "x".repeat(4000) } }; // large enough that @supabase/ssr splits the session cookie
  return { access_token: `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: userId, session_id: sessionId, exp, aud: "authenticated", role: "authenticated" })}.sig`,
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: `${sessionId}.${randomUUID()}`, user };
}
const sessionOf = (req) => {
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  try { const p = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()); return p.session_id ? { id: p.session_id, ...sessions[p.session_id] } : null; } catch { return null; }
};

// ---- PostgREST ----
function cmp(row, col, op, val) {
  const v = row[col];
  switch (op) {
    case "eq": return String(v) === val;
    case "neq": return String(v) !== val;
    case "is": return val === "null" ? v == null : String(v) === val;
    case "in": return val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(v));
    case "gt": return v != null && String(v) > val;
    case "gte": return v != null && String(v) >= val;
    case "lt": return v != null && String(v) < val;
    case "lte": return v != null && String(v) <= val;
    default: return true; // unsupported operator: don't filter (tables in these tests are small)
  }
}
function matches(row, params) {
  for (const [k, raw] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(k)) continue;
    if (k === "or") {
      const parts = raw.replace(/^\(|\)$/g, "").split(/,(?![^()]*\))/);
      if (!parts.some((p) => { const [c, op, ...v] = p.split("."); return cmp(row, c, op, v.join(".")); })) return false;
      continue;
    }
    const neg = raw.startsWith("not.");
    const [op, ...v] = (neg ? raw.slice(4) : raw).split(".");
    const ok = cmp(row, k, op, v.join("."));
    if (neg ? ok : !ok) return false;
  }
  return true;
}
function send(res, status, body, headers = {}) { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(body === undefined ? "" : JSON.stringify(body)); }

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = ""; for await (const c of req) body += c;
  const json = body ? (() => { try { return JSON.parse(body); } catch { return null; } })() : null;
  const p = url.pathname;

  // test control
  if (p === "/__state" && req.method === "GET") return send(res, 200, { db, sessions, log });
  if (p === "/__state" && req.method === "POST") { Object.assign(db, json); return send(res, 200, {}); }
  if (p === "/__otp") { const h = randomUUID(); otps[h] = json.user; return send(res, 200, { token_hash: h }); }

  // auth
  if (p === "/auth/v1/verify" && req.method === "POST") {
    const user = otps[json?.token_hash ?? json?.token];
    log.push(["verify", !!user]);
    if (!user) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    delete otps[json.token_hash ?? json.token];
    return send(res, 200, issue(user));
  }
  if (p === "/auth/v1/user") {
    const s = sessionOf(req);
    if (!s || !s.user || s.revoked) return send(res, 401, { code: 401, msg: "session not found" });
    return send(res, 200, issue(s.user, s.id).user);
  }
  if (p === "/auth/v1/logout") {
    const s = sessionOf(req); const scope = url.searchParams.get("scope") || "global";
    log.push(["logout", scope]);
    if (s?.user) for (const [id, x] of Object.entries(sessions)) if (scope === "global" ? x.user === s.user : scope === "local" ? id === s.id : x.user === s.user && id !== s.id) x.revoked = true;
    return send(res, 204);
  }
  if (p === "/auth/v1/token") {
    const id = String(json?.refresh_token || "").split(".")[0];
    const s = sessions[id];
    if (!s || s.revoked) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    return send(res, 200, issue(s.user, id));
  }
  if (p === "/auth/v1/otp") return send(res, 200, {});
  if (p.startsWith("/auth/v1/")) return send(res, 404, { msg: "not in the fake" });

  // PostgREST
  const m = /^\/rest\/v1\/(rpc\/)?([a-z_0-9]+)$/.exec(p);
  if (!m) return send(res, 404, {});
  if (m[1]) {
    if (m[2] === "claim_pin_attempt") return send(res, 200, [{ allowed: true, seconds_left: 0 }]);
    return send(res, 200, null);
  }
  const rows = (db[m[2]] ??= []);
  const object = (req.headers.accept || "").includes("vnd.pgrst.object");
  const wantRows = (req.headers.prefer || "").includes("return=representation");
  const out = (list) => {
    if (object) return list.length === 1 ? send(res, 200, list[0]) : send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `Results contain ${list.length} rows`, hint: null });
    return send(res, req.method === "GET" || wantRows ? 200 : 201, req.method === "GET" || wantRows ? list : undefined);
  };
  const params = [...url.searchParams];
  if (req.method === "GET" || req.method === "HEAD") {
    let list = rows.filter((r) => matches(r, params));
    const order = url.searchParams.get("order");
    if (order) { const [c, dir] = order.split(",")[0].split("."); list = [...list].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
    const limit = url.searchParams.get("limit"); if (limit) list = list.slice(0, Number(limit));
    return out(list);
  }
  if (req.method === "POST") {
    const now = new Date().toISOString();
    const added = (Array.isArray(json) ? json : [json]).map((r) => ({ id: randomUUID(), created_at: now, ...r }));
    if (m[2] === "devices") for (const r of added) { r.paired_at ??= now; r.revoked_at ??= null; r.last_seen_at ??= null; r.assigned_profile_id ??= null; r.active_profile_id ??= null; }
    rows.push(...added);
    return out(added);
  }
  if (req.method === "PATCH") { const hit = rows.filter((r) => matches(r, params)); for (const r of hit) Object.assign(r, json); return out(hit); }
  if (req.method === "DELETE") { const hit = rows.filter((r) => matches(r, params)); db[m[2]] = rows.filter((r) => !hit.includes(r)); return out(hit); }
  return send(res, 405, {});
}).listen(Number(PORT), "127.0.0.1", () => console.log(`fake supabase on ${PORT}`));
