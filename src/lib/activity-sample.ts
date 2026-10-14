// DESIGN PREVIEW ONLY. Labelled sample viewing for Activity on a deployment that records nothing (local
// mode), shown only when BRIGHTFRAME_SAMPLE_ACTIVITY=1 and always under a "Sample data" notice. Never used
// when real viewing is recorded. Deterministic, so screenshots are repeatable.
import type { KidDay, WatchEvent } from "@/lib/checkin";
import { CONCERN_TAGS, type Channel, type ContentCard, type Video, type VideoFormat } from "@/lib/types";

const CH: Channel[] = [
  { id: "sample-songs", title: "Sample Songs", createdAt: "" } as Channel,
  { id: "sample-science", title: "Sample Science", createdAt: "" } as Channel,
  { id: "sample-stories", title: "Sample Stories", createdAt: "" } as Channel,
];
const V: [string, string, number, VideoFormat, "calm" | "moderate" | "frenetic"][] = [
  ["sampleA0001", "Counting to Ten", 180, "song", "calm"],
  ["sampleA0002", "The Weather Song", 200, "song", "moderate"],
  ["sampleB0001", "Why Leaves Change Colour", 360, "educational", "calm"],
  ["sampleB0002", "How Volcanoes Work", 420, "educational", "moderate"],
  ["sampleC0001", "The Sleepy Owl", 600, "story_animation", "calm"],
  ["sampleC0002", "A Big Day at the Fair", 540, "live_action_kids", "frenetic"],
];
const chOf = (id: string) => (id.startsWith("sampleA") ? "sample-songs" : id.startsWith("sampleB") ? "sample-science" : "sample-stories");

export function sampleActivity(profileId: string, now: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const videos: Video[] = V.map(([id, title, sec]) => ({ id, title, channelId: chOf(id), durationSeconds: sec, createdAt: "" } as Video));
  const cards: ContentCard[] = V.map(([id, , , format, pace]) => ({
    videoId: id, synopsis: "", format, pace, ageFit: { min: 3, max: 8 }, educationalValue: 3, rating: 4, parentRecommendation: "", confidence: 0.9,
    concerns: CONCERN_TAGS.map((tag) => ({ tag, present: false, intensity: 0 as const })), reviewer: { model: "sample", version: "2", reviewedAt: "" },
  }) as unknown as ContentCard);
  const events: WatchEvent[] = [];
  const checkins: KidDay[] = [];
  for (let d = 34; d >= 0; d--) {
    const dayStart = now - d * 86_400_000;
    if (rnd() < 0.2) continue; // some days without video
    const n = 1 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const v = V[Math.floor(rnd() * V.length)];
      const at = new Date(dayStart - (2 + Math.floor(rnd() * 9)) * 3600_000 - i * 900_000).toISOString();
      const completed = rnd() > 0.3;
      events.push({ videoId: v[0], profileId, startedAt: at, completed });
      if (!completed && rnd() > 0.5) events.push({ videoId: v[0], profileId, startedAt: new Date(Date.parse(at) + 60_000).toISOString(), completed: false, outcome: "skipped" });
    }
  }
  return { events, videos, cards: cards.map((c) => ({ ...c, reviewer: { ...c.reviewer, model: "sample-preview" } })), channels: CH, checkins };
}
