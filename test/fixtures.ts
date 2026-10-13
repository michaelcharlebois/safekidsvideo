// Shared fixtures for gate tests: a family with two children and a small library.
import { DEFAULT_SETTINGS } from "@/lib/db/store";
import type { ConcernTag, ContentCard, FamilySettings, Video, VideoFormat, WhitelistEntry } from "@/lib/types";
import { CONCERN_TAGS } from "@/lib/types";

export const FAM = "fam-1";
export const MAYA = "p-maya";
export const LEO = "p-leo";

export const CH_SONGS = "UC_songs";
export const CH_SCIENCE = "UC_science";
export const CH_OTHER = "UC_other"; // not approved by the family

export function settings(over: Partial<FamilySettings> & { profileId: string }): FamilySettings {
  return {
    ...DEFAULT_SETTINGS(FAM),
    blockedTags: ["violence", "scary_imagery"],
    blockedFormats: ["gameplay_commentary"],
    flagThreshold: 3,
    ...over,
  };
}
export const maya = (o: Partial<FamilySettings> = {}) => settings({ profileId: MAYA, profileName: "Maya", kidAge: 6, mode: "open", ...o });
export const leo = (o: Partial<FamilySettings> = {}) => settings({ profileId: LEO, profileName: "Leo", kidAge: 4, mode: "locked", ...o });

export function video(id: string, channelId: string, extra: Partial<Video> = {}): Video {
  return { id, channelId, title: id, thumbnailUrl: "", durationSeconds: 300, createdAt: "2026-10-01T00:00:00Z", ...extra };
}

export function card(videoId: string, o: { model?: string; confidence?: number; ageMin?: number; ageMax?: number; format?: VideoFormat; tags?: Partial<Record<ConcernTag, number>> } = {}): ContentCard {
  return {
    videoId,
    synopsis: "s",
    format: o.format ?? "song",
    ageFit: { min: o.ageMin ?? 3, max: o.ageMax ?? 8 },
    concerns: CONCERN_TAGS.map((tag) => {
      const n = (o.tags?.[tag] ?? 0) as 0 | 1 | 2 | 3;
      return { tag, present: n > 0, intensity: n };
    }),
    pace: "calm",
    educationalValue: 3,
    rating: 4,
    parentRecommendation: "fine",
    confidence: o.confidence ?? 0.9,
    reviewer: { model: o.model ?? "gemini-test", version: "1", reviewedAt: "2026-10-01T00:00:00Z" },
  };
}

export const grant = (kind: WhitelistEntry["kind"], targetId: string, profileId: string | null = null): WhitelistEntry =>
  ({ familyId: FAM, kind, targetId, profileId, createdAt: "2026-10-01T00:00:00Z" });
