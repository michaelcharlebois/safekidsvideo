// Core domain types for SafeKidsVideo.
// The review database (content cards + parent confirmations) is the product;
// YouTube is just where the video lives.

export const CONCERN_TAGS = [
  "violence",
  "scary_imagery",
  "monsters",
  "loud_or_jarring",
  "yelling_or_meanness",
  "sad_themes",
  "potty_humor",
  "ads_or_toys",
  "fast_paced",
  "unsafe_behavior",
  "romance",
  "inappropriate_language",
] as const;

export type ConcernTag = (typeof CONCERN_TAGS)[number];

export const CONCERN_LABELS: Record<ConcernTag, string> = {
  violence: "Violence / fighting",
  scary_imagery: "Scary imagery",
  monsters: "Monsters",
  loud_or_jarring: "Loud / jarring sounds",
  yelling_or_meanness: "Yelling / meanness",
  sad_themes: "Sad themes",
  potty_humor: "Potty humor",
  ads_or_toys: "Ads / toy pushing",
  fast_paced: "Frenetic pacing",
  unsafe_behavior: "Copyable unsafe behavior",
  romance: "Romance / crushes",
  inappropriate_language: "Inappropriate language",
};

export type Pace = "calm" | "moderate" | "frenetic";

export type ConcernFinding = {
  tag: ConcernTag;
  present: boolean;
  /** 0–3: 0 none, 1 mild, 2 moderate, 3 strong */
  intensity: 0 | 1 | 2 | 3;
  /** mm:ss of the clearest example, if present */
  timestamp?: string;
  /** one-line evidence a parent can verify in ten seconds */
  evidence?: string;
};

export type Channel = {
  id: string; // YouTube channel id (UC...)
  title: string;
  handle?: string; // @handle
  thumbnailUrl?: string;
  description?: string;
  createdAt: string;
};

export type Video = {
  id: string; // YouTube video id
  channelId: string;
  title: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  publishedAt?: string;
  createdAt: string;
};

/** An AI-generated review of one video. One per video (latest wins). */
export type ContentCard = {
  videoId: string;
  synopsis: string;
  /** e.g. "4–7" */
  ageFit: { min: number; max: number };
  concerns: ConcernFinding[];
  pace: Pace;
  /** 0–5 */
  educationalValue: number;
  /** 0–5, overall parent-friendliness */
  rating: number;
  parentRecommendation: string;
  /** 0–1 model confidence */
  confidence: number;
  reviewer: { model: string; reviewedAt: string; version: string };
};

/** A parent's one-tap confirmation or correction of a card. */
export type Confirmation = {
  id: string;
  videoId: string;
  familyId: string;
  /** "agree" with the AI card, or "flag" a concern the AI missed / overstated */
  verdict: "agree" | "flag";
  tags?: ConcernTag[]; // tags the parent says ARE present (when flagging)
  note?: string; // two-line review
  kidAge?: number;
  createdAt: string;
};

export type WhitelistEntry = {
  familyId: string;
  kind: "channel" | "video";
  targetId: string;
  createdAt: string;
};

export type FamilySettings = {
  familyId: string;
  /** 4-digit PIN to exit kid mode; stored hashed in Supabase, plain in local dev */
  pinHash: string;
  kidAge?: number;
  /** hide any video where >= this many parents flagged a blocked tag */
  blockedTags: ConcernTag[];
  flagThreshold: number;
};

/** Aggregate view the UI renders. */
export type VideoWithCard = Video & {
  channel?: Channel;
  card?: ContentCard;
  confirmations: { agree: number; flag: number; flaggedTags: Partial<Record<ConcernTag, number>> };
  whitelisted: boolean;
};
