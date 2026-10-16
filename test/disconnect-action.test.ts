// The Disconnect action: a parent only sees "disconnected" after revokeDevice has verified it; any failure
// sends them back with an error, and the screen stays listed as connected.
import { beforeEach, describe, expect, it, vi } from "vitest";

let impl: (fid: string, id: string) => Promise<{ name: string }> = async () => ({ name: "" });
const calls: unknown[][] = [];
const revoke = (...a: unknown[]) => { calls.push(a); return impl(a[0] as string, a[1] as string); };
vi.mock("@/lib/family", async (orig) => ({
  ...(await orig<typeof import("@/lib/family")>()),
  resolveViewer: vi.fn(async () => ({ role: "parent", familyId: "fam-1", admin: false })),
  revokeDevice: (...a: unknown[]) => revoke(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));

const where = async (deviceId: string) => {
  const { unpairDevice } = await import("@/app/actions");
  const f = new FormData(); f.set("deviceId", deviceId);
  try { await unpairDevice(f); } catch (e) { return (e as { to?: string }).to; }
  return undefined;
};

describe("unpairDevice", () => {
  beforeEach(() => { calls.length = 0; });
  it("verified revocation → the success notice, naming the screen; scoped to the parent's family", async () => {
    impl = async () => ({ name: "Living room TV" });
    expect(await where("d1")).toBe("/parent/devices?disconnected=Living%20room%20TV");
    expect(calls).toEqual([["fam-1", "d1"]]);
  });
  it("a revocation failure → an error, never the success notice", async () => {
    const { DeviceRevokeFailed } = await import("@/lib/family");
    impl = async () => { throw new DeviceRevokeFailed("Couldn't disconnect that screen. It's still connected. Try again."); };
    const to = await where("d1");
    expect(to).toMatch(/^\/parent\/devices\?error=/);
    expect(decodeURIComponent(to!)).toContain("still connected");
    expect(to).not.toContain("disconnected=");
  });
  it("an unexpected error → the same safe error", async () => {
    impl = async () => { throw new Error("socket hang up"); };
    const to = await where("d1");
    expect(decodeURIComponent(to!)).toContain("It's still connected");
    expect(to).not.toContain("socket");
  });
});
