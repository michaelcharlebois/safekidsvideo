// Shared "add a YouTube thing to the database" logic, used by the app and the reviewer CLI.
import { db } from "@/lib/db/resolve";
import { fetchChannelMeta, fetchChannelUploads, fetchVideoMeta, parseYouTubeUrl, type VideoMeta } from "@/lib/youtube";
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

/** Add a channel (and, with a YouTube API key, its recent uploads). Returns stored videos. */
export async function ingestChannel(input: string, maxVideos = 5): Promise<{ channelId: string; videos: Video[] }> {
  const p = parseYouTubeUrl(input);
  if (p.kind !== "channel") throw new Error(`Not a YouTube channel URL or @handle: ${input}`);
  const meta = await fetchChannelMeta(p.id);
  if (!meta) throw new Error(`Channel not found: ${p.id}`);
  const now = new Date().toISOString();
  await db.upsertChannel({ ...meta, createdAt: (await db.getChannel(meta.id))?.createdAt ?? now });
  const uploads = await fetchChannelUploads(meta.id, maxVideos);
  const videos: Video[] = [];
  for (const u of uploads) videos.push(await saveMeta({ ...u, channelId: meta.id }));
  return { channelId: meta.id, videos };
}
