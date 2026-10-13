/**
 * Reviewer eval harness — the thing that tells us whether a new notes version made the
 * reviewer better or just different.
 *
 *   npm run eval -- --pin                 freeze parent-confirmed verdicts from the DB into data/eval.json
 *   npm run eval                          re-review every pinned video with the CURRENT notes, score, save a report
 *   npm run eval -- --notes none          ...with no calibration notes (the baseline)
 *   npm run eval -- --notes 3             ...with notes version 3
 *   npm run eval -- --limit 10 --concurrency 2
 *   npm run eval -- --compare data/eval-reports/a.json data/eval-reports/b.json
 *
 * Scoring per video: tag precision/recall (present vs expected), format match, age-min within ±1,
 * and whether the default-filter gate decision (would a 6-year-old's home screen show it?) matches.
 * Reports land in data/eval-reports/. Needs GEMINI_API_KEY.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db/resolve";
import { DEFAULT_SETTINGS } from "@/lib/db/store";
import { reviewVideo } from "@/lib/reviewer";
import { blockedReasons } from "@/lib/queries";
import { CONCERN_TAGS, type ConcernTag, type ContentCard, type VideoFormat, type VideoWithCard } from "@/lib/types";

const EVAL_PATH = "data/eval.json";
const REPORT_DIR = "data/eval-reports";

type EvalItem = {
  videoId: string;
  title: string;
  channel?: string;
  durationSeconds?: number;
  expected: { tags: Partial<Record<ConcernTag, boolean>>; format?: VideoFormat; ageMin?: number; gateOk?: boolean };
  source: string; // where the verdict came from
  pinnedAt: string;
};
type Score = { videoId: string; title: string; precision: number; recall: number; formatOk: boolean; ageOk: boolean; gateOk: boolean; present: ConcernTag[]; expected: ConcernTag[] };
type Report = { at: string; notesVersion: number | "none"; model: string; n: number; summary: Record<string, number>; scores: Score[] };

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const has = (f: string) => args.includes(f);

const settings = DEFAULT_SETTINGS("eval");
const gateOk = (card: ContentCard) => {
  const v = { id: card.videoId, card, confirmations: { agree: 0, flag: 0, flaggedTags: {}, overcalledTags: {} }, whitelisted: true, blockedByParent: false, dismissed: false } as unknown as VideoWithCard;
  return blockedReasons(v, settings).length === 0;
};
const presentTags = (card: ContentCard) => card.concerns.filter((c) => c.present && c.intensity >= 1).map((c) => c.tag);

async function pin() {
  const existing: EvalItem[] = existsSync(EVAL_PATH) ? JSON.parse(readFileSync(EVAL_PATH, "utf8")) : [];
  const byId = new Map(existing.map((e) => [e.videoId, e]));
  const confirmations = await db.listAllConfirmations();
  const videoIds = [...new Set(confirmations.map((c) => c.videoId))];
  const [cards, channels] = await Promise.all([db.listCards(videoIds), db.listChannels()]);
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  let added = 0, updated = 0;
  for (const videoId of videoIds) {
    const card = cardById.get(videoId);
    const video = await db.getVideo(videoId);
    if (!card || !video || (video.durationSeconds ?? 0) > 20 * 60) continue;
    // Start from what the AI said, then apply every parent's corrections (latest wins per tag).
    const tags: Partial<Record<ConcernTag, boolean>> = {};
    for (const t of CONCERN_TAGS) tags[t] = presentTags(card).includes(t);
    const mine = confirmations.filter((c) => c.videoId === videoId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let ageMin = card.ageFit.min;
    for (const c of mine) {
      for (const t of c.tags ?? []) tags[t] = true;
      for (const [t, vote] of Object.entries(c.tagVotes ?? {}) as [ConcernTag, string][]) {
        if (vote === "overcall") tags[t] = false;
        if (vote === "missed") tags[t] = true;
      }
      if (c.ageVote === "younger") ageMin = Math.max(0, card.ageFit.min - 2);
      if (c.ageVote === "older") ageMin = card.ageFit.min + 2;
    }
    const expectedCard: ContentCard = { ...card, ageFit: { ...card.ageFit, min: ageMin }, concerns: card.concerns.map((f) => ({ ...f, present: !!tags[f.tag], intensity: (tags[f.tag] ? Math.max(f.intensity, 2) : 0) as 0 | 1 | 2 | 3 })) };
    const item: EvalItem = {
      videoId, title: video.title, channel: channels.find((c) => c.id === video.channelId)?.title, durationSeconds: video.durationSeconds,
      expected: { tags, format: card.format, ageMin, gateOk: gateOk(expectedCard) },
      source: `${mine.length} parent confirmation(s): ${mine.map((c) => c.verdict).join(", ")}`,
      pinnedAt: new Date().toISOString(),
    };
    if (byId.has(videoId)) updated++; else added++;
    byId.set(videoId, item);
  }
  const out = [...byId.values()];
  writeFileSync(EVAL_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`pinned ${out.length} videos (${added} new, ${updated} updated) → ${EVAL_PATH}`);
}

async function run() {
  if (!existsSync(EVAL_PATH)) { console.error(`No ${EVAL_PATH}. Run with --pin first.`); process.exit(1); }
  let items: EvalItem[] = JSON.parse(readFileSync(EVAL_PATH, "utf8"));
  const limit = Number(flag("--limit") ?? 0);
  if (limit) items = items.slice(0, limit);
  const concurrency = Number(flag("--concurrency") ?? 2);

  const notesArg = flag("--notes");
  let notes: { version: number; notes: string } | null | undefined;
  if (notesArg === "none") notes = null;
  else if (notesArg) notes = (await db.listReviewerNotes(50)).find((n) => n.version === Number(notesArg)) ?? null;
  else notes = (await db.getReviewerNotes()) ?? null;
  const notesVersion = notes?.version ?? "none";
  console.log(`evaluating ${items.length} videos with notes ${notesVersion === "none" ? "none" : `v${notesVersion}`}…`);

  const scores: Score[] = [];
  const queue = [...items];
  let model = "";
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        const card = await reviewVideo(it.videoId, { durationSeconds: it.durationSeconds, notes, budget: "none" });
        model = card.reviewer.model;
        const present = presentTags(card);
        const expected = CONCERN_TAGS.filter((t) => it.expected.tags[t]);
        const tp = present.filter((t) => expected.includes(t)).length;
        const s: Score = {
          videoId: it.videoId, title: it.title,
          precision: present.length ? tp / present.length : expected.length ? 0 : 1,
          recall: expected.length ? tp / expected.length : 1,
          formatOk: !it.expected.format || card.format === it.expected.format,
          ageOk: it.expected.ageMin == null || Math.abs(card.ageFit.min - it.expected.ageMin) <= 1,
          gateOk: it.expected.gateOk == null || gateOk(card) === it.expected.gateOk,
          present, expected,
        };
        scores.push(s);
        console.log(`${s.gateOk ? "✓" : "✗"} ${it.title.slice(0, 50).padEnd(50)} P${s.precision.toFixed(2)} R${s.recall.toFixed(2)} ${s.formatOk ? "fmt✓" : "fmt✗"} ${s.ageOk ? "age✓" : "age✗"}`);
      } catch (e) {
        console.log(`! ${it.title.slice(0, 50)} — ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const avg = (f: (s: Score) => number) => scores.length ? scores.reduce((a, s) => a + f(s), 0) / scores.length : 0;
  const summary = {
    gateAgreement: avg((s) => +s.gateOk), tagPrecision: avg((s) => s.precision), tagRecall: avg((s) => s.recall),
    formatAgreement: avg((s) => +s.formatOk), ageAgreement: avg((s) => +s.ageOk),
  };
  const report: Report = { at: new Date().toISOString(), notesVersion, model, n: scores.length, summary, scores };
  mkdirSync(REPORT_DIR, { recursive: true });
  const file = `${REPORT_DIR}/${report.at.replace(/[:.]/g, "-")}-notes-${notesVersion}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log("\nsummary:", Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, `${Math.round(v * 100)}%`])));
  console.log(`report → ${file}`);
}

function compare(a: string, b: string) {
  const A: Report = JSON.parse(readFileSync(a, "utf8")), B: Report = JSON.parse(readFileSync(b, "utf8"));
  console.log(`A: notes ${A.notesVersion} (${A.n})   B: notes ${B.notesVersion} (${B.n})`);
  for (const k of Object.keys(A.summary)) {
    const d = (B.summary[k] - A.summary[k]) * 100;
    console.log(`${k.padEnd(18)} ${Math.round(A.summary[k] * 100)}% → ${Math.round(B.summary[k] * 100)}%  (${d >= 0 ? "+" : ""}${d.toFixed(0)})`);
  }
  const byId = new Map(A.scores.map((s) => [s.videoId, s]));
  for (const s of B.scores) {
    const prev = byId.get(s.videoId);
    if (prev && prev.gateOk !== s.gateOk) console.log(`  ${s.gateOk ? "fixed " : "broke "} ${s.title}`);
  }
}

(async () => {
  if (has("--pin")) return pin();
  if (has("--compare")) { const i = args.indexOf("--compare"); return compare(args[i + 1], args[i + 2]); }
  return run();
})().catch((e) => { console.error(e); process.exit(1); });
