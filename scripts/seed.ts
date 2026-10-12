/**
 * Load data/seed.json into the configured store (useful once Supabase is set up;
 * the local JSON store seeds itself automatically on first run).
 *
 *   npm run seed
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "node:fs";
import { db, STORE_KIND } from "@/lib/db/resolve";
import type { Channel, ContentCard, Video, WhitelistEntry } from "@/lib/types";

async function main() {
  const seed = JSON.parse(readFileSync("data/seed.json", "utf8")) as {
    channels: Channel[]; videos: Video[]; cards: ContentCard[]; whitelist: WhitelistEntry[];
  };
  console.log(`store: ${STORE_KIND}`);
  for (const c of seed.channels) await db.upsertChannel(c);
  for (const v of seed.videos) await db.upsertVideo(v);
  for (const c of seed.cards) await db.upsertCard(c);
  // The sample whitelist belongs to the local default family; real families approve their own.
  if (STORE_KIND === "local") for (const w of seed.whitelist) await db.addToWhitelist(w);
  console.log(`seeded ${seed.channels.length} channels, ${seed.videos.length} videos, ${seed.cards.length} cards`);
}

main().catch((e) => { console.error(e); process.exit(1); });
