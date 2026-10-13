import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Channel, Confirmation, ContentCard, ReviewerNotes, Video } from "@/lib/types";
import { DEFAULT_SETTINGS, type Store } from "./store";

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
  async upsertCard(c) {
    must(await client().from("content_cards").upsert({
      video_id: c.videoId, synopsis: c.synopsis, format: c.format, age_min: c.ageFit.min, age_max: c.ageFit.max, concerns: c.concerns,
      pace: c.pace, educational_value: c.educationalValue, rating: c.rating, parent_recommendation: c.parentRecommendation,
      confidence: c.confidence, reviewer_model: c.reviewer.model, reviewer_version: c.reviewer.version,
      reviewed_at: c.reviewer.reviewedAt, revisions: c.reviewer.revisions ?? 0, notes_version: c.reviewer.notesVersion ?? null,
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

  async getSettings(familyId) {
    const d = must<any>(await client().from("families").select("*").eq("id", familyId).maybeSingle());
    if (!d) return DEFAULT_SETTINGS(familyId);
    return { familyId: d.id, pinHash: d.pin_hash, kidAge: d.kid_age ?? undefined, blockedTags: d.blocked_tags, blockedFormats: d.blocked_formats ?? [], flagThreshold: d.flag_threshold, hideUnreviewed: d.hide_unreviewed ?? true, mode: d.mode ?? "locked", dailyCheckLimit: d.daily_check_limit ?? 20, kidsOnlySearch: d.kids_only_search ?? false };
  },
  async saveSettings(s) {
    must(await client().from("families").upsert({
      id: s.familyId, pin_hash: s.pinHash, kid_age: s.kidAge, blocked_tags: s.blockedTags, blocked_formats: s.blockedFormats, flag_threshold: s.flagThreshold, hide_unreviewed: s.hideUnreviewed, mode: s.mode, daily_check_limit: s.dailyCheckLimit, kids_only_search: s.kidsOnlySearch,
    }));
  },
  async listWhitelist(familyId) {
    return must(await client().from("whitelist").select("*").eq("family_id", familyId)).map((r: any) => ({
      familyId: r.family_id, kind: r.kind, targetId: r.target_id, createdAt: r.created_at,
    }));
  },
  async addToWhitelist(e) {
    must(await client().from("whitelist").upsert({ family_id: e.familyId, kind: e.kind, target_id: e.targetId }));
  },
  async removeFromWhitelist(familyId, kind, targetId) {
    must(await client().from("whitelist").delete().match({ family_id: familyId, kind, target_id: targetId }));
  },
};
