import { db, STORE_KIND, DEFAULT_FAMILY_ID } from "@/lib/db/resolve";
import { fetchChannelUploads } from "@/lib/youtube";
import { reviewVideo } from "@/lib/reviewer";
import type { Video } from "@/lib/types";

/**
 * The content pipeline: keep approved channels fresh and pre-reviewed.
 *  1. pull recent uploads for every approved channel (needs YOUTUBE_API_KEY)
 *  2. review the newest unreviewed videos, shortest-first bias, up to a budget
 * Runs nightly via /api/cron/sync, or on demand from the dashboard for one family.
 * Importable from scripts (no "server-only").
 */

const MAX_PIPELINE_SECONDS = 20 * 60; // don't auto-review long videos; a parent can run those by hand

export type PipelineResult = { channels: number; newVideos: number; reviewed: number; failed: number; skippedLong: number };

async function approvedChannelIds(familyId?: string): Promise<string[]> {
  if (STORE_KIND === "local") {
    const wl = await db.listWhitelist(familyId ?? DEFAULT_FAMILY_ID);
    return [...new Set(wl.filter((w) => w.kind === "channel").map((w) => w.targetId))];
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  let q = sb.from("whitelist").select("target_id").eq("kind", "channel");
  if (familyId) q = q.eq("family_id", familyId);
  const { data } = await q;
  return [...new Set((data ?? []).map((r: { target_id: string }) => r.target_id))];
}

export async function runPipeline(opts: { familyId?: string; maxReviews?: number; uploadsPerChannel?: number; log?: (s: string) => void } = {}): Promise<PipelineResult> {
  const log = opts.log ?? (() => {});
  const maxReviews = opts.maxReviews ?? 20;
  const result: PipelineResult = { channels: 0, newVideos: 0, reviewed: 0, failed: 0, skippedLong: 0 };

  const channelIds = await approvedChannelIds(opts.familyId);
  result.channels = channelIds.length;

  // 1. fresh uploads
  const now = new Date().toISOString();
  for (const channelId of channelIds) {
    if (channelId.startsWith("@")) continue; // legacy handle-keyed channel; re-approve it to upgrade
    const uploads = await fetchChannelUploads(channelId, opts.uploadsPerChannel ?? 10);
    for (const u of uploads) {
      if (await db.getVideo(u.id)) continue;
      const v: Video = { id: u.id, channelId, title: u.title, thumbnailUrl: u.thumbnailUrl, durationSeconds: u.durationSeconds, publishedAt: u.publishedAt, createdAt: now };
      await db.upsertVideo(v);
      result.newVideos++;
      log(`new: ${u.title}`);
    }
  }

  // 2. review the backlog, newest first, short ones only
  const channelSet = new Set(channelIds);
  const candidates: Video[] = [];
  for (const v of await db.listVideos()) {
    if (!channelSet.has(v.channelId)) continue;
    const card = await db.getCard(v.id);
    if (card && card.reviewer.model !== "sample") continue;
    if ((v.durationSeconds ?? 0) > MAX_PIPELINE_SECONDS) { result.skippedLong++; continue; }
    candidates.push(v);
  }
  candidates.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  for (const v of candidates.slice(0, maxReviews)) {
    try {
      log(`reviewing: ${v.title}`);
      await db.upsertCard(await reviewVideo(v.id, { durationSeconds: v.durationSeconds }));
      result.reviewed++;
    } catch (e) {
      result.failed++;
      log(`failed: ${v.title} — ${(e as Error).message}`);
    }
  }
  return result;
}
