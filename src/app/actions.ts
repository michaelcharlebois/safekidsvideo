"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, DEFAULT_FAMILY_ID } from "@/lib/db";
import { ingestChannel, ingestVideo } from "@/lib/ingest";
import { parseYouTubeUrl } from "@/lib/youtube";
import { CONCERN_TAGS, FORMATS, type ConcernTag, type VideoFormat } from "@/lib/types";
import { PARENT_COOKIE } from "@/lib/auth";

async function familyId() {
  // Single-family until auth lands; see src/lib/db/resolve.ts.
  return DEFAULT_FAMILY_ID;
}

async function requireParent() {
  const c = await cookies();
  if (c.get(PARENT_COOKIE)?.value !== "1") redirect("/unlock?next=/parent");
}

export type AddResult = { ok: true; message: string } | { ok: false; error: string };

export async function addByUrl(_prev: AddResult | null, form: FormData): Promise<AddResult> {
  await requireParent();
  const input = String(form.get("url") ?? "").trim();
  const parsed = parseYouTubeUrl(input);
  try {
    if (parsed.kind === "video") {
      const v = await ingestVideo(input);
      await db.addToWhitelist({ familyId: await familyId(), kind: "video", targetId: v.id });
      revalidatePath("/parent");
      return { ok: true, message: `Added "${v.title}" to the approved list.` };
    }
    if (parsed.kind === "channel") {
      const { channelId, videos } = await ingestChannel(input, 5);
      await db.addToWhitelist({ familyId: await familyId(), kind: "channel", targetId: channelId });
      revalidatePath("/parent");
      return {
        ok: true,
        message: videos.length
          ? `Approved channel and pulled ${videos.length} recent videos.`
          : `Approved channel. Add a YOUTUBE_API_KEY to pull its uploads automatically, or paste individual video links.`,
      };
    }
    return { ok: false, error: "That doesn't look like a YouTube video or channel link." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function toggleWhitelist(form: FormData) {
  await requireParent();
  const kind = form.get("kind") as "channel" | "video";
  const targetId = String(form.get("targetId"));
  const on = form.get("on") === "1";
  const fid = await familyId();
  if (on) await db.addToWhitelist({ familyId: fid, kind, targetId });
  else await db.removeFromWhitelist(fid, kind, targetId);
  revalidatePath("/parent");
  revalidatePath(`/parent/video/${targetId}`);
}

export async function confirmCard(form: FormData) {
  await requireParent();
  const videoId = String(form.get("videoId"));
  const verdict = form.get("verdict") === "flag" ? "flag" : "agree";
  const tags = CONCERN_TAGS.filter((t) => form.get(`tag:${t}`) === "on") as ConcernTag[];
  const note = String(form.get("note") ?? "").trim() || undefined;
  const kidAgeRaw = form.get("kidAge");
  const kidAge = kidAgeRaw ? Number(kidAgeRaw) : undefined;
  await db.upsertConfirmation({ videoId, familyId: await familyId(), verdict, tags: verdict === "flag" ? tags : undefined, note, kidAge });
  revalidatePath("/parent");
  revalidatePath(`/parent/video/${videoId}`);
}

export async function saveSettings(form: FormData) {
  await requireParent();
  const fid = await familyId();
  const current = await db.getSettings(fid);
  const pin = String(form.get("pin") ?? "").trim();
  const blockedTags = CONCERN_TAGS.filter((t) => form.get(`block:${t}`) === "on") as ConcernTag[];
  const blockedFormats = FORMATS.filter((f) => form.get(`blockfmt:${f}`) === "on") as VideoFormat[];
  await db.saveSettings({
    ...current,
    pinHash: /^\d{4}$/.test(pin) ? pin : current.pinHash,
    kidAge: Number(form.get("kidAge") ?? current.kidAge) || current.kidAge,
    blockedTags,
    blockedFormats,
    flagThreshold: Number(form.get("flagThreshold") ?? current.flagThreshold) || current.flagThreshold,
  });
  revalidatePath("/parent");
  revalidatePath("/watch");
}

export type UnlockResult = { error: string } | null;

export async function unlock(_prev: UnlockResult, form: FormData): Promise<UnlockResult> {
  const pin = String(form.get("pin") ?? "");
  const next = String(form.get("next") ?? "/parent");
  const settings = await db.getSettings(await familyId());
  if (pin !== settings.pinHash) return { error: "Wrong PIN" };
  const c = await cookies();
  c.set(PARENT_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  redirect(next.startsWith("/") ? next : "/parent");
}

export async function lock() {
  const c = await cookies();
  c.delete(PARENT_COOKIE);
  redirect("/watch");
}
