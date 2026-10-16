// What the real supabase-js client sends for the screen-management writes (fetch captured, no network).
// Also pins down the original bug: an un-awaited PostgREST builder never sends its request.
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

function client() {
  const sent: { method: string; url: URL; body: unknown }[] = [];
  const sb = createClient("https://staging-ref.supabase.co", "sb_secret_test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", url: new URL(String(input)), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch },
  });
  return { sb, sent };
}

describe("PostgREST requests", () => {
  it("an un-awaited update is never sent (why `void supabaseAdmin()...update()` didn't record activity)", async () => {
    const { sb, sent } = client();
    void sb.from("devices").update({ last_seen_at: "x" }).eq("id", "d1");
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(0);
  });

  it("the activity update: PATCH, scoped to the screen, its family, not revoked, and only when stale", async () => {
    const { sb, sent } = client();
    const stale = "2026-10-16T02:55:00.000Z";
    await sb.from("devices").update({ last_seen_at: "2026-10-16T03:00:00.000Z" })
      .match({ id: "d1", family_id: "f1" }).is("revoked_at", null).or(`last_seen_at.is.null,last_seen_at.lt.${stale}`);
    expect(sent).toHaveLength(1);
    const q = sent[0].url.searchParams;
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].url.pathname).toBe("/rest/v1/devices");
    expect(q.get("id")).toBe("eq.d1");
    expect(q.get("family_id")).toBe("eq.f1");
    expect(q.get("revoked_at")).toBe("is.null");
    expect(q.get("or")).toBe(`(last_seen_at.is.null,last_seen_at.lt.${stale})`);
    expect(sent[0].body).toEqual({ last_seen_at: "2026-10-16T03:00:00.000Z" });
  });

  it("the revoke: PATCH scoped to the family and still-connected row, returning what changed", async () => {
    const { sb, sent } = client();
    await sb.from("devices").update({ revoked_at: "t" }).match({ id: "d1", family_id: "f1" }).is("revoked_at", null).select("id,name");
    const q = sent[0].url.searchParams;
    expect([sent[0].method, q.get("id"), q.get("family_id"), q.get("revoked_at"), q.get("select")]).toEqual(["PATCH", "eq.d1", "eq.f1", "is.null", "id,name"]);
  });
});
