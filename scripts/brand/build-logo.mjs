// Generates the Brightframe logo artwork (SVG) from geometry + the Plus Jakarta Sans ExtraBold outlines
// (SIL Open Font License — outlining for a logo is permitted). Run: node scripts/brand/build-logo.mjs
// Outputs public/brand/*.svg and src/components/brand-paths.ts (used by the React <Logo> components).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

const root = path.resolve(import.meta.dirname, "../..");
const C = { forest: "#0F3D2E", apricot: "#FF9F6E", sage: "#B7C9B1", ivory: "#FFF9F1" };

// ---- the mark: a geometric B (two bowls on a straight stem) with a play triangle set into its stem ----
// viewBox 0 0 100 112. Top bowl: circle (49,29) r25. Bottom bowl: circle (61,77) r31. Their right-side
// intersection makes the waist notch; computed, not eyeballed.
const c1 = [49, 29], r1 = 25, c2 = [61, 77], r2 = 31;
const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(r1 * r1 - a * a);
const ux = (c2[0] - c1[0]) / d, uy = (c2[1] - c1[1]) / d;
const P = [c1[0] + a * ux + h * uy, c1[1] + a * uy - h * ux].map((n) => +n.toFixed(2)); // right-hand intersection
const R = 12; // outer corner radius on the stem side
const B_PATH = `M${10 + R} 4H${c1[0]}A${r1} ${r1} 0 0 1 ${P[0]} ${P[1]}A${r2} ${r2} 0 0 1 ${c2[0]} ${c2[1] + r2}H${10 + R}A${R} ${R} 0 0 1 10 ${c2[1] + r2 - R}V${4 + R}A${R} ${R} 0 0 1 ${10 + R} 4Z`;
// Play triangle: left edge flush with the stem; corners rounded by a same-colour stroke of width 7.
const TRI = "M13.5 36L13.5 80L49 58Z";
const triEl = (fill) => `<path d="${TRI}" fill="${fill}" stroke="${fill}" stroke-width="7" stroke-linejoin="round"/>`;

// ---- the wordmark: "Brightframe" in Plus Jakarta Sans ExtraBold, outlined ----
const font = opentype.parse(readFileSync(path.join(root, "node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff")).buffer);
const SIZE = 100; // font units → px at 100px
const tracking = -0.025 * SIZE;
let x = 0; const glyphPaths = [];
const glyphs = [..."Brightframe"].map((ch) => font.charToGlyph(ch)); // per-char: no shaping needed for Latin
let y1 = 0, y2 = 0;
glyphs.forEach((g, i) => {
  const gp = g.getPath(x, 0, SIZE); const gb = gp.getBoundingBox();
  y1 = Math.min(y1, gb.y1); y2 = Math.max(y2, gb.y2);
  glyphPaths.push(gp.toPathData(2));
  x += (g.advanceWidth / font.unitsPerEm) * SIZE + tracking;
  if (i < glyphs.length - 1) x += (font.getKerningValue(g, glyphs[i + 1]) / font.unitsPerEm) * SIZE;
});
const word = glyphPaths.join("");
const box = { y1, y2 };
const capH = (font.tables.os2.sCapHeight / font.unitsPerEm) * SIZE;
const wordW = +(x - tracking).toFixed(2);

// Lockup: mark height = 1.42 × cap height, bottoms aligned with the baseline; gap = 0.30 × mark width.
const markH = +(capH * 1.42).toFixed(2), markScale = markH / 104, markW = +(82 * markScale).toFixed(2); // B spans x 10..92, y 4..108
const gap = +(markW * 0.3).toFixed(2);
const top = Math.min(box.y1, -markH); const bottom = Math.max(box.y2, 0);
const pad = 2;
const W = +(markW + gap + wordW + pad * 2).toFixed(2), H = +(bottom - top + pad * 2).toFixed(2);
const markT = `translate(${pad} ${(-top + pad - markH).toFixed(2)}) scale(${markScale.toFixed(4)}) translate(-10 -4)`;
const wordT = `translate(${(pad + markW + gap).toFixed(2)} ${(-top + pad).toFixed(2)})`;

const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;
const markBody = (b, t) => `<path d="${B_PATH}" fill="${b}"/>${triEl(t)}`;
const monoMark = (fill) => `<mask id="m"><rect width="120" height="120" fill="#fff"/>${triEl("#000")}</mask><path d="${B_PATH}" fill="${fill}" mask="url(#m)"/>`;
const lockup = (b, t, wordFill) => `<g transform="${markT}">${markBody(b, t)}</g><g transform="${wordT}"><path d="${word}" fill="${wordFill}"/></g>`;
const lockupMono = (fill) => `<defs><mask id="m" maskUnits="userSpaceOnUse"><rect x="-10" y="-10" width="140" height="140" fill="#fff"/>${triEl("#000")}</mask></defs><g transform="${markT}"><path d="${B_PATH}" fill="${fill}" mask="url(#m)"/></g><g transform="${wordT}"><path d="${word}" fill="${fill}"/></g>`;

// App icon: forest tile, ivory B, apricot play. 1024 grid, 22% corner radius; the B sits optically centred.
const icon = (bg, b, t) => {
  const s = 5.6, mx = 512 - (51 * s), my = 512 - (56 * s) ; // centre of B bbox (51,56)
  return `<rect width="1024" height="1024" rx="228" fill="${bg}"/><g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) scale(${s})">${markBody(b, t)}</g>`;
};

const out = path.join(root, "public/brand");
mkdirSync(out, { recursive: true });
const write = (name, content) => writeFileSync(path.join(out, name), content);
write("brightframe-mark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 2 90 108" role="img" aria-label="Brightframe"><title>Brightframe</title>${markBody(C.forest, C.apricot)}</svg>\n`);
write("brightframe-mark-dark.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 2 90 108" role="img" aria-label="Brightframe"><title>Brightframe</title>${markBody(C.ivory, C.apricot)}</svg>\n`);
write("brightframe-mark-mono.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 2 90 108" role="img" aria-label="Brightframe"><title>Brightframe</title>${monoMark(C.forest)}</svg>\n`);
write("brightframe-logo.svg", svg(W, H, lockup(C.forest, C.apricot, C.forest), "Brightframe"));
write("brightframe-logo-dark.svg", svg(W, H, lockup(C.ivory, C.apricot, C.ivory), "Brightframe"));
write("brightframe-logo-mono.svg", svg(W, H, lockupMono(C.forest), "Brightframe"));
write("brightframe-icon.svg", svg(1024, 1024, icon(C.forest, C.ivory, C.apricot), "Brightframe"));

// Paths for React components.
writeFileSync(path.join(root, "src/components/brand-paths.ts"), `// GENERATED by scripts/brand/build-logo.mjs — do not edit by hand.
export const B_PATH = ${JSON.stringify(B_PATH)};
export const PLAY_PATH = ${JSON.stringify(TRI)};
export const WORDMARK_PATH = ${JSON.stringify(word)};
export const LOCKUP = ${JSON.stringify({ W, H, markT, wordT })};
`);
console.log(`waist ${P}, cap ${capH.toFixed(1)}, lockup ${W}×${H}`);
