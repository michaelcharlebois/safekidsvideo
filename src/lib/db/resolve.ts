import type { Store } from "./store";
import { localStore } from "./local";
import { supabaseStore } from "./supabase";
import { assertPermissionWritesOpen } from "@/lib/maintenance";

/** Supabase when configured, otherwise the zero-setup local JSON store. Safe to import from scripts. */
export const STORE_KIND = process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local";
const base: Store = STORE_KIND === "supabase" ? supabaseStore : localStore;
/** Permission writes refuse while paused for a coordinated rollback (lib/maintenance.ts). */
const paused = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => { assertPermissionWritesOpen(); return f(...a); };
/**
 * Every store write that can change what a child may watch: permissions, child settings (mode, filters,
 * screen time, bedtime, extra minutes), family settings (PIN, report threshold), the family record (time
 * zone, plan), profiles (create, edit, delete), reviews and parent flags.
 */
export const db: Store = {
  ...base,
  addToWhitelist: paused(base.addToWhitelist.bind(base)),
  removeFromWhitelist: paused(base.removeFromWhitelist.bind(base)),
  resolveLegacyGrant: paused(base.resolveLegacyGrant.bind(base)),
  saveSettings: paused(base.saveSettings.bind(base)),
  updateProfileSettings: paused(base.updateProfileSettings.bind(base)),
  updateFamilySettings: paused(base.updateFamilySettings.bind(base)),
  updateFamily: paused(base.updateFamily.bind(base)),
  upsertProfile: paused(base.upsertProfile.bind(base)),
  deleteProfile: paused(base.deleteProfile.bind(base)),
  upsertCard: paused(base.upsertCard.bind(base)),
  upsertConfirmation: paused(base.upsertConfirmation.bind(base)),
};

/**
 * Until auth lands, every request belongs to one family. With Supabase + auth this
 * becomes the signed-in parent's family id.
 */
export const DEFAULT_FAMILY_ID = process.env.DEFAULT_FAMILY_ID ?? "00000000-0000-0000-0000-000000000001";
