import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Channel, Confirmation, ContentCard, LegacyGrant, Profile, ReviewerNotes, Video } from "@/lib/types";
import { DEFAULT_PROFILE, mergeSettings, type ProfileSettingsPatch, type Store } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Server-side only (Next.js server + scripts). Secret key bypasses RLS; callers scope by family id.
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const toChannel = (r: any): Channel => ({
  id: r.id, title: r.title, handle: r.handle ?? undefined, thumbnailUrl: r.thumbnail_url ?? undefined,
  description: r.description ?? undefined, createdAt: r.created_at,
});
const toVideo = (r: any): Video => ({
  id: r.id, channelId: r.channel_id, title: r.title, thumbnailUrl: r.thumbnail_url ?? undefined,
  durationSeconds: r.duration_seconds ?? undefined, publishedAt: r.published_at ?? undefined, createdAt: r.created_at,
});
const toCard = (r: any): ContentCard => ({
  videoId: r.video_id, synopsis: r.synopsis, format: r.format ?? "other", ageFit: { min: r.age_min, max: r.age_max }, concerns: r.concerns,
  pace: r.pace, educationalValue: Number(r.educational_value), rating: Number(r.rating),
  parentRecommendation: r.parent_recommendation, confidence: Number(r.confidence),
  reviewer: { model: r.reviewer_model, version: r.reviewer_version, reviewedAt: r.reviewed_at, revisions: r.revisions ?? 0, notesVersion: r.notes_version ?? undefined },
  usage: r.input_tokens != null ? { inputTokens: r.input_tokens, outputTokens: r.output_tokens ?? 0, costUsd: Number(r.cost_usd ?? 0) } : undefined,
});
const toProfile = (r: any): Profile => ({
  id: r.id, familyId: r.family_id, name: r.name, age: r.age ?? undefined, avatar: r.avatar ?? "🦊", interests: r.interests ?? [],
  mode: r.mode ?? "locked", blockedTags: r.blocked_tags ?? [], blockedFormats: r.blocked_formats ?? [], hideUnreviewed: r.hide_unreviewed ?? true,
  dailyCheckLimit: r.daily_check_limit ?? 20, kidsOnlySearch: r.kids_only_search ?? false, dailyMinutes: r.daily_minutes ?? undefined,
  bedtime: r.bedtime ?? undefined, bonusMinutes: r.bonus_minutes ?? 0, bonusDay: r.bonus_day ?? undefined,
  skipLimit: r.skip_limit ?? undefined, skipRegen: r.skip_regen ?? 1, skipCooldownSec: r.skip_cooldown_sec ?? 120, freePeekSec: r.free_peek_sec ?? 30,
  channelOrder: r.channel_order ?? [], boosts: r.boosts ?? {},
  sort: r.sort ?? 0, createdAt: r.created_at,
});
const fromProfile = (p: Omit<Profile, "createdAt"> & { createdAt?: string }) => ({
  ...(p.id ? { id: p.id } : {}), family_id: p.familyId, name: p.name, age: p.age ?? null, avatar: p.avatar, interests: p.interests,
  mode: p.mode, blocked_tags: p.blockedTags, blocked_formats: p.blockedFormats, hide_unreviewed: p.hideUnreviewed,
  daily_check_limit: p.dailyCheckLimit, kids_only_search: p.kidsOnlySearch, daily_minutes: p.dailyMinutes ?? null, bedtime: p.bedtime ?? null,
  bonus_minutes: p.bonusMinutes ?? 0, bonus_day: p.bonusDay ?? null,
  skip_limit: p.skipLimit ?? null, skip_regen: p.skipRegen ?? 1, skip_cooldown_sec: p.skipCooldownSec ?? 120, free_peek_sec: p.freePeekSec ?? 30,
  channel_order: p.channelOrder ?? [], boosts: p.boosts ?? {}, sort: p.sort,
});
const toLegacy = (r: any): LegacyGrant => ({
  id: r.id, familyId: r.family_id, kind: r.kind, targetId: r.target_id, createdAt: r.created_at,
  candidateProfileIds: r.candidate_profile_ids ?? [], resolvedAt: r.resolved_at ?? undefined, resolution: r.resolution ?? undefined,
});
const toNotes = (r: any): ReviewerNotes => ({ version: r.version, notes: r.notes, stats: r.stats ?? undefined, source: r.source, createdAt: r.created_at });
const toConfirmation = (r: any): Confirmation => ({
  id: r.id, videoId: r.video_id, familyId: r.family_id, verdict: r.verdict, tags: r.tags ?? undefined,
  tagVotes: r.tag_votes ?? undefined, ageVote: r.age_vote ?? undefined,
  note: r.note ?? undefined, kidAge: r.kid_age ?? undefined, createdAt: r.created_at,
});

function must<T>(res: { data: T | null; error: any }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const supabaseStore: Store = {
  async listChannels() {
    return must(await client().from("channels").select("*").order("title")).map(toChannel);
  },
  async getChannel(id) {
    const d = must(await client().from("channels").select("*").eq("id", id).maybeSingle());
    return d ? toChannel(d) : undefined;
  },
  async upsertChannel(c) {
    must(await client().from("channels").upsert({
      id: c.id, title: c.title, handle: c.handle, thumbnail_url: c.thumbnailUrl, description: c.description,
    }));
  },

  async listVideos(opts) {
    let q = client().from("videos").select("*").order("title");
    if (opts?.channelId) q = q.eq("channel_id", opts.channelId);
    return must(await q).map(toVideo);
  },
  async getVideo(id) {
    const d = must(await client().from("videos").select("*").eq("id", id).maybeSingle());
    return d ? toVideo(d) : undefined;
  },
  async upsertVideo(v) {
    must(await client().from("videos").upsert({
      id: v.id, channel_id: v.channelId, title: v.title, thumbnail_url: v.thumbnailUrl,
      duration_seconds: v.durationSeconds, published_at: v.publishedAt,
    }));
  },

  async getCard(videoId) {
    const d = must(await client().from("content_cards").select("*").eq("video_id", videoId).maybeSingle());
    return d ? toCard(d) : undefined;
  },
  async listCards(videoIds) {
    if (!videoIds.length) return [];
    return must(await client().from("content_cards").select("*").in("video_id", videoIds)).map(toCard);
  },
  async listCardsSince(sinceIso) {
    return must(await client().from("content_cards").select("*").gte("reviewed_at", sinceIso).limit(5000)).map(toCard);
  },
  async upsertCard(c) {
    must(await client().from("content_cards").upsert({
      video_id: c.videoId, synopsis: c.synopsis, format: c.format, age_min: c.ageFit.min, age_max: c.ageFit.max, concerns: c.concerns,
      pace: c.pace, educational_value: c.educationalValue, rating: c.rating, parent_recommendation: c.parentRecommendation,
      confidence: c.confidence, reviewer_model: c.reviewer.model, reviewer_version: c.reviewer.version,
      reviewed_at: c.reviewer.reviewedAt, revisions: c.reviewer.revisions ?? 0, notes_version: c.reviewer.notesVersion ?? null,
      input_tokens: c.usage?.inputTokens ?? null, output_tokens: c.usage?.outputTokens ?? null, cost_usd: c.usage?.costUsd ?? null,
    }));
  },

  async listConfirmations(videoIds) {
    if (!videoIds.length) return [];
    return must(await client().from("confirmations").select("*").in("video_id", videoIds)).map(toConfirmation);
  },
  async listAllConfirmations(sinceIso) {
    let q = client().from("confirmations").select("*").order("created_at", { ascending: false }).limit(2000);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return must(await q).map(toConfirmation);
  },
  async upsertConfirmation(c) {
    must(await client().from("confirmations").upsert(
      { video_id: c.videoId, family_id: c.familyId, verdict: c.verdict, tags: c.tags, tag_votes: c.tagVotes ?? {}, age_vote: c.ageVote ?? null, note: c.note, kid_age: c.kidAge, created_at: new Date().toISOString() },
      { onConflict: "video_id,family_id" },
    ));
  },
  async getReviewerNotes() {
    const d = must<any>(await client().from("reviewer_notes").select("*").order("version", { ascending: false }).limit(1).maybeSingle());
    return d ? toNotes(d) : undefined;
  },
  async listReviewerNotes(limit = 10) {
    return must(await client().from("reviewer_notes").select("*").order("version", { ascending: false }).limit(limit)).map(toNotes);
  },
  async saveReviewerNotes(n) {
    const latest = await this.getReviewerNotes();
    const version = (latest?.version ?? 0) + 1;
    const d = must<any>(await client().from("reviewer_notes").insert({ version, notes: n.notes, stats: n.stats ?? null, source: n.source }).select("*").single());
    return toNotes(d);
  },

  async getSettings(familyId, profileId) {
    const d = must<any>(await client().from("families").select("id,pin_hash,flag_threshold,kid_age").eq("id", familyId).maybeSingle());
    const fam = { familyId, pinHash: d?.pin_hash ?? "1234", flagThreshold: d?.flag_threshold ?? 3 };
    let profiles = await this.listProfiles(familyId);
    if (!profiles.length) profiles = [await this.upsertProfile({ ...DEFAULT_PROFILE(familyId, "My kid", d?.kid_age ?? 6), id: "" })];
    const p = profiles.find((x) => x.id === profileId) ?? profiles[0];
    return mergeSettings(fam, p);
  },
  async saveSettings(s) {
    must(await client().from("families").update({ pin_hash: s.pinHash, flag_threshold: s.flagThreshold }).eq("id", s.familyId));
    if (s.profileId) {
      must(await client().from("profiles").update({
        age: s.kidAge ?? null, mode: s.mode, blocked_tags: s.blockedTags, blocked_formats: s.blockedFormats, hide_unreviewed: s.hideUnreviewed,
        daily_check_limit: s.dailyCheckLimit, kids_only_search: s.kidsOnlySearch, daily_minutes: s.dailyMinutes ?? null, bedtime: s.bedtime ?? null,
        skip_limit: s.skipLimit ?? null, skip_regen: s.skipRegen ?? 1, skip_cooldown_sec: s.skipCooldownSec ?? 120, free_peek_sec: s.freePeekSec ?? 30,
        boosts: s.boosts ?? {},
      }).eq("id", s.profileId).eq("family_id", s.familyId));
    }
  },
  async updateProfileSettings(familyId, profileId, patch) {
    const row = profilePatchToColumns(patch);
    if (!Object.keys(row).length) return;
    // .select() so a missing / other-family profile is detected (zero rows) instead of silently ignored.
    const d = must<any[]>(await client().from("profiles").update(row).eq("id", profileId).eq("family_id", familyId).select("id"));
    if (!d.length) throw new Error("That child isn't in this family");
  },
  async updateFamilySettings(familyId, patch) {
    const row: Record<string, unknown> = {};
    if (patch.pinHash) row.pin_hash = patch.pinHash;
    if (patch.flagThreshold) row.flag_threshold = patch.flagThreshold;
    if (!Object.keys(row).length) return;
    must(await client().from("families").update(row).eq("id", familyId));
  },
  async getFamily(familyId) {
    const d = must<any>(await client().from("families").select("id,onboarded_at,plan,trial_ends_at,stripe_customer_id,stripe_subscription_id,timezone").eq("id", familyId).maybeSingle());
    return {
      id: familyId, onboardedAt: d?.onboarded_at ?? undefined, plan: d?.plan ?? "trial", trialEndsAt: d?.trial_ends_at ?? undefined,
      stripeCustomerId: d?.stripe_customer_id ?? undefined, stripeSubscriptionId: d?.stripe_subscription_id ?? undefined, timezone: d?.timezone ?? undefined,
    };
  },
  async updateFamily(familyId, patch) {
    const row: Record<string, unknown> = {};
    if ("onboardedAt" in patch) row.onboarded_at = patch.onboardedAt ?? null;
    if ("plan" in patch) row.plan = patch.plan;
    if ("trialEndsAt" in patch) row.trial_ends_at = patch.trialEndsAt ?? null;
    if ("stripeCustomerId" in patch) row.stripe_customer_id = patch.stripeCustomerId ?? null;
    if ("stripeSubscriptionId" in patch) row.stripe_subscription_id = patch.stripeSubscriptionId ?? null;
    if (Object.keys(row).length) must(await client().from("families").update(row).eq("id", familyId));
  },
  async listProfiles(familyId) {
    return must(await client().from("profiles").select("*").eq("family_id", familyId).order("sort").order("created_at")).map(toProfile);
  },
  async getProfile(id) {
    const d = must<any>(await client().from("profiles").select("*").eq("id", id).maybeSingle());
    return d ? toProfile(d) : undefined;
  },
  async upsertProfile(p) {
    const d = must<any>(await client().from("profiles").upsert(fromProfile(p)).select("*").single());
    return toProfile(d);
  },
  async deleteProfile(id) {
    must(await client().from("profiles").delete().eq("id", id));
  },
  async listWhitelist(familyId) {
    return must(await client().from("whitelist").select("*").eq("family_id", familyId)).map((r: any) => ({
      familyId: r.family_id, profileId: r.profile_id ?? null, kind: r.kind, targetId: r.target_id, createdAt: r.created_at,
    }));
  },
  async addToWhitelist(e) {
    // Unique (family_id, kind, target_id, profile_id) NULLS NOT DISTINCT; the composite FK rejects a child from another family.
    must(await client().from("whitelist").upsert(
      { family_id: e.familyId, kind: e.kind, target_id: e.targetId, profile_id: e.profileId ?? null },
      { onConflict: "family_id,kind,target_id,profile_id", ignoreDuplicates: true },
    ));
  },
  async removeFromWhitelist(familyId, kind, targetId, profileId = null) {
    let q = client().from("whitelist").delete().match({ family_id: familyId, kind, target_id: targetId });
    q = profileId ? q.eq("profile_id", profileId) : q.is("profile_id", null);
    must(await q);
  },
  async listLegacyGrants(familyId) {
    return must(await client().from("legacy_grants").select("*").eq("family_id", familyId).is("resolved_at", null).order("created_at")).map(toLegacy);
  },
  async resolveLegacyGrant(familyId, id, resolution) {
    const d = must<any>(await client().from("legacy_grants").update({ resolved_at: new Date().toISOString(), resolution })
      .eq("id", id).eq("family_id", familyId).select("*").maybeSingle());
    return d ? toLegacy(d) : undefined;
  },
};

/** Profile settings patch → profiles columns. Only keys present in the patch; undefined clears (null). */
export function profilePatchToColumns(patch: ProfileSettingsPatch): Record<string, unknown> {
  const cols: Record<keyof ProfileSettingsPatch, string> = {
    mode: "mode", kidsOnlySearch: "kids_only_search", dailyCheckLimit: "daily_check_limit", blockedTags: "blocked_tags",
    blockedFormats: "blocked_formats", age: "age", dailyMinutes: "daily_minutes", bedtime: "bedtime", skipLimit: "skip_limit",
    skipRegen: "skip_regen", skipCooldownSec: "skip_cooldown_sec", freePeekSec: "free_peek_sec", boosts: "boosts",
  };
  const row: Record<string, unknown> = {};
  for (const k of Object.keys(patch) as (keyof ProfileSettingsPatch)[]) {
    if (k in cols) row[cols[k]] = patch[k] ?? null;
  }
  return row;
}
