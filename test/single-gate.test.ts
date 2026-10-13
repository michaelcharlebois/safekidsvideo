// Guard rail: kid-facing code decides playability only through the central gate, always for a
// specific child. This catches a future change that re-introduces its own eligibility logic.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const kidFiles = files(path.join(ROOT, "src/app/watch"));
const actions = readFileSync(path.join(ROOT, "src/app/actions.ts"), "utf8");
const kidActionNames = ["askGrownUp", "checkVideo", "settleCheck", "nextVideo", "selectProfile"];
const kidActions = kidActionNames.map((n) => {
  const i = actions.indexOf(`function ${n}(`);
  const end = actions.indexOf("\nexport ", i + 10);
  return { n, src: actions.slice(i, end === -1 ? undefined : end) };
});

describe("one gate for kid playback", () => {
  it.each(kidFiles.map((f) => [path.relative(ROOT, f)]))("%s doesn't use family-wide flags as permission", (rel) => {
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    expect(src).not.toMatch(/\.whitelisted\b/);
    expect(src).not.toMatch(/getLibrary\(\s*[\w.]+\s*\)/); // must pass the child
    expect(src).not.toMatch(/db\.getSettings\(/); // childSettings() only — never "the first profile"
    expect(src).not.toMatch(/reviewer\.model\s*[!=]==\s*"sample"/); // review eligibility lives in the gate
  });
  it.each(kidActions.map((a) => [a.n, a.src]))("action %s is child-scoped and fails closed", (_n, src) => {
    expect(src.length).toBeGreaterThan(50);
    expect(src).not.toMatch(/\.whitelisted\b/);
    expect(src).not.toMatch(/getLibrary\(\s*[\w.]+\s*\)/);
    expect(src).toMatch(/profileId|childSettings|resolveViewer/);
  });
  it("the gate module has no I/O and is the only place review eligibility is defined", () => {
    const gate = readFileSync(path.join(ROOT, "src/lib/gate.ts"), "utf8");
    expect(gate).not.toMatch(/from "@\/lib\/db/);
    expect(gate).not.toMatch(/import "server-only"/);
    expect(gate).toMatch(/export function authorize/);
  });
});
