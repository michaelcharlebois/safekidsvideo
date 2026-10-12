"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ingestChannel, ingestVideo } from "@/lib/ingest";
import { parseYouTubeUrl } from "@/lib/youtube";
import { CONCERN_TAGS, FORMATS, type ConcernTag, type FamilyMode, type VideoFormat } from "@/lib/types";
import { PARENT_COOKIE } from "@/lib/auth";
import { createPairingCode, DEVICE_COOKIE, redeemPairingCode, resolveViewer, revokeDevice } from "@/lib/family";
import { supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { checksToday, createRequest, logCheck, logWatch, resolveRequest } from "@/lib/activity";
import { aiPasses, canPlay, getKidScreen, getLibrary } from "@/lib/queries";
import { reviewVideo } from "@/lib/reviewer";

/** Resolve the signed-in parent's family, or bounce to sign-in / unlock. */
async function requireParent(): Promise<string> {
  const v = await resolveViewer();
  if (v.role === "parent") return v.familyId;
  redirect(supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent");
}

export type AddResult = { ok: true; message: string } | { ok: false; error: string };

export async function addByUrl(_prev: AddResult | null, form: FormData): Promise<AddResult> {
  const fid = await requireParent();
  const input = String(form.get("url") ?? "").trim();
  const parsed = parseYouTubeUrl(input);
  try {
    if (parsed.kind === "video") {
      const v = await ingestVideo(input);
      await db.addToWhitelist({ familyId: fid, kind: "video", targetId: v.id });
      revalidatePath("/parent");
      return { ok: true, message: `Added "${v.title}" to the approved list.` };
    }
    if (parsed.kind === "channel") {
      const { channelId, videos } = await ingestChannel(input, 5);
      await db.addToWhitelist({ familyId: fid, kind: "channel", targetId: channelId });
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
  const fid = await requireParent();
  const kind = form.get("kind") as "channel" | "video";
  const targetId = String(form.get("targetId"));
  const on = form.get("on") === "1";
  if (on) await db.addToWhitelist({ familyId: fid, kind, targetId });
  else await db.removeFromWhitelist(fid, kind, targetId);
  revalidatePath("/parent");
  revalidatePath(`/parent/video/${targetId}`);
}

export async function confirmCard(form: FormData) {
  const fid = await requireParent();
  const videoId = String(form.get("videoId"));
  const verdict = form.get("verdict") === "flag" ? "flag" : "agree";
  const tags = CONCERN_TAGS.filter((t) => form.get(`tag:${t}`) === "on") as ConcernTag[];
  const note = String(form.get("note") ?? "").trim() || undefined;
  const kidAgeRaw = form.get("kidAge");
  const kidAge = kidAgeRaw ? Number(kidAgeRaw) : undefined;
  await db.upsertConfirmation({ videoId, familyId: fid, verdict, tags: verdict === "flag" ? tags : undefined, note, kidAge });
  revalidatePath("/parent");
  revalidatePath(`/parent/video/${videoId}`);
}

export async function saveSettings(form: FormData) {
  const fid = await requireParent();
  const current = await db.getSettings(fid);
  const pin = String(form.get("pin") ?? "").trim();
  const blockedTags = CONCERN_TAGS.filter((t) => form.get(`block:${t}`) === "on") as ConcernTag[];
  const blockedFormats = FORMATS.filter((f) => form.get(`blockfmt:${f}`) === "on") as VideoFormat[];
  try {
    await db.saveSettings({
    ...current,
    pinHash: /^\d{4}$/.test(pin) ? pin : current.pinHash,
    kidAge: Number(form.get("kidAge") ?? current.kidAge) || current.kidAge,
    blockedTags,
    blockedFormats,
    hideUnreviewed: form.get("hideUnreviewed") === "on",
    mode: (["locked", "open", "open_ask"].includes(String(form.get("mode"))) ? String(form.get("mode")) : current.mode) as FamilyMode,
    dailyCheckLimit: Number(form.get("dailyCheckLimit") ?? current.dailyCheckLimit) || current.dailyCheckLimit,
    flagThreshold: Number(form.get("flagThreshold") ?? current.flagThreshold) || current.flagThreshold,
    });
  } catch (e) {
    redirect(`/parent?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/parent");
  revalidatePath("/watch");
  redirect("/parent?saved=1");
}

export type UnlockResult = { error: string } | null;

export async function unlock(_prev: UnlockResult, form: FormData): Promise<UnlockResult> {
  const pin = String(form.get("pin") ?? "");
  const next = String(form.get("next") ?? "/parent");
  const v = await resolveViewer();
  if (!v.familyId) redirect("/login");
  const settings = await db.getSettings(v.familyId);
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

// ---- Supabase mode: parent sign-in ---------------------------------------

export type SignInResult = { sent: true; email: string } | { error: string } | null;

export async function signIn(_prev: SignInResult, form: FormData): Promise<SignInResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = String(form.get("next") ?? "/parent");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const sb = await supabaseAuthClient();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: error.message };
  return { sent: true, email };
}

export async function signOut() {
  const sb = await supabaseAuthClient();
  await sb.auth.signOut();
  redirect("/");
}

// ---- Supabase mode: kid-device pairing -----------------------------------

export async function newPairingCode() {
  const fid = await requireParent();
  await createPairingCode(fid);
  revalidatePath("/parent/devices");
}

export type PairResult = { error: string } | null;

export async function pairDevice(_prev: PairResult, form: FormData): Promise<PairResult> {
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (code.length !== 6) return { error: "Enter the 6-digit code." };
  const r = await redeemPairingCode(code, name);
  if ("error" in r) return { error: r.error };
  const c = await cookies();
  c.set(DEVICE_COOKIE, r.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/watch");
}

export async function unpairDevice(form: FormData) {
  const fid = await requireParent();
  await revokeDevice(fid, String(form.get("deviceId")));
  revalidatePath("/parent/devices");
}

// ---- "Ask a grown-up" --------------------------------------------------------

export async function askGrownUp(form: FormData): Promise<void> {
  const v = await resolveViewer();
  if (!v.familyId) redirect("/pair");
  const videoId = String(form.get("videoId"));
  // Only videos the family has already approved at the channel level can be asked for.
  const screen = await getKidScreen(v.familyId);
  const video = screen.askable.find((x) => x.id === videoId);
  if (!video) return;
  await createRequest(v.familyId, videoId, v.role === "device" ? v.deviceId : undefined);
  // No card yet? Review it now so the parent sees a card, not a blank.
  if (!video.card && process.env.GEMINI_API_KEY) {
    after(async () => {
      try {
        await db.upsertCard(await reviewVideo(videoId));
      } catch (e) {
        console.error("auto-review failed", videoId, (e as Error).message);
      }
    });
  }
  revalidatePath("/watch");
  revalidatePath("/parent");
}

export async function resolveWatchRequest(form: FormData) {
  const fid = await requireParent();
  const requestId = String(form.get("requestId"));
  const videoId = String(form.get("videoId"));
  const approve = form.get("decision") === "approve";
  await resolveRequest(fid, requestId, approve ? "approved" : "denied");
  if (approve) await db.addToWhitelist({ familyId: fid, kind: "override", targetId: videoId });
  revalidatePath("/parent");
  revalidatePath("/watch");
}

export async function recordWatch(videoId: string, completed: boolean) {
  const v = await resolveViewer();
  if (!v.familyId) return;
  await logWatch(v.familyId, videoId, v.role === "device" ? v.deviceId : undefined, completed);
}

// ---- Open mode: kid-triggered AI check ----------------------------------------

export type CheckResult =
  | { status: "playing"; videoId: string }
  | { status: "asked"; videoId: string; reasons: string[] }
  | { status: "limit" }
  | { status: "error"; message: string }
  | null;

/**
 * Kid taps "Check it" on a search result. Ingest the video, review it if needed,
 * then: open mode + passes → auto-approve and play; otherwise → ask the parent.
 */
export async function checkVideo(_prev: CheckResult, form: FormData): Promise<CheckResult> {
  const v = await resolveViewer();
  if (!v.familyId) redirect("/pair");
  const videoId = String(form.get("videoId") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { status: "error", message: "Bad video id" };
  const settings = await db.getSettings(v.familyId);
  if (settings.mode === "locked") return { status: "error", message: "Search is off" };
  const deviceId = v.role === "device" ? v.deviceId : undefined;

  if ((await checksToday(v.familyId)) >= settings.dailyCheckLimit) {
    return { status: "limit" };
  }

  try {
    const video = await ingestVideo(videoId);
    let card = await db.getCard(video.id);
    if (!card || card.reviewer.model === "sample") {
      card = await reviewVideo(video.id);
      await db.upsertCard(card);
    }
    const lib = await getLibrary(v.familyId);
    const row = lib.find((x) => x.id === video.id);
    if (!row) throw new Error("Video vanished");

    if (canPlay(row, settings)) {
      if (!row.whitelisted) await db.addToWhitelist({ familyId: v.familyId, kind: "auto", targetId: video.id });
      await logCheck(v.familyId, video.id, deviceId, "passed");
      revalidatePath("/watch");
      return { status: "playing", videoId: video.id };
    }
    const { reasons } = aiPasses(row, settings);
    await createRequest(v.familyId, video.id, deviceId);
    await logCheck(v.familyId, video.id, deviceId, settings.mode === "open_ask" && reasons.length === 0 ? "needs_parent" : "blocked");
    revalidatePath("/watch");
    revalidatePath("/parent");
    return { status: "asked", videoId: video.id, reasons };
  } catch (e) {
    await logCheck(v.familyId, videoId, deviceId, "failed");
    return { status: "error", message: (e as Error).message };
  }
}
