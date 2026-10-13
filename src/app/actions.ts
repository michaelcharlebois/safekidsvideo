"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ingestChannel, ingestVideo } from "@/lib/ingest";
import { parseYouTubeUrl, searchForParent, type ParentSearch } from "@/lib/youtube";
import { CONCERN_TAGS, FORMATS, type ConcernTag, type ConfirmationVerdict, type FamilyMode, type TagVote, type VideoFormat } from "@/lib/types";
import { learnFromFeedback, rereviewDisputed } from "@/lib/learn";
import { PARENT_COOKIE } from "@/lib/auth";
import { createPairingCode, DEVICE_COOKIE, redeemPairingCode, resolveViewer, revokeDevice } from "@/lib/family";
import { supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { checksToday, createRequest, finishCheck, logCheck, logWatch, resolveRequest } from "@/lib/activity";
import { aiPasses, canPlay, getKidScreen, getLibrary } from "@/lib/queries";
import { reviewVideo } from "@/lib/reviewer";
import { pushToFamily, removeSubscription, saveSubscription } from "@/lib/push";
import { runPipeline, seedChannelReviews } from "@/lib/pipeline";

/** Resolve the signed-in parent's family, or bounce to sign-in / unlock. */
async function requireParent(): Promise<string> {
  const v = await resolveViewer();
  if (v.role === "parent") return v.familyId;
  redirect(supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent");
}

/** Global, everyone-affecting actions need an admin (ADMIN_EMAILS). */
async function requireAdmin(): Promise<void> {
  const v = await resolveViewer();
  if (v.role === "parent" && v.admin) return;
  redirect("/parent/reviewer?error=admin");
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
      const { channelId, videos } = await ingestChannel(input, 20, 10);
      await db.addToWhitelist({ familyId: fid, kind: "channel", targetId: channelId });
      revalidatePath("/parent");
      // Seed the kid screen: review the most-viewed + newest short videos right away, in the background.
      if (videos.length && process.env.GEMINI_API_KEY) {
        after(async () => {
          await seedChannelReviews(videos, { max: 8 });
          revalidatePath("/parent");
        });
      }
      return {
        ok: true,
        message: videos.length
          ? `Approved channel and pulled ${videos.length} videos (most-viewed + newest). Reviewing the first few now — they'll appear on the kid screen as they clear.`
          : `Approved channel. Add a YOUTUBE_API_KEY to pull its uploads automatically, or paste individual video links.`,
      };
    }
    return { ok: false, error: "That doesn't look like a YouTube video or channel link." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type ParentSearchResult = { query: string; results: ParentSearch; error?: string };

/** Parent search of YouTube: channels + videos to approve without hunting for links. */
export async function parentSearch(_prev: ParentSearchResult | null, form: FormData): Promise<ParentSearchResult> {
  await requireParent();
  const query = String(form.get("q") ?? "").trim();
  if (!query) return { query, results: { channels: [], videos: [] } };
  if (!process.env.YOUTUBE_API_KEY) return { query, results: { channels: [], videos: [] }, error: "Search needs a YOUTUBE_API_KEY." };
  try {
    return { query, results: await searchForParent(query) };
  } catch (e) {
    return { query, results: { channels: [], videos: [] }, error: (e as Error).message };
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
  const v = String(form.get("verdict"));
  const verdict: ConfirmationVerdict = v === "too_strict" || v === "too_lenient" ? v : "agree";
  // Per-tag votes: vote:<tag> = agree | overcall | missed (only the ones a parent touched are saved).
  const tagVotes: Partial<Record<ConcernTag, TagVote>> = {};
  for (const t of CONCERN_TAGS) {
    const val = form.get(`vote:${t}`);
    if (val === "agree" || val === "overcall" || val === "missed") tagVotes[t] = val;
  }
  const a = form.get("ageVote");
  const ageVote = a === "younger" || a === "older" || a === "right" ? a : undefined;
  const note = String(form.get("note") ?? "").trim() || undefined;
  const kidAgeRaw = form.get("kidAge");
  const kidAge = kidAgeRaw ? Number(kidAgeRaw) : undefined;
  await db.upsertConfirmation({ videoId, familyId: fid, verdict, tagVotes, ageVote, note, kidAge });
  revalidatePath("/parent");
  revalidatePath(`/parent/video/${videoId}`);
  revalidatePath("/parent/reviewer");
  redirect(`/parent/video/${videoId}?thanks=1`);
}

/** Reviewer page: distil recent feedback into new calibration notes and re-review disputed cards. */
export async function learnNow() {
  await requireAdmin();
  after(async () => {
    try { await learnFromFeedback({ minDisagreements: 1 }); } catch (e) { console.error("learn failed", e); }
    try { await rereviewDisputed({ max: 3 }); } catch (e) { console.error("re-review failed", e); }
    revalidatePath("/parent/reviewer");
  });
  redirect("/parent/reviewer?learning=1");
}

/** Reviewer page: a parent edits the calibration notes by hand. */
export async function saveReviewerNotes(form: FormData) {
  await requireAdmin();
  const notes = String(form.get("notes") ?? "").trim();
  if (notes) await db.saveReviewerNotes({ notes, source: "manual" });
  revalidatePath("/parent/reviewer");
  redirect("/parent/reviewer?saved=1");
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
    kidsOnlySearch: form.get("kidsOnlySearch") === "on",
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

export type VerifyResult = { error: string } | null;

/** Second step of sign-in: the 6-digit code from the email. Works regardless of which browser opened the email. */
export async function verifyCode(_prev: VerifyResult, form: FormData): Promise<VerifyResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  const next = String(form.get("next") ?? "/parent");
  if (token.length < 6) return { error: "Enter the code from the email." };
  const sb = await supabaseAuthClient();
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { error: "That code didn't work. Codes expire after an hour — request a new one if needed." };
  redirect(next.startsWith("/") ? next : "/parent");
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
        await db.upsertCard(await reviewVideo(videoId, { durationSeconds: video.durationSeconds }));
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

const MAX_KID_CHECK_SECONDS = 30 * 60;

export type CheckResult =
  | { status: "playing"; videoId: string }
  | { status: "checking"; videoId: string }
  | { status: "asked"; videoId: string; reasons: string[] }
  | { status: "limit" }
  | { status: "error"; message: string }
  | null;

/** Given a video that now has a card: play it, or send it to the parent. */
async function settleCheck(familyId: string, videoId: string, deviceId: string | undefined, checkId: string | null): Promise<CheckResult> {
  const settings = await db.getSettings(familyId);
  const lib = await getLibrary(familyId);
  const row = lib.find((x) => x.id === videoId);
  if (!row) throw new Error("Video vanished");
  if (canPlay(row, settings)) {
    if (!row.whitelisted) await db.addToWhitelist({ familyId, kind: "auto", targetId: videoId });
    await finishCheck(checkId, "passed");
    revalidatePath("/watch");
    revalidatePath("/watch/search");
    return { status: "playing", videoId };
  }
  const { reasons } = aiPasses(row, settings);
  await createRequest(familyId, videoId, deviceId, reasons[0]);
  await finishCheck(checkId, settings.mode === "open_ask" && reasons.length === 0 ? "needs_parent" : "blocked");
  revalidatePath("/watch");
  revalidatePath("/watch/search");
  revalidatePath("/parent");
  return { status: "asked", videoId, reasons };
}

/**
 * Kid taps "Check it" on a search result. If a card already exists this settles
 * immediately; otherwise the AI review runs in the background and the tile
 * polls until it's done.
 */
export async function checkVideo(_prev: CheckResult, form: FormData): Promise<CheckResult> {
  const v = await resolveViewer();
  if (!v.familyId) redirect("/pair");
  const familyId = v.familyId;
  const videoId = String(form.get("videoId") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { status: "error", message: "Bad video id" };
  const settings = await db.getSettings(familyId);
  if (settings.mode === "locked") return { status: "error", message: "Search is off" };
  const deviceId = v.role === "device" ? v.deviceId : undefined;
  if ((await checksToday(familyId)) >= settings.dailyCheckLimit) return { status: "limit" };

  try {
    const video = await ingestVideo(videoId);
    const existing = await db.getCard(video.id);
    if ((!existing || existing.reviewer.model === "sample") && (video.durationSeconds ?? 0) > MAX_KID_CHECK_SECONDS) {
      // Too long to auto-check: hand it to the parent instead of burning minutes of Gemini time.
      const minutes = Math.round((video.durationSeconds ?? 0) / 60);
      await createRequest(familyId, video.id, deviceId, `Too long to auto-check (${minutes} min)`);
      await logCheck(familyId, video.id, deviceId, "needs_parent");
      revalidatePath("/parent");
      return { status: "asked", videoId: video.id, reasons: [`Too long to auto-check (${Math.round((video.durationSeconds ?? 0) / 60)} min)`] };
    }
    if (existing && existing.reviewer.model !== "sample") {
      const checkId = await logCheck(familyId, video.id, deviceId, "pending");
      return await settleCheck(familyId, video.id, deviceId, checkId);
    }
    const checkId = await logCheck(familyId, video.id, deviceId, "pending");
    after(async () => {
      try {
        await db.upsertCard(await reviewVideo(video.id, { durationSeconds: video.durationSeconds }));
        await settleCheck(familyId, video.id, deviceId, checkId);
      } catch (e) {
        console.error("background review failed", video.id, (e as Error).message);
        await finishCheck(checkId, "failed");
      }
    });
    return { status: "checking", videoId: video.id };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
}

/** Parent runs (or re-runs) the AI review for one video from the dashboard. Background. */
export async function runReview(form: FormData) {
  await requireParent();
  const videoId = String(form.get("videoId"));
  const video = await db.getVideo(videoId);
  if (!video || !process.env.GEMINI_API_KEY) return;
  after(async () => {
    try {
      await db.upsertCard(await reviewVideo(video.id, { durationSeconds: video.durationSeconds }));
    } catch (e) {
      console.error("review failed", video.id, (e as Error).message);
    }
  });
  redirect(`/parent/video/${videoId}?reviewing=1`);
}

// ---- Push notifications -------------------------------------------------------

export async function subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const fid = await requireParent();
  const h = await headers();
  await saveSubscription(fid, sub, h.get("user-agent") ?? undefined);
}

export async function unsubscribePush(endpoint: string) {
  await requireParent();
  await removeSubscription(endpoint);
}

export async function sendTestPush() {
  const fid = await requireParent();
  const n = await pushToFamily(fid, { title: "Sift is set up 🎉", body: "You'll get a ping here when your kid asks for a video.", url: "/parent", tag: "test" });
  redirect(`/parent?push=${n}`);
}

/** Dashboard: review the next few unreviewed videos from this family's approved channels, in the background. */
export async function reviewNextBatch() {
  const fid = await requireParent();
  after(async () => {
    try {
      await runPipeline({ familyId: fid, maxReviews: 5, uploadsPerChannel: 10 });
    } catch (e) {
      console.error("batch review failed", (e as Error).message);
    }
  });
  redirect("/parent?batch=1");
}
