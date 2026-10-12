/**
 * Move everything in the local JSON store (data/db.json) into Supabase:
 * channels, videos, content cards, and — if exactly one family exists in Supabase —
 * the local whitelist and settings, remapped to that family.
 *
 *   npm run migrate-local
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { supabaseStore as db } from "@/lib/db/supabase";
import type { Channel, ContentCard, FamilySettings, Video, WhitelistEntry } from "@/lib/types";

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Supabase env vars are not set");
  const local = JSON.parse(readFileSync("data/db.json", "utf8")) as {
    channels: Channel[]; videos: Video[]; cards: ContentCard[]; whitelist: WhitelistEntry[]; settings: FamilySettings[];
  };

  for (const c of local.channels) await db.upsertChannel(c);
  for (const v of local.videos) await db.upsertVideo(v);
  for (const c of local.cards) await db.upsertCard(c);
  console.log(`moved ${local.channels.length} channels, ${local.videos.length} videos, ${local.cards.length} cards`);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: families } = await sb.from("families").select("id");
  if (families?.length === 1) {
    const familyId = families[0].id;
    for (const w of local.whitelist) await db.addToWhitelist({ ...w, familyId });
    const s = local.settings[0];
    if (s) {
      const current = await db.getSettings(familyId);
      await db.saveSettings({ ...current, ...s, familyId });
    }
    console.log(`remapped ${local.whitelist.length} approvals to your family`);
  } else {
    console.log(`skipped whitelist: found ${families?.length ?? 0} families (expected exactly 1)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
