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

/** What kind of video this is — a separate axis from the concern tags. */
export const FORMATS = [
  "song",
  "story_animation",
  "educational",
  "live_action_kids",
  "gameplay_commentary",
  "unboxing_toys",
  "vlog_challenge",
  "compilation",
  "other",
] as const;
export type VideoFormat = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<VideoFormat, string> = {
  song: "Song / nursery rhyme",
  story_animation: "Story / animation",
  educational: "Educational",
  live_action_kids: "Live-action kids' show",
  gameplay_commentary: "Gameplay commentary (Minecraft, Roblox, etc.)",
  unboxing_toys: "Unboxing / toy play",
  vlog_challenge: "Vlog / challenge / prank",
  compilation: "Compilation / shorts mashup",
  other: "Other",
};

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
  format: VideoFormat;
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
  reviewer: { model: string; reviewedAt: string; version: string; revisions?: number; notesVersion?: number };
  /** Token usage and estimated cost of the review that produced this card. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
};

export type TagVote = "agree" | "overcall" | "missed";
export type ConfirmationVerdict = "agree" | "flag" | "too_strict" | "too_lenient";
export const VERDICT_LABELS: Record<ConfirmationVerdict, string> = {
  agree: "Card is accurate", flag: "Flagged something", too_strict: "Too strict", too_lenient: "Too lenient",
};

/** A parent's confirmation or correction of a card — the signal the reviewer learns from. */
export type Confirmation = {
  id: string;
  videoId: string;
  familyId: string;
  /** agree with the card; too_strict = AI flagged things that aren't a problem; too_lenient / flag = AI missed things */
  verdict: ConfirmationVerdict;
  tags?: ConcernTag[]; // legacy: tags the parent says ARE present (when flagging)
  tagVotes?: Partial<Record<ConcernTag, TagVote>>; // per-tag: agree with the AI, it over-called, or it missed this
  ageVote?: "younger" | "right" | "older"; // the AI's age range is too cautious / right / too permissive
  note?: string; // two-line review
  kidAge?: number;
  createdAt: string;
};

/** Versioned calibration guidelines distilled from parent feedback and fed back into the reviewer prompt. */
export type ReviewerNotes = {
  version: number;
  notes: string;
  stats?: FeedbackStats;
  source: "learn" | "manual";
  createdAt: string;
};
export type FeedbackStats = {
  confirmations: number;
  agree: number;
  tooStrict: number;
  tooLenient: number;
  perTag: Partial<Record<ConcernTag, { agree: number; overcall: number; missed: number }>>;
  age: { younger: number; right: number; older: number };
  since: string;
};

export type WhitelistKind = "channel" | "video" | "override" | "auto" | "block" | "dismissed";

/**
 * locked:   approved channels/videos only
 * open:     kid can search; a video plays if its card clears the family's filters (kid can trigger the AI check)
 * open_ask: kid can search; anything not already approved goes to the parent first
 */
export type FamilyMode = "locked" | "open" | "open_ask";
export const MODE_LABELS: Record<FamilyMode, { title: string; blurb: string }> = {
  locked: { title: "Locked", blurb: "Only channels and videos you approve." },
  open: { title: "Open", blurb: "Kid can search. AI checks each video against your filters; it plays if it passes, asks you if not." },
  open_ask: { title: "Open, ask first", blurb: "Kid can search, but anything new comes to you before it plays." },
};

export type WhitelistEntry = {
  familyId: string;
  /** channel: all its videos; video: this video; override: this video even if filters would hide it */
  kind: WhitelistKind;
  targetId: string;
  createdAt: string;
};

export type Plan = "trial" | "active" | "past_due" | "canceled" | "free";
/** Family-level account state: onboarding and billing. */
export type Family = {
  id: string;
  onboardedAt?: string;
  plan: Plan;
  trialEndsAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  timezone?: string; // IANA, learned from the parent's browser
};

/** A kid. Each has their own viewing mode, filters and limits; the family shares PIN + crowd threshold. */
export type Profile = {
  id: string;
  familyId: string;
  name: string;
  age?: number;
  avatar: string; // emoji
  interests: string[];
  mode: FamilyMode;
  blockedTags: ConcernTag[];
  blockedFormats: VideoFormat[];
  hideUnreviewed: boolean;
  dailyCheckLimit: number;
  kidsOnlySearch: boolean;
  dailyMinutes?: number; // screen-time limit
  bedtime?: string; // "HH:MM"
  bonusMinutes?: number; // extra minutes granted for bonusDay
  bonusDay?: string; // YYYY-MM-DD
  /** Skip budget: skips per session (undefined = off), earned back per finished video, cooldown when out, free-peek window */
  skipLimit?: number;
  skipRegen: number;
  skipCooldownSec: number;
  freePeekSec: number;
  sort: number;
  createdAt: string;
};
export const AVATARS = ["🦊", "🐼", "🦄", "🐸", "🐙", "🦖", "🐧", "🦁", "🐰", "🐢", "🚀", "🌈"];

/** Effective settings for one kid on one family: family-level fields + that kid's profile. */
export type FamilySettings = {
  familyId: string;
  profileId?: string;
  profileName?: string;
  profileAvatar?: string;
  dailyMinutes?: number;
  bedtime?: string;
  bonusMinutes?: number;
  bonusDay?: string;
  skipLimit?: number;
  skipRegen?: number;
  skipCooldownSec?: number;
  freePeekSec?: number;
  /** 4-digit PIN to exit kid mode; stored hashed in Supabase, plain in local dev */
  pinHash: string;
  kidAge?: number;
  /** hide any video where >= this many parents flagged a blocked tag */
  blockedTags: ConcernTag[];
  blockedFormats: VideoFormat[];
  flagThreshold: number;
  /** hide videos from approved channels until they have a content card */
  hideUnreviewed: boolean;
  mode: FamilyMode;
  /** kid-triggered AI checks per day */
  dailyCheckLimit: number;
  /** restrict kid search to YouTube's "made for kids" videos (narrower; off by default) */
  kidsOnlySearch: boolean;
};

/** Aggregate view the UI renders. */
export type VideoWithCard = Video & {
  channel?: Channel;
  card?: ContentCard;
  confirmations: { agree: number; flag: number; flaggedTags: Partial<Record<ConcernTag, number>>; overcalledTags: Partial<Record<ConcernTag, number>> };
  whitelisted: boolean;
  /** parent said never, for this video */
  blockedByParent: boolean;
  /** parent looked at the hidden video and chose to leave it hidden */
  dismissed: boolean;
  /** parent explicitly approved this video over their filters */
  overridden: boolean;
  /** added by a kid-triggered AI check that passed */
  autoApproved: boolean;
};

export type WatchRequest = {
  id: string;
  familyId: string;
  deviceId?: string;
  profileId?: string;
  videoId: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
};
