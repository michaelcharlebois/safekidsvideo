// Shared "add a YouTube thing to the database" logic, used by the app and the reviewer CLI.
import { db } from "@/lib/db/resolve";
import { fetchChannelMeta, fetchChannelTopVideos, fetchChannelUploads, fetchVideoMeta, parseYouTubeUrl, type VideoMeta } from "@/lib/youtube";
import type { Video } from "@/lib/types";

async function saveMeta(m: VideoMeta): Promise<Video> {
  const now = new Date().toISOString();
  if (!(await db.getChannel(m.channelId))) {
    await db.upsertChannel({ id: m.channelId, title: m.channelTitle, handle: m.channelHandle, createdAt: now });
  }
  const video: Video = {
    id: m.id,
    channelId: m.channelId,
    title: m.title,
    thumbnailUrl: m.thumbnailUrl,
    durationSeconds: m.durationSeconds,
    publishedAt: m.publishedAt,
    createdAt: (await db.getVideo(m.id))?.createdAt ?? now,
  };
  await db.upsertVideo(video);
  return video;
}

/** Add one video by URL or id. Returns the stored video. */
export async function ingestVideo(input: string): Promise<Video> {
  const p = parseYouTubeUrl(input);
  if (p.kind !== "video") throw new Error(`Not a YouTube video URL: ${input}`);
  const meta = await fetchVideoMeta(p.id);
  if (!meta) throw new Error(`Could not load metadata for ${p.id} (private, removed, or wrong id?)`);
  return saveMeta(meta);
}

/**
 * Add a channel and, with a YouTube API key, seed it with its most-viewed videos plus its
 * newest uploads (top first, deduped) — the set a freshly approved channel should get reviewed.
 */
export async function ingestChannel(input: string, maxVideos = 20, maxTop = 10): Promise<{ channelId: string; videos: Video[] }> {
  const p = parseYouTubeUrl(input);
  if (p.kind !== "channel") throw new Error(`Not a YouTube channel URL or @handle: ${input}`);
  const meta = await fetchChannelMeta(p.id);
  if (!meta) throw new Error(`Channel not found: ${p.id}`);
  const now = new Date().toISOString();
  await db.upsertChannel({ ...meta, createdAt: (await db.getChannel(meta.id))?.createdAt ?? now });
  // Before a YouTube key existed, channels were stored under their @handle. Re-point those videos.
  const legacyId = meta.handle && meta.handle !== meta.id ? meta.handle : p.id.startsWith("@") ? p.id : null;
  if (legacyId && legacyId !== meta.id) {
    for (const v of await db.listVideos({ channelId: legacyId })) await db.upsertVideo({ ...v, channelId: meta.id });
  }
  const [top, uploads] = await Promise.all([fetchChannelTopVideos(meta.id, maxTop), fetchChannelUploads(meta.id, maxVideos)]);
  const seen = new Set<string>();
  const videos: Video[] = [];
  for (const u of [...top, ...uploads]) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    videos.push(await saveMeta({ ...u, channelId: meta.id }));
  }
  return { channelId: meta.id, videos };
}
