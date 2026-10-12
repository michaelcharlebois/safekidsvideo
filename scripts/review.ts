/**
 * AI reviewer CLI.
 *
 *   npm run review -- https://www.youtube.com/watch?v=XqZsoesa55w https://youtu.be/...
 *   npm run review -- --channel @SuperSimpleSongs --max 5      (needs YOUTUBE_API_KEY)
 *   npm run review -- --file urls.txt                            (one URL per line, # comments ok)
 *   npm run review -- --all                                      (re-review every video without a real card)
 *   npm run review -- --force <url>                              (re-review even if a card exists)
 *
 * Needs GEMINI_API_KEY. Writes to Supabase if configured, else data/db.json.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "node:fs";
import { db, STORE_KIND } from "@/lib/db/resolve";
import { ingestChannel, ingestVideo } from "@/lib/ingest";
import { reviewVideo } from "@/lib/reviewer";
import { CONCERN_LABELS, type ContentCard, type Video } from "@/lib/types";

function parseArgs(argv: string[]) {
  const o = { urls: [] as string[], channels: [] as string[], max: 5, all: false, force: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--channel") o.channels.push(argv[++i]);
    else if (a === "--max") o.max = +argv[++i];
    else if (a === "--file") {
      o.urls.push(
        ...readFileSync(argv[++i], "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#")),
      );
    } else if (a === "--all") o.all = true;
    else if (a === "--force") o.force = true;
    else if (a === "--dry") o.dry = true;
    else o.urls.push(a);
  }
  return o;
}

function printCard(v: Video, c: ContentCard) {
  const present = c.concerns.filter((x) => x.present);
  console.log(`\n━━━ ${v.title}  (${v.id})`);
  console.log(`  ${c.synopsis}`);
  console.log(`  Age ${c.ageFit.min}–${c.ageFit.max} · pace: ${c.pace} · rating ${c.rating}/5 · educational ${c.educationalValue}/5 · confidence ${Math.round(c.confidence * 100)}%`);
  if (present.length) {
    console.log("  Concerns:");
    for (const p of present) console.log(`    • ${CONCERN_LABELS[p.tag]} [${p.intensity}/3] ${p.timestamp ?? ""} — ${p.evidence ?? ""}`);
  } else console.log("  Concerns: none found");
  console.log(`  Parent take: ${c.parentRecommendation}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`store: ${STORE_KIND}`);

  const videos: Video[] = [];
  for (const u of args.urls) {
    try {
      videos.push(await ingestVideo(u));
    } catch (e) {
      console.error(`skip ${u}: ${(e as Error).message}`);
    }
  }
  for (const ch of args.channels) {
    const { videos: vs } = await ingestChannel(ch, args.max);
    if (!vs.length) console.error(`no uploads fetched for ${ch} (set YOUTUBE_API_KEY to pull channel uploads)`);
    videos.push(...vs);
  }
  if (args.all) {
    for (const v of await db.listVideos()) {
      const card = await db.getCard(v.id);
      if (!card || card.reviewer.model === "sample") videos.push(v);
    }
  }
  if (!videos.length) {
    console.error("Nothing to review. Pass URLs, --channel, --file, or --all.");
    process.exit(1);
  }

  let ok = 0;
  for (const v of videos) {
    const existing = await db.getCard(v.id);
    if (existing && existing.reviewer.model !== "sample" && !args.force) {
      console.log(`have card for ${v.id} (${v.title}); use --force to redo`);
      continue;
    }
    if (args.dry) {
      console.log(`would review ${v.id} ${v.title}`);
      continue;
    }
    process.stdout.write(`reviewing ${v.id} ${v.title} … `);
    try {
      const card = await reviewVideo(v.id, { durationSeconds: v.durationSeconds });
      await db.upsertCard(card);
      ok++;
      console.log("done");
      printCard(v, card);
    } catch (e) {
      console.log("FAILED");
      console.error(`  ${(e as Error).message}`);
    }
  }
  console.log(`\n${ok}/${videos.length} reviewed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
