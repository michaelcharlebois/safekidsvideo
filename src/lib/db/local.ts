import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Channel, Confirmation, ContentCard, Family, FamilySettings, LegacyGrant, Profile, ReviewerNotes, Video, WatchRequest, WhitelistEntry } from "@/lib/types";
import type { TimeRequest } from "@/lib/time-requests";
import type { BedtimeExtension } from "@/lib/bedtime";
import type { RawWatchEvent } from "@/lib/sessions";
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
  /** child-scope migration (mirrors supabase 0018) */
  schema?: number;
  whitelistPre0018?: WhitelistEntry[];
  legacyGrants?: LegacyGrant[];
  /** "Ask a grown-up" requests (local mode only; Supabase keeps them in watch_requests). */
  requests?: (WatchRequest & { resolvedAt?: string })[];
  /** "More time" requests (local mode; Supabase: time_requests, migration 0022). */
  timeRequests?: TimeRequest[];
  /** One-night bedtime extensions (local mode; Supabase: bedtime_extensions, migration 0023). */
  bedtimeExtensions?: BedtimeExtension[];
  /** Viewing records (local mode; Supabase: watch_events), so limits and Activity work offline too. */
  watchEvents?: (RawWatchEvent & { familyId: string })[];
};

/** Overridable for tests. */
const dbPath = () => process.env.SIFT_LOCAL_DB ?? path.join(process.cwd(), "data", "db.json");
export function __resetLocalStoreCache() { cache = null; }
const SEED_PATH = path.join(process.cwd(), "data", "seed.json");

const empty = (): Db => ({ channels: [], videos: [], cards: [], confirmations: [], whitelist: [], settings: [] });

let cache: Db | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Db> {
  if (cache) return cache;
  let db: Db;
  try {
    db = { ...empty(), ...JSON.parse(await fs.readFile(dbPath(), "utf8")) };
  } catch {
    // First run: start from the seed file if present.
    try {
      db = { ...empty(), ...JSON.parse(await fs.readFile(SEED_PATH, "utf8")) };
    } catch {
      db = empty();
    }
    await persist(db);
  }
  if (migrateLocalToChildScope(db)) await persist(db);
  cache = db;
  return db;
}

/**
 * Local-store twin of supabase/migrations/0018_child_scope.sql. The local store has no request or
 * check history, so a legacy override/auto row is attributed only when its family has exactly one
 * child; otherwise it moves to legacyGrants (granting nothing). Blocks/dismissals stay family-wide.
 * Keeps whitelistPre0018 so it can be undone. Returns true if it changed anything.
 */
export function migrateLocalToChildScope(db: Db): boolean {
  if ((db.schema ?? 0) >= 18) return false;
  db.whitelistPre0018 = db.whitelist.map((w) => ({ ...w }));
  db.legacyGrants ??= [];
  const kids = (fid: string) => (db.profiles ?? []).filter((p) => p.familyId === fid).sort((a, b) => a.sort - b.sort);
  const keep: WhitelistEntry[] = [];
  for (const w of db.whitelist) {
    if ((w.kind === "override" || w.kind === "auto") && w.profileId == null) {
      const k = kids(w.familyId);
      if (k.length === 1) keep.push({ ...w, profileId: k[0].id });
      else db.legacyGrants.push({ id: randomUUID(), familyId: w.familyId, kind: w.kind, targetId: w.targetId, createdAt: w.createdAt, candidateProfileIds: k.map((p) => p.id) });
    } else keep.push(w);
  }
  db.whitelist = keep;
  for (const p of db.profiles ?? []) if (p.age == null) p.age = db.settings.find((s) => s.familyId === p.familyId)?.kidAge ?? 6;
  db.schema = 18;
  return true;
}

async function persist(db: Db) {
  writing = writing.then(async () => {
    await fs.mkdir(path.dirname(dbPath()), { recursive: true });
    await fs.writeFile(dbPath(), JSON.stringify(db, null, 2));
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
      skipLimit: s.skipLimit, skipRegen: s.skipRegen ?? 1, skipCooldownSec: s.skipCooldownSec ?? 120, freePeekSec: s.freePeekSec ?? 30, boosts: s.boosts ?? p.boosts ?? {} });
    await persist(db);
  },
  async updateProfileSettings(familyId, profileId, patch) {
    const db = await load();
    const p = (db.profiles ?? []).find((x) => x.id === profileId && x.familyId === familyId);
    if (!p) throw new Error("That child isn't in this family");
    Object.assign(p, patch); // only the keys in the patch
    await persist(db);
  },
  async updateFamilySettings(familyId, patch) {
    const db = await load();
    const fam = { ...DEFAULT_SETTINGS(familyId), ...db.settings.find((x) => x.familyId === familyId) };
    if ("pinHash" in patch && patch.pinHash) fam.pinHash = patch.pinHash;
    if ("flagThreshold" in patch && patch.flagThreshold) fam.flagThreshold = patch.flagThreshold;
    upsertBy(db.settings, fam, (x) => x.familyId);
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
    db.whitelist = db.whitelist.filter((w) => w.profileId !== id); // mirrors ON DELETE CASCADE
    await persist(db);
  },
  async listWhitelist(familyId) {
    return (await load()).whitelist.filter((w) => w.familyId === familyId);
  },
  async addToWhitelist(e) {
    const db = await load();
    const profileId = e.profileId ?? null;
    if (profileId && !(db.profiles ?? []).some((p) => p.id === profileId && p.familyId === e.familyId)) {
      throw new Error("That child isn't in this family");
    }
    if ((e.kind === "override" || e.kind === "auto") && !profileId) throw new Error(`${e.kind} needs a child`);
    if (!db.whitelist.some((w) => w.familyId === e.familyId && w.kind === e.kind && w.targetId === e.targetId && (w.profileId ?? null) === profileId)) {
      db.whitelist.push({ familyId: e.familyId, kind: e.kind, targetId: e.targetId, profileId, createdAt: new Date().toISOString() });
      await persist(db);
    }
  },
  async removeFromWhitelist(familyId, kind, targetId, profileId = null) {
    const db = await load();
    db.whitelist = db.whitelist.filter((w) => !(w.familyId === familyId && w.kind === kind && w.targetId === targetId && (w.profileId ?? null) === (profileId ?? null)));
    await persist(db);
  },
  async listLegacyGrants(familyId) {
    return ((await load()).legacyGrants ?? []).filter((g) => g.familyId === familyId && !g.resolvedAt);
  },
  async resolveLegacyGrant(familyId, id, resolution) {
    const db = await load();
    const g = (db.legacyGrants ?? []).find((x) => x.id === id && x.familyId === familyId);
    if (!g) return undefined;
    g.resolvedAt = new Date().toISOString();
    g.resolution = resolution;
    await persist(db);
    return g;
  },
};

/**
 * Local-mode requests, with the same rules as the database: one PENDING request per child per video
 * (a repeat ask is "exists"), resolved once.
 */
export const localRequests = {
  async list(familyId: string) {
    return ((await load()).requests ?? []).filter((r) => r.familyId === familyId);
  },
  async create(r: Omit<WatchRequest, "id" | "createdAt" | "status">): Promise<"created" | "exists"> {
    const db = await load();
    db.requests ??= [];
    if (db.requests.some((x) => x.familyId === r.familyId && x.videoId === r.videoId && (x.profileId ?? null) === (r.profileId ?? null) && x.status === "pending")) return "exists";
    db.requests.push({ ...r, id: randomUUID(), status: "pending", createdAt: new Date().toISOString() });
    await persist(db);
    return "created";
  },
  async resolve(familyId: string, id: string, status: "approved" | "denied") {
    const db = await load();
    const r = (db.requests ?? []).find((x) => x.id === id && x.familyId === familyId && x.status === "pending");
    if (!r) return;
    r.status = status;
    r.resolvedAt = new Date().toISOString();
    await persist(db);
  },
};

/** Local-mode more-time requests: the same rules as time_requests (one pending per child, kind and day). */
export const localTimeRequests = {
  async list(familyId: string) {
    return ((await load()).timeRequests ?? []).filter((r) => r.familyId === familyId);
  },
  async create(r: Omit<TimeRequest, "id" | "createdAt" | "status">): Promise<"created" | "exists"> {
    const db = await load();
    db.timeRequests ??= [];
    // Daily minutes: one PENDING ask per child per day. Bedtime: one ask per child per night, whatever its outcome.
    if (db.timeRequests.some((x) => x.profileId === r.profileId && x.kind === r.kind && x.day === r.day && (r.kind === "bedtime" || x.status === "pending"))) return "exists";
    db.timeRequests.push({ ...r, id: randomUUID(), status: "pending", createdAt: new Date().toISOString() });
    await persist(db);
    return "created";
  },
  /** Answer a pending request; returns it, or undefined if it wasn't pending (already answered). */
  async resolve(familyId: string, id: string, status: "approved" | "denied", grantedMinutes?: 15 | 30 | 45 | 60) {
    const db = await load();
    const r = (db.timeRequests ?? []).find((x) => x.id === id && x.familyId === familyId && x.status === "pending");
    if (!r) return undefined;
    r.status = status;
    if (status === "approved") r.grantedMinutes = grantedMinutes;
    r.resolvedAt = new Date().toISOString();
    await persist(db);
    return { ...r };
  },
};

/** Local-mode viewing records: one start and at most one end per session, like the 0020 unique indexes. */
export const localWatchEvents = {
  async since(familyId: string, sinceIso: string) {
    return ((await load()).watchEvents ?? []).filter((e) => e.familyId === familyId && e.startedAt >= sinceIso).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },
  async add(e: RawWatchEvent & { familyId: string }) {
    const db = await load();
    db.watchEvents ??= [];
    if (e.sessionId && db.watchEvents.some((x) => x.sessionId === e.sessionId && !!x.outcome === !!e.outcome)) return; // a retry
    db.watchEvents.push(e);
    await persist(db);
  },
};

/** Local-mode bedtime extensions: at most one live (not cancelled) extension per child per night. */
export const localBedtimeExtensions = {
  async list(familyId: string, sinceNight: string) {
    return ((await load()).bedtimeExtensions ?? []).filter((e) => e.familyId === familyId && e.night >= sinceNight);
  },
  async set(e: Omit<BedtimeExtension, "id" | "createdAt" | "updatedAt" | "cancelledAt">): Promise<BedtimeExtension> {
    const db = await load();
    db.bedtimeExtensions ??= [];
    const now = new Date().toISOString();
    const live = db.bedtimeExtensions.find((x) => x.profileId === e.profileId && x.night === e.night && !x.cancelledAt);
    if (live) Object.assign(live, { ...e, requestId: e.requestId ?? live.requestId, updatedAt: now });
    else db.bedtimeExtensions.push({ ...e, id: randomUUID(), createdAt: now, updatedAt: now });
    await persist(db);
    return { ...(live ?? db.bedtimeExtensions[db.bedtimeExtensions.length - 1]) };
  },
  async cancel(familyId: string, profileId: string, night: string): Promise<boolean> {
    const db = await load();
    const live = (db.bedtimeExtensions ?? []).find((x) => x.familyId === familyId && x.profileId === profileId && x.night === night && !x.cancelledAt);
    if (!live) return false;
    live.cancelledAt = new Date().toISOString();
    await persist(db);
    return true;
  },
};
