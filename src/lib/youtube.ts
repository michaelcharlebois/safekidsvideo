// YouTube helpers: URL parsing and metadata.
// Works with no API key (oEmbed) and gets richer with YOUTUBE_API_KEY (Data API v3).

export type ParsedYouTubeUrl =
  | { kind: "video"; id: string }
  | { kind: "channel"; id: string } // UC... id or @handle
  | { kind: "unknown" };

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { kind: "video", id: s };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { kind: "channel", id: s };
  if (/^@[\w.-]+$/.test(s)) return { kind: "channel", id: s };
  let url: URL;
  try {
    url = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch {
    return { kind: "unknown" };
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") return { kind: "video", id: url.pathname.slice(1).split("/")[0] };
  if (host !== "youtube.com") return { kind: "unknown" };
  const v = url.searchParams.get("v");
  if (v) return { kind: "video", id: v };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") return { kind: "video", id: parts[1] };
  if (parts[0] === "channel" && parts[1]) return { kind: "channel", id: parts[1] };
  if (parts[0]?.startsWith("@")) return { kind: "channel", id: parts[0] };
  if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return { kind: "channel", id: `@${parts[1]}` };
  return { kind: "unknown" };
}

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const thumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export type VideoMeta = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  channelHandle?: string;
  thumbnailUrl: string;
  durationSeconds?: number;
  publishedAt?: string;
};

/** No-key metadata. Channel id falls back to the @handle. */
async function oembed(videoId: string): Promise<VideoMeta | null> {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl(videoId))}&format=json`);
  if (!res.ok) return null;
  const j = (await res.json()) as { title: string; author_name: string; author_url: string; thumbnail_url: string };
  const handle = j.author_url?.split("/").filter(Boolean).pop();
  return {
    id: videoId,
    title: j.title,
    channelId: handle ?? j.author_name,
    channelTitle: j.author_name,
    channelHandle: handle?.startsWith("@") ? handle : undefined,
    thumbnailUrl: j.thumbnail_url ?? thumbnail(videoId),
  };
}

function iso8601DurationToSeconds(d: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

/** Data API metadata when YOUTUBE_API_KEY is set. */
async function dataApiVideo(videoId: string, key: string): Promise<VideoMeta | null> {
  const u = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${key}`;
  const res = await fetch(u);
  if (!res.ok) return null;
  const j = await res.json();
  const item = j.items?.[0];
  if (!item) return null;
  const sn = item.snippet;
  return {
    id: videoId,
    title: sn.title,
    channelId: sn.channelId,
    channelTitle: sn.channelTitle,
    thumbnailUrl: sn.thumbnails?.high?.url ?? thumbnail(videoId),
    durationSeconds: iso8601DurationToSeconds(item.contentDetails?.duration ?? ""),
    publishedAt: sn.publishedAt,
  };
}

export async function fetchVideoMeta(videoId: string): Promise<VideoMeta | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    const m = await dataApiVideo(videoId, key);
    if (m) return m;
  }
  return oembed(videoId);
}

/** Recent uploads for a channel (Data API only). Returns [] without a key. */
export async function fetchChannelUploads(channelIdOrHandle: string, max = 10): Promise<VideoMeta[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  const q = channelIdOrHandle.startsWith("@")
    ? `forHandle=${encodeURIComponent(channelIdOrHandle)}`
    : `id=${channelIdOrHandle}`;
  const ch = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&${q}&key=${key}`)).json();
  const c = ch.items?.[0];
  if (!c) return [];
  const uploads = c.contentDetails.relatedPlaylists.uploads;
  const pl = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploads}&maxResults=${max}&key=${key}`)).json();
  const ids: string[] = (pl.items ?? []).map((i: { snippet: { resourceId: { videoId: string } } }) => i.snippet.resourceId.videoId);
  return dataApiVideos(ids, key);
}

/** Batched metadata: up to 50 ids per request. Skips shorts-length? No — keeps everything embeddable. */
async function dataApiVideos(ids: string[], key: string): Promise<VideoMeta[]> {
  const out: VideoMeta[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${chunk.join(",")}&key=${key}`);
    if (!res.ok) continue;
    const j = await res.json();
    for (const item of j.items ?? []) {
      if (item.status?.embeddable === false) continue;
      const sn = item.snippet;
      out.push({
        id: item.id,
        title: sn.title,
        channelId: sn.channelId,
        channelTitle: sn.channelTitle,
        thumbnailUrl: sn.thumbnails?.high?.url ?? thumbnail(item.id),
        durationSeconds: iso8601DurationToSeconds(item.contentDetails?.duration ?? ""),
        publishedAt: sn.publishedAt,
      });
    }
  }
  return out;
}

export async function fetchChannelMeta(channelIdOrHandle: string): Promise<{ id: string; title: string; handle?: string; thumbnailUrl?: string; description?: string } | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return { id: channelIdOrHandle, title: channelIdOrHandle.replace(/^@/, ""), handle: channelIdOrHandle.startsWith("@") ? channelIdOrHandle : undefined };
  }
  const q = channelIdOrHandle.startsWith("@") ? `forHandle=${encodeURIComponent(channelIdOrHandle)}` : `id=${channelIdOrHandle}`;
  const j = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&${q}&key=${key}`)).json();
  const c = j.items?.[0];
  if (!c) return null;
  return { id: c.id, title: c.snippet.title, handle: c.snippet.customUrl, thumbnailUrl: c.snippet.thumbnails?.default?.url, description: c.snippet.description };
}

export type SearchHit = VideoMeta & { madeForKids: boolean };

/**
 * Kid search (Data API only). Strict safe search, embeddable, never age-restricted.
 * "Made for kids" is a COPPA flag, not a content judgment, so it's opt-in — the AI card is the gate.
 */
export async function searchKidsVideos(query: string, max = 12, kidsOnly = false): Promise<SearchHit[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !query.trim()) return [];
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.search = new URLSearchParams({
    part: "snippet", type: "video", safeSearch: "strict", videoEmbeddable: "true", videoSyndicated: "true",
    maxResults: String(Math.min(max * 2, 25)), q: query.trim(), relevanceLanguage: "en", key,
  }).toString();
  const sr = await (await fetch(u)).json();
  const ids: string[] = (sr.items ?? []).map((i: { id: { videoId: string } }) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const vr = await (await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids.join(",")}&key=${key}`,
  )).json();
  const out: SearchHit[] = [];
  for (const item of vr.items ?? []) {
    const sn = item.snippet;
    const madeForKids = !!item.status?.madeForKids;
    if (kidsOnly && !madeForKids) continue;
    if (item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") continue;
    out.push({
      id: item.id,
      title: sn.title,
      channelId: sn.channelId,
      channelTitle: sn.channelTitle,
      thumbnailUrl: sn.thumbnails?.high?.url ?? thumbnail(item.id),
      durationSeconds: iso8601DurationToSeconds(item.contentDetails?.duration ?? ""),
      publishedAt: sn.publishedAt,
      madeForKids,
    });
    if (out.length >= max) break;
  }
  return out;
}

export type ChannelHit = { id: string; title: string; handle?: string; thumbnailUrl?: string; description?: string; subscribers?: number; videoCount?: number };
export type ParentSearch = { channels: ChannelHit[]; videos: VideoMeta[] };

/**
 * Parent search: channels and videos for a free-text query, so a parent can approve
 * "Super Simple Songs" without hunting for a link. Strict safe search, embeddable only.
 */
export async function searchForParent(query: string): Promise<ParentSearch> {
  const key = process.env.YOUTUBE_API_KEY;
  const q = query.trim();
  if (!key || !q) return { channels: [], videos: [] };
  const search = (type: "channel" | "video", max: number) => {
    const u = new URL("https://www.googleapis.com/youtube/v3/search");
    u.search = new URLSearchParams({
      part: "snippet", type, safeSearch: "strict", maxResults: String(max), q, relevanceLanguage: "en", key,
      ...(type === "video" ? { videoEmbeddable: "true", videoSyndicated: "true" } : {}),
    }).toString();
    return fetch(u).then((r) => r.json());
  };
  const [cs, vs] = await Promise.all([search("channel", 6), search("video", 10)]);

  const channelIds: string[] = (cs.items ?? []).map((i: { id: { channelId: string } }) => i.id.channelId).filter(Boolean);
  let channels: ChannelHit[] = [];
  if (channelIds.length) {
    const cj = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(",")}&key=${key}`)).json();
    const byId = new Map<string, ChannelHit>();
    for (const c of cj.items ?? []) {
      byId.set(c.id, {
        id: c.id, title: c.snippet.title, handle: c.snippet.customUrl, thumbnailUrl: c.snippet.thumbnails?.default?.url,
        description: c.snippet.description, subscribers: Number(c.statistics?.subscriberCount) || undefined, videoCount: Number(c.statistics?.videoCount) || undefined,
      });
    }
    channels = channelIds.map((id) => byId.get(id)).filter((c): c is ChannelHit => !!c);
  }

  const videoIds: string[] = (vs.items ?? []).map((i: { id: { videoId: string } }) => i.id.videoId).filter(Boolean);
  const videos = videoIds.length ? await dataApiVideos(videoIds, key) : [];
  return { channels, videos };
}
