import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Channel, Confirmation, ContentCard, Family, FamilySettings, Profile, ReviewerNotes, Video, WhitelistEntry } from "@/lib/types";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, mergeSettings, type Store } from "./store";

type Db = {
  channels: Channel[];
  videos: Video[];
  cards: ContentCard[];
  confirmations: Confirmation[];
  reviewerNotes?: ReviewerNotes[];
  whitelist: WhitelistEntry[];
  settings: FamilySettings[];
  profiles?: Profile[];
  families?: Family[];
};

const DB_PATH = path.join(process.cwd(), "data", "db.json");
const SEED_PATH = path.join(process.cwd(), "data", "seed.json");

const empty = (): Db => ({ channels: [], videos: [], cards: [], confirmations: [], whitelist: [], settings: [] });

let cache: Db | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Db> {
  if (cache) return cache;
  let db: Db;
  try {
    db = { ...empty(), ...JSON.parse(await fs.readFile(DB_PATH, "utf8")) };
  } catch {
    // First run: start from the seed file if present.
    try {
      db = { ...empty(), ...JSON.parse(await fs.readFile(SEED_PATH, "utf8")) };
    } catch {
      db = empty();
    }
    await persist(db);
  }
  cache = db;
  return db;
}

async function persist(db: Db) {
  writing = writing.then(async () => {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
  });
  return writing;
}

function upsertBy<T>(arr: T[], item: T, key: (t: T) => string) {
  const i = arr.findIndex((x) => key(x) === key(item));
  if (i >= 0) arr[i] = item;
  else arr.push(item);
}

export const localStore: Store = {
  async listChannels() {
    return (await load()).channels;
  },
  async getChannel(id) {
    return (await load()).channels.find((c) => c.id === id);
  },
  async upsertChannel(c) {
    const db = await load();
    upsertBy(db.channels, c, (x) => x.id);
    await persist(db);
  },

  async listVideos(opts) {
    const db = await load();
    return opts?.channelId ? db.videos.filter((v) => v.channelId === opts.channelId) : db.videos;
  },
  async getVideo(id) {
    return (await load()).videos.find((v) => v.id === id);
  },
  async upsertVideo(v) {
    const db = await load();
    upsertBy(db.videos, v, (x) => x.id);
    await persist(db);
  },

  async getCard(videoId) {
    return (await load()).cards.find((c) => c.videoId === videoId);
  },
  async listCards(videoIds) {
    const set = new Set(videoIds);
    return (await load()).cards.filter((c) => set.has(c.videoId));
  },
  async listCardsSince(sinceIso) {
    return (await load()).cards.filter((c) => c.reviewer.reviewedAt >= sinceIso);
  },
  async upsertCard(card) {
    const db = await load();
    upsertBy(db.cards, card, (x) => x.videoId);
    await persist(db);
  },

  async listConfirmations(videoIds) {
    const set = new Set(videoIds);
    return (await load()).confirmations.filter((c) => set.has(c.videoId));
  },
  async listAllConfirmations(sinceIso) {
    return (await load()).confirmations.filter((c) => !sinceIso || c.createdAt >= sinceIso);
  },
  async getReviewerNotes() {
    const all = (await load()).reviewerNotes ?? [];
    return all.sort((a, b) => b.version - a.version)[0];
  },
  async listReviewerNotes(limit = 10) {
    return ((await load()).reviewerNotes ?? []).sort((a, b) => b.version - a.version).slice(0, limit);
  },
  async saveReviewerNotes(n) {
    const db = await load();
    db.reviewerNotes ??= [];
    const rec: ReviewerNotes = { ...n, version: (db.reviewerNotes.at(-1)?.version ?? 0) + 1, createdAt: new Date().toISOString() };
    db.reviewerNotes.push(rec);
    await persist(db);
    return rec;
  },
  async upsertConfirmation(c) {
    const db = await load();
    const existing = db.confirmations.find((x) => x.videoId === c.videoId && x.familyId === c.familyId);
    if (existing) Object.assign(existing, c);
    else db.confirmations.push({ ...c, id: randomUUID(), createdAt: new Date().toISOString() });
    await persist(db);
  },

  async getSettings(familyId, profileId) {
    const db = await load();
    // Family-level fields (merged with defaults so old files still work).
    const fam = { ...DEFAULT_SETTINGS(familyId), ...db.settings.find((s) => s.familyId === familyId) };
    db.profiles ??= [];
    let profiles = db.profiles.filter((p) => p.familyId === familyId).sort((a, b) => a.sort - b.sort);
    if (!profiles.length) {
      // First run: carry the legacy family settings into a default profile.
      const p: Profile = { ...DEFAULT_PROFILE(familyId, "My kid", fam.kidAge), id: randomUUID(), createdAt: new Date().toISOString(),
        mode: fam.mode, blockedTags: fam.blockedTags, blockedFormats: fam.blockedFormats, hideUnreviewed: fam.hideUnreviewed, dailyCheckLimit: fam.dailyCheckLimit, kidsOnlySearch: fam.kidsOnlySearch };
      db.profiles.push(p);
      await persist(db);
      profiles = [p];
    }
    const p = profiles.find((x) => x.id === profileId) ?? profiles[0];
    return mergeSettings({ familyId, pinHash: fam.pinHash, flagThreshold: fam.flagThreshold }, p);
  },
  async saveSettings(s) {
    const db = await load();
    const fam = { ...DEFAULT_SETTINGS(s.familyId), ...db.settings.find((x) => x.familyId === s.familyId), pinHash: s.pinHash, flagThreshold: s.flagThreshold };
    upsertBy(db.settings, fam, (x) => x.familyId);
    db.profiles ??= [];
    const p = db.profiles.find((x) => x.id === s.profileId && x.familyId === s.familyId);
    if (p) Object.assign(p, { age: s.kidAge, mode: s.mode, blockedTags: s.blockedTags, blockedFormats: s.blockedFormats, hideUnreviewed: s.hideUnreviewed, dailyCheckLimit: s.dailyCheckLimit, kidsOnlySearch: s.kidsOnlySearch, dailyMinutes: s.dailyMinutes, bedtime: s.bedtime,
      skipLimit: s.skipLimit, skipRegen: s.skipRegen ?? 1, skipCooldownSec: s.skipCooldownSec ?? 120, freePeekSec: s.freePeekSec ?? 30 });
    await persist(db);
  },
  async getFamily(familyId) {
    const db = await load();
    const f = (db.families ?? []).find((x) => x.id === familyId);
    return f ?? { id: familyId, plan: "free" as const, onboardedAt: new Date(0).toISOString() }; // local mode: no billing, no onboarding nag
  },
  async updateFamily(familyId, patch) {
    const db = await load();
    db.families ??= [];
    const f = db.families.find((x) => x.id === familyId);
    if (f) Object.assign(f, patch); else db.families.push({ id: familyId, plan: "free", ...patch });
    await persist(db);
  },
  async listProfiles(familyId) {
    await this.getSettings(familyId); // ensures the default profile exists
    return ((await load()).profiles ?? []).filter((p) => p.familyId === familyId).sort((a, b) => a.sort - b.sort);
  },
  async getProfile(id) {
    return ((await load()).profiles ?? []).find((p) => p.id === id);
  },
  async upsertProfile(p) {
    const db = await load();
    db.profiles ??= [];
    const existing = db.profiles.find((x) => x.id === p.id);
    const rec: Profile = { ...(existing ?? {}), ...p, id: p.id || randomUUID(), createdAt: existing?.createdAt ?? p.createdAt ?? new Date().toISOString() } as Profile;
    if (existing) Object.assign(existing, rec); else db.profiles.push(rec);
    await persist(db);
    return rec;
  },
  async deleteProfile(id) {
    const db = await load();
    db.profiles = (db.profiles ?? []).filter((p) => p.id !== id);
    await persist(db);
  },
  async listWhitelist(familyId) {
    return (await load()).whitelist.filter((w) => w.familyId === familyId);
  },
  async addToWhitelist(e) {
    const db = await load();
    if (!db.whitelist.some((w) => w.familyId === e.familyId && w.kind === e.kind && w.targetId === e.targetId)) {
      db.whitelist.push({ ...e, createdAt: new Date().toISOString() });
      await persist(db);
    }
  },
  async removeFromWhitelist(familyId, kind, targetId) {
    const db = await load();
    db.whitelist = db.whitelist.filter((w) => !(w.familyId === familyId && w.kind === kind && w.targetId === targetId));
    await persist(db);
  },
};
