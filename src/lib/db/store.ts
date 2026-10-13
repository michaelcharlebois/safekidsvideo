import type {
  Channel,
  ConcernTag,
  Confirmation,
  ContentCard,
  FamilySettings,
  Profile,
  ReviewerNotes,
  Video,
  WhitelistEntry,
  WhitelistKind,
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
  listCardsSince(sinceIso: string): Promise<ContentCard[]>;
  upsertCard(card: ContentCard): Promise<void>;

  listConfirmations(videoIds: string[]): Promise<Confirmation[]>;
  listAllConfirmations(sinceIso?: string): Promise<Confirmation[]>;
  upsertConfirmation(c: Omit<Confirmation, "id" | "createdAt">): Promise<void>;

  // reviewer calibration (public, global)
  getReviewerNotes(): Promise<ReviewerNotes | undefined>;
  listReviewerNotes(limit?: number): Promise<ReviewerNotes[]>;
  saveReviewerNotes(n: Omit<ReviewerNotes, "version" | "createdAt">): Promise<ReviewerNotes>;

  // family data (private)
  /** Effective settings for a kid. No profileId → the family's first profile (created if none). */
  getSettings(familyId: string, profileId?: string): Promise<FamilySettings>;
  /** Writes family-level fields (PIN, threshold) to the family and the rest to s.profileId's profile. */
  saveSettings(s: FamilySettings): Promise<void>;
  listProfiles(familyId: string): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | undefined>;
  upsertProfile(p: Omit<Profile, "createdAt"> & { createdAt?: string }): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;
  listWhitelist(familyId: string): Promise<WhitelistEntry[]>;
  addToWhitelist(e: Omit<WhitelistEntry, "createdAt">): Promise<void>;
  removeFromWhitelist(familyId: string, kind: WhitelistKind, targetId: string): Promise<void>;
}

export const DEFAULT_PROFILE = (familyId: string, name = "My kid", age?: number): Omit<Profile, "id" | "createdAt"> => ({
  familyId, name, age, avatar: "🦊", interests: [], mode: "locked",
  blockedTags: ["violence", "scary_imagery", "monsters"] as ConcernTag[], blockedFormats: ["gameplay_commentary"],
  hideUnreviewed: true, dailyCheckLimit: 20, kidsOnlySearch: false, sort: 0,
});

/** Merge a family's shared fields with one profile into the effective settings the gate uses. */
export const mergeSettings = (family: { familyId: string; pinHash: string; flagThreshold: number }, p: Profile): FamilySettings => ({
  familyId: family.familyId, pinHash: family.pinHash, flagThreshold: family.flagThreshold,
  profileId: p.id, profileName: p.name, profileAvatar: p.avatar, kidAge: p.age,
  blockedTags: p.blockedTags, blockedFormats: p.blockedFormats, hideUnreviewed: p.hideUnreviewed, mode: p.mode,
  dailyCheckLimit: p.dailyCheckLimit, kidsOnlySearch: p.kidsOnlySearch, dailyMinutes: p.dailyMinutes, bedtime: p.bedtime,
});

export const DEFAULT_SETTINGS = (familyId: string): FamilySettings => ({
  familyId,
  pinHash: "1234",
  kidAge: 6,
  blockedTags: ["violence", "scary_imagery", "monsters"] as ConcernTag[],
  blockedFormats: ["gameplay_commentary"],
  flagThreshold: 3,
  hideUnreviewed: true,
  mode: "locked",
  dailyCheckLimit: 20,
  kidsOnlySearch: false,
});
