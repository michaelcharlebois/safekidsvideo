import type {
  Channel,
  ConcernTag,
  Confirmation,
  ContentCard,
  FamilySettings,
  Video,
  WhitelistEntry,
} from "@/lib/types";

/**
 * Storage interface. Two implementations:
 *  - local: a JSON file on disk (zero setup, single family) — `data/db.json`
 *  - supabase: Postgres via Supabase (multi-family, auth, RLS)
 * Selected by env in `./index.ts`.
 */
export interface Store {
  // review database (public)
  listChannels(): Promise<Channel[]>;
  getChannel(id: string): Promise<Channel | undefined>;
  upsertChannel(c: Channel): Promise<void>;

  listVideos(opts?: { channelId?: string }): Promise<Video[]>;
  getVideo(id: string): Promise<Video | undefined>;
  upsertVideo(v: Video): Promise<void>;

  getCard(videoId: string): Promise<ContentCard | undefined>;
  listCards(videoIds: string[]): Promise<ContentCard[]>;
  upsertCard(card: ContentCard): Promise<void>;

  listConfirmations(videoIds: string[]): Promise<Confirmation[]>;
  upsertConfirmation(c: Omit<Confirmation, "id" | "createdAt">): Promise<void>;

  // family data (private)
  getSettings(familyId: string): Promise<FamilySettings>;
  saveSettings(s: FamilySettings): Promise<void>;
  listWhitelist(familyId: string): Promise<WhitelistEntry[]>;
  addToWhitelist(e: Omit<WhitelistEntry, "createdAt">): Promise<void>;
  removeFromWhitelist(familyId: string, kind: "channel" | "video", targetId: string): Promise<void>;
}

export const DEFAULT_SETTINGS = (familyId: string): FamilySettings => ({
  familyId,
  pinHash: "1234",
  kidAge: 6,
  blockedTags: ["violence", "scary_imagery", "monsters"] as ConcernTag[],
  flagThreshold: 3,
});
