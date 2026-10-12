import type { Store } from "./store";
import { localStore } from "./local";
import { supabaseStore } from "./supabase";

/** Supabase when configured, otherwise the zero-setup local JSON store. Safe to import from scripts. */
export const STORE_KIND = process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local";
export const db: Store = STORE_KIND === "supabase" ? supabaseStore : localStore;

/**
 * Until auth lands, every request belongs to one family. With Supabase + auth this
 * becomes the signed-in parent's family id.
 */
export const DEFAULT_FAMILY_ID = process.env.DEFAULT_FAMILY_ID ?? "00000000-0000-0000-0000-000000000001";
