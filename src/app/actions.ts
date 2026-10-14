"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ingestChannel, ingestVideo } from "@/lib/ingest";
import { fetchChannelMeta, parseYouTubeUrl, searchForParent, type ParentSearch } from "@/lib/youtube";
import { packById } from "@/lib/packs";
import { billingEnabled, createCheckoutUrl, createPortalUrl, familyStatus } from "@/lib/billing";
import { saveKidDay, saveTimezone } from "@/lib/checkin";
import { askForMoreTime, grantBonusMinutes } from "@/lib/screentime";
import { CONCERN_TAGS, type ConcernTag, type ConfirmationVerdict, type TagVote } from "@/lib/types";
import { learnFromFeedback, rereviewDisputed } from "@/lib/learn";
import { PARENT_COOKIE } from "@/lib/auth";
import { assignDevice, createPairingCode, DEVICE_COOKIE, claimDevicePinAttempt, devicePinSucceeded, PinCheckUnavailable, PROFILE_COOKIE, redeemPairingCode, resolveViewer, revokeDevice, setDeviceActiveProfile } from "@/lib/family";
import { addVideoToLibrary, allowForChild, approveRequest, decideForChild, GrantError, NeedsUnreviewedConfirm, recordOpenClearance, removeFamilyBlock, resolveLegacy, splitFamilyBlock, unhideForFamily as unhideForFamilyGrant } from "@/lib/grants";
import { pinIsSet, verifyPin } from "@/lib/pin";
import { saveSettingsForm, SettingsError } from "@/lib/settings-save";
import { isLocalPath, withoutParams, withParam } from "@/lib/paths";

/** Notes a page shows after an action; dropped from a return path before adding the new outcome. */
const OUTCOME_PARAMS = ["confirm", "for", "via", "ref", "why", "decided", "video", "error", "saved", "failed"];
import { nextAuthorized, reviewEligibility } from "@/lib/gate";
import { timeState } from "@/lib/screentime";
import { DEFAULT_PROFILE } from "@/lib/db/store";
import { supabaseAuthClient, supabaseEnabled } from "@/lib/supabase/server";
import { checksToday, createRequest, finishCheck, getRequest, logCheck, logWatch, logWatchEnd, resolveRequest } from "@/lib/activity";
import { authorize, childSettings, getKidScreen, getLibrary, playableFor, screen } from "@/lib/queries";
import { BudgetExceededError, IncompleteReviewError, reviewVideo } from "@/lib/reviewer";
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
  await requirePaid(fid);
  const input = String(form.get("url") ?? "").trim();
  const parsed = parseYouTubeUrl(input);
  try {
    if (parsed.kind === "video") {
      // "Add & review": the video joins the library and gets reviewed. It does NOT play until the review
      // clears each child's rules — or a parent uses "Allow for <child>".
      const v = await ingestVideo(input);
      await addVideoToLibrary(db, fid, v.id);
      const reviewed = reviewEligibility(await db.getCard(v.id)).eligible;
      if (!reviewed && process.env.GEMINI_API_KEY) {
        after(async () => {
          try { await db.upsertCard(await reviewVideo(v.id, { durationSeconds: v.durationSeconds })); }
          catch (e) { console.error("add & review failed", v.id, (e as Error).message); }
          revalidatePath("/parent"); revalidatePath("/watch");
        });
      }
      revalidatePath("/parent");
      return { ok: true, message: reviewed ? `Added "${v.title}". It plays for each child whose rules it passes.` : `Added "${v.title}" and started its review. It won't play until the review clears.` };
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

/** Family content sources only (channel / video). Per-child decisions go through the grant helpers. */
export async function toggleWhitelist(form: FormData) {
  const fid = await requireParent();
  const kind = form.get("kind");
  if (kind !== "channel" && kind !== "video") throw new Error("Unsupported");
  const targetId = String(form.get("targetId"));
  const on = form.get("on") === "1";
  if (on) await db.addToWhitelist({ familyId: fid, kind, targetId, profileId: null });
  else await db.removeFromWhitelist(fid, kind, targetId, null);
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

/**
 * Save a child's settings. The Kids & settings pages post one section at a time (hidden "section" field);
 * only those sections change (see lib/settings-form.ts). A form without "section" saves everything, as before.
 * Family-wide settings (PIN, parent-flag threshold) are the "family" section.
 */
export async function saveSettings(form: FormData) {
  const fid = await requireParent();
  const nextRaw = String(form.get("next") ?? "");
  const profileId = String(form.get("profileId") ?? "");
  const back = isLocalPath(nextRaw) ? nextRaw : profileId ? `/parent/settings?kid=${encodeURIComponent(profileId)}` : "/parent/kids";
  let sections: string[] = [];
  try {
    sections = (await saveSettingsForm(db, fid, form)).sections;
  } catch (e) {
    // `failed` names the section, so the page can show the problem where the parent pressed Save.
    const failed = withParam(back, "error", e instanceof SettingsError ? e.message : "Couldn't save. Try again.");
    const section = String(form.get("section") ?? "");
    redirect(section ? withParam(failed, "failed", section) : failed);
  }
  revalidatePath("/parent", "layout");
  revalidatePath("/watch");
  redirect(withParam(back, "saved", sections.length === 1 ? sections[0] : "1"));
}

export type UnlockResult = { error: string } | null;

export async function unlock(_prev: UnlockResult, form: FormData): Promise<UnlockResult> {
  const pin = String(form.get("pin") ?? "");
  const next = String(form.get("next") ?? "/parent");
  const v = await resolveViewer();
  if (!v.familyId) redirect("/login");
  const settings = await db.getSettings(v.familyId);
  if (!verifyPin(pin, settings.pinHash)) return { error: "Wrong PIN" };
  const c = await cookies();
  c.set(PARENT_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  redirect(isLocalPath(next) ? next : "/parent");
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
  redirect(isLocalPath(next) ? next : "/parent");
}

export async function signOut() {
  const sb = await supabaseAuthClient();
  await sb.auth.signOut();
  redirect("/");
}

// ---- Supabase mode: kid-device pairing -----------------------------------

export async function newPairingCode(form?: FormData) {
  const fid = await requireParent();
  await createPairingCode(fid);
  revalidatePath("/parent/devices");
  const next = String(form?.get("next") ?? "");
  if (isLocalPath(next)) redirect(next);
}

export type PairResult = { error: string } | null;

export async function pairDevice(_prev: PairResult, form: FormData): Promise<PairResult> {
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  if (code.length !== 8 && code.length !== 6) return { error: "Enter the 8-digit code." };
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
  if (!v.profileId) redirect("/watch/who"); // no child picked on a shared screen: fail closed
  // Only videos already in this child's library can be asked for.
  const kidScreen = await getKidScreen(v.familyId, v.profileId);
  const video = kidScreen.askable.find((x) => x.id === videoId);
  if (!video) return;
  await createRequest(v.familyId, videoId, v.role === "device" ? v.deviceId : undefined, undefined, v.profileId);
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

/**
 * Where to send a parent who tried to allow an unreviewed video without confirming: the review page's
 * disclosure step, carrying everything needed to resubmit the same decision with confirm=1.
 */
/** Back to the page that asked (Review by default; Library shows the same disclosure) with the confirm step. */
function unreviewedConfirmUrl(e: NeedsUnreviewedConfirm, via: "request" | "queue" | "legacy", ref: string, kid: string, base = "/parent/review") {
  const q = { kid, confirm: e.videoId, for: e.profileId, via, ref, why: e.reason };
  return Object.entries(q).reduce((url, [k, v]) => withParam(url, k, v), base);
}
const confirmed = (form: FormData) => form.get("confirm") === "1";

export async function resolveWatchRequest(form: FormData) {
  const fid = await requireParent();
  const requestId = String(form.get("requestId"));
  const approve = form.get("decision") === "approve";
  const req = await getRequest(fid, requestId);
  if (!req) redirect("/parent");
  if (approve) {
    try {
      // Allowed for the child who asked. Old requests with no child need the parent to pick one.
      await approveRequest(db, fid, req, String(form.get("profileId") ?? "") || null, { confirmedUnreviewed: confirmed(form) });
    } catch (e) {
      if (e instanceof NeedsUnreviewedConfirm) redirect(unreviewedConfirmUrl(e, "request", requestId, e.profileId));
      if (e instanceof GrantError) redirect(`/parent/review?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
  }
  await resolveRequest(fid, requestId, approve ? "approved" : "denied");
  revalidatePath("/parent");
  revalidatePath("/parent/review");
  revalidatePath("/watch");
  const next = String(form.get("next") ?? "");
  if (isLocalPath(next)) redirect(next);
}

export async function recordWatchEnd(videoId: string, outcome: "skipped" | "finished" | "left", atSec: number) {
  const v = await resolveViewer();
  if (!v.familyId) return;
  await logWatchEnd(v.familyId, videoId, v.profileId, outcome, atSec);
}

export async function recordWatch(videoId: string, completed: boolean) {
  const v = await resolveViewer();
  if (!v.familyId) return;
  await logWatch(v.familyId, videoId, v.role === "device" ? v.deviceId : undefined, completed, v.profileId);
}

/** Review queue: one decision per video, for one child. allow = explicit approval; hide = "Keep hidden" (a standing restriction for that child); never = block. */
export async function decideVideo(form: FormData) {
  const fid = await requireParent();
  const videoId = String(form.get("videoId") ?? "");
  const profileId = String(form.get("profileId") ?? "");
  const d = String(form.get("decision") ?? "");
  const decision = d === "allow" || d === "hide" || d === "never" || d === "undo" ? d : null;
  // Come back to the page that asked (Library, Review, a video page), never an outside address.
  const nextRaw = String(form.get("next") ?? "");
  const next = withoutParams(isLocalPath(nextRaw) ? nextRaw : "/parent/library", OUTCOME_PARAMS);
  if (!decision) redirect(next);
  try {
    await decideForChild(db, fid, profileId, videoId, decision, { confirmedUnreviewed: confirmed(form) });
  } catch (e) {
    if (e instanceof NeedsUnreviewedConfirm) redirect(unreviewedConfirmUrl(e, "queue", "", profileId, next));
    if (e instanceof GrantError) redirect(withParam(next, "error", e.message));
    throw e;
  }
  revalidatePath("/parent", "layout"); revalidatePath(`/parent/video/${videoId}`); revalidatePath("/watch");
  redirect(withParam(withParam(next, "decided", decision), "video", videoId));
}

export async function reviewChannelNow(form: FormData) {
  const fid = await requireParent();
  const channelId = String(form.get("channelId") ?? "");
  const videos = (await db.listVideos({ channelId })).sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  after(async () => {
    await seedChannelReviews(videos, { max: 5 });
    revalidatePath(`/parent/channel/${channelId}`); revalidatePath("/parent"); revalidatePath("/watch");
  });
  void fid;
  redirect(`/parent/channel/${channelId}?reviewing=1`);
}

// ---- Screen time ----------------------------------------------------------------

export async function askMoreTime() {
  const v = await resolveViewer();
  if (!v.familyId) redirect("/pair");
  await askForMoreTime(v.familyId, v.profileId);
  redirect("/watch?asked=time");
}

export async function grantMoreTime(form: FormData) {
  const fid = await requireParent();
  const profileId = String(form.get("profileId") ?? "");
  const minutes = Number(form.get("minutes"));
  const p = await db.getProfile(profileId);
  if (p && p.familyId === fid && [15, 30, 60, -1000].includes(minutes)) {
    const tz = (await db.getFamily(fid)).timezone;
    await grantBonusMinutes(profileId, minutes, tz);
    if (minutes > 0) await pushToFamily(fid, { title: `+${minutes} minutes for ${p.name}`, body: "Added for today.", url: `/parent/settings?kid=${profileId}`, tag: `more-time-${profileId}` });
  }
  revalidatePath("/parent"); revalidatePath("/parent/settings"); revalidatePath("/watch");
  const next = String(form.get("next") ?? "");
  redirect(isLocalPath(next) ? next : `/parent/settings?kid=${profileId}`);
}

// ---- Daily check-in -------------------------------------------------------------

export async function saveCheckin(form: FormData) {
  const fid = await requireParent();
  const profileId = String(form.get("profileId") ?? "");
  const day = String(form.get("day") ?? "");
  const mood = Number(form.get("mood"));
  const note = String(form.get("note") ?? "").trim().slice(0, 280) || undefined;
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== fid || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !(mood >= 1 && mood <= 4)) redirect("/parent/checkin");
  await saveKidDay(fid, { profileId, day, mood, note });
  revalidatePath("/parent/checkin"); revalidatePath("/parent/insights");
  redirect(`/parent/checkin?day=${day}&saved=1`);
}

export async function rememberTimezone(tz: string) {
  const v = await resolveViewer();
  if (v.role === "parent") await saveTimezone(v.familyId, tz);
}

// ---- Billing -------------------------------------------------------------------

async function requestOrigin() {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function startCheckout() {
  const v = await resolveViewer();
  if (v.role !== "parent") redirect("/login?next=/parent/billing");
  if (!billingEnabled) redirect("/parent/billing");
  redirect(await createCheckoutUrl(v.familyId, v.email, await requestOrigin()));
}

export async function openPortal() {
  const v = await resolveViewer();
  if (v.role !== "parent") redirect("/login?next=/parent/billing");
  const url = billingEnabled ? await createPortalUrl(v.familyId, await requestOrigin()) : null;
  redirect(url ?? "/parent/billing");
}

/** Throws the caller to the billing page when the family's trial/subscription doesn't cover new activity. */
async function requirePaid(familyId: string) {
  const { status } = await familyStatus(familyId);
  if (!status.ok) redirect("/parent/billing");
}

// ---- Starter packs + onboarding ---------------------------------------------------

/** Approve every channel in a starter pack: whitelist now, pull + review in the background. */
export async function approvePack(form: FormData) {
  const fid = await requireParent();
  await requirePaid(fid);
  const pack = packById(String(form.get("pack") ?? ""));
  const next = String(form.get("next") ?? "/parent");
  if (!pack) redirect(next);
  const resolved: { id: string; handle: string }[] = [];
  for (const handle of pack.channels) {
    try {
      const meta = await fetchChannelMeta(handle);
      if (!meta || meta.id.startsWith("@")) continue;
      await db.upsertChannel({ ...meta, createdAt: (await db.getChannel(meta.id))?.createdAt ?? new Date().toISOString() });
      await db.addToWhitelist({ familyId: fid, kind: "channel", targetId: meta.id });
      resolved.push({ id: meta.id, handle });
    } catch { /* unknown handle — skip */ }
  }
  revalidatePath("/parent"); revalidatePath("/watch");
  if (resolved.length && process.env.GEMINI_API_KEY) {
    after(async () => {
      for (const { id } of resolved) {
        try {
          const { videos } = await ingestChannel(id, 10, 10);
          await seedChannelReviews(videos, { max: 4 });
        } catch (e) { console.error("pack ingest failed", id, e); }
      }
      revalidatePath("/parent"); revalidatePath("/watch");
    });
  }
  redirect(`${next}${next.includes("?") ? "&" : "?"}pack=${pack.id}`);
}

/** Onboarding step 4: each kid's viewing mode, then mark the family onboarded. */
export async function finishOnboarding(form: FormData) {
  const fid = await requireParent();
  for (const p of await db.listProfiles(fid)) {
    const m = String(form.get(`mode:${p.id}`) ?? "");
    if (m === "locked" || m === "open" || m === "open_ask") await db.upsertProfile({ ...p, mode: m });
  }
  await db.updateFamily(fid, { onboardedAt: new Date().toISOString() });
  revalidatePath("/parent"); revalidatePath("/watch");
  redirect("/start?step=5");
}

/** Skip straight to the dashboard (but still count as onboarded so we don't nag). */
export async function skipOnboarding() {
  const fid = await requireParent();
  await db.updateFamily(fid, { onboardedAt: new Date().toISOString() });
  redirect("/parent");
}

/** Nudge a channel up or down on one kid's home screen. The order is stored on the profile. */
export async function moveChannel(form: FormData) {
  const fid = await requireParent();
  const profileId = String(form.get("profileId") ?? "");
  const channelId = String(form.get("channelId") ?? "");
  const dir = form.get("dir") === "up" ? -1 : 1;
  const p = await db.getProfile(profileId);
  if (!p || p.familyId !== fid) redirect("/parent");
  // Current full order = parent's list, then any approved channels not yet in it (same rule the TV uses).
  const approved = (await db.listWhitelist(fid)).filter((w) => w.kind === "channel").map((w) => w.targetId);
  const order = [...p.channelOrder.filter((id) => approved.includes(id)), ...approved.filter((id) => !p.channelOrder.includes(id))];
  const i = order.indexOf(channelId);
  const j = i + dir;
  if (i >= 0 && j >= 0 && j < order.length) { [order[i], order[j]] = [order[j], order[i]]; await db.upsertProfile({ ...p, channelOrder: order }); }
  revalidatePath("/parent"); revalidatePath("/watch");
  redirect(`/parent?kid=${profileId}#channels`);
}

// ---- Kid profiles -------------------------------------------------------------

/** Kid picks who's watching (or parent picks which kid to look at). */
export type PickResult = { error: string } | null;

/**
 * Choose who's watching.
 *  - Parent (signed in): picks freely; stored in their own cookie.
 *  - Personal device (assigned to a child): can't switch.
 *  - Single-child family: that child, no PIN.
 *  - Shared screen: needs the family PIN (rate-limited per device), and a PIN must have been set.
 *    The choice is stored on the device row, server-side — not in a cookie the screen controls.
 */
export async function selectProfile(_prev: PickResult, form: FormData): Promise<PickResult> {
  const v = await resolveViewer();
  if (!v.familyId) redirect("/pair");
  const id = String(form.get("profileId") ?? "");
  const p = await db.getProfile(id);
  if (!p || p.familyId !== v.familyId) return { error: "That isn't one of this family's kids." };
  const next = String(form.get("next") ?? "/watch");
  const go = () => redirect(isLocalPath(next) ? next : "/watch");
  const c = await cookies();

  if (v.role === "parent") {
    c.set(PROFILE_COOKIE, p.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    go();
  }
  if (v.role !== "device") redirect("/pair");
  if (v.assignedProfileId) return { error: "This screen belongs to one child. A grown-up can change that under Devices." };

  if (v.shared) {
    const fam = await db.getSettings(v.familyId, p.id);
    if (!pinIsSet(fam.pinHash)) return { error: "A grown-up needs to set a family PIN first (Kids → Family settings)." };
    const pin = String(form.get("pin") ?? "");
    try {
      // Count the attempt BEFORE checking it (atomic in the database), so parallel guesses can't
      // slip past the limit. Local dev mode has no device row and no lockout.
      if (v.deviceId !== "local") {
        const claim = await claimDevicePinAttempt(v.deviceId);
        if (!claim.allowed) return { error: claim.secondsLeft ? `Too many tries. Wait ${Math.ceil(claim.secondsLeft / 60)} min.` : "This screen can't switch kids. Ask a grown-up." };
      }
      if (!verifyPin(pin, fam.pinHash)) return { error: "That PIN isn't right." };
      if (v.deviceId !== "local") await devicePinSucceeded(v.deviceId);
    } catch (e) {
      if (e instanceof PinCheckUnavailable) return { error: e.message };
      throw e;
    }
  }

  if (v.deviceId === "local") c.set(PROFILE_COOKIE, p.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  else await setDeviceActiveProfile(v.familyId, v.deviceId, p.id);
  revalidatePath("/watch");
  go();
  return null;
}

/** Parent: make a screen a child's personal device, or shared (PIN to switch). */
export async function assignDeviceAction(form: FormData) {
  const fid = await requireParent();
  const deviceId = String(form.get("deviceId") ?? "");
  const profileId = String(form.get("profileId") ?? "") || null;
  const nextRaw = String(form.get("next") ?? "");
  // Come back to the page that asked (the child page's Screens section), else Devices.
  const back = isLocalPath(nextRaw) ? nextRaw : "/parent/devices";
  if (profileId) {
    const p = await db.getProfile(profileId);
    if (!p || p.familyId !== fid) redirect(withParam(withParam(back, "error", "That child isn't in this family."), "failed", "screens"));
  }
  try {
    await assignDevice(fid, deviceId, profileId);
  } catch {
    redirect(withParam(withParam(back, "error", "Couldn't change that screen. Reload and try again."), "failed", "screens"));
  }
  revalidatePath("/parent/devices"); revalidatePath("/parent/settings"); revalidatePath("/parent/kids");
  redirect(withParam(withParam(back, "saved", "screens"), "screen", deviceId));
}

/** Parent: "Add & review" from a video page — library source + start the review. Not authorization. */
export async function addAndReview(form: FormData) {
  const fid = await requireParent();
  await requirePaid(fid);
  const videoId = String(form.get("videoId") ?? "");
  const remove = form.get("remove") === "1";
  let started = false; // a review job really was started (so the page may say "Reviewing now")
  try {
    if (remove) await db.removeFromWhitelist(fid, "video", videoId, null);
    else {
      await addVideoToLibrary(db, fid, videoId);
      const video = await db.getVideo(videoId);
      if (video && !reviewEligibility(await db.getCard(videoId)).eligible && process.env.GEMINI_API_KEY) {
        started = true;
        after(async () => {
          try { await db.upsertCard(await reviewVideo(videoId, { durationSeconds: video.durationSeconds })); }
          catch (e) { console.error("add & review failed", videoId, (e as Error).message); }
          revalidatePath(`/parent/video/${videoId}`); revalidatePath("/watch");
        });
      }
    }
  } catch (e) {
    if (e instanceof GrantError) redirect(`/parent/video/${videoId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/parent/video/${videoId}`); revalidatePath("/parent");
  // `reviewing` carries when the job started, so the page stops saying "Reviewing now" if it never finished.
  redirect(`/parent/video/${videoId}${remove ? "?removed=1" : `?added=1${started ? `&reviewing=${Date.now()}` : ""}`}`);
}

/** Parent: allow one specific video for one child (the explicit approval). Unreviewed videos need a confirm step. */
export async function allowVideoForChild(form: FormData) {
  const fid = await requireParent();
  const videoId = String(form.get("videoId") ?? "");
  const profileId = String(form.get("profileId") ?? "");
  const undo = form.get("undo") === "1";
  try {
    if (undo) await decideForChild(db, fid, profileId, videoId, "undo");
    else await allowForChild(db, fid, profileId, videoId, { confirmedUnreviewed: confirmed(form) });
  } catch (e) {
    if (e instanceof NeedsUnreviewedConfirm) redirect(`/parent/video/${videoId}?confirm=${encodeURIComponent(profileId)}`);
    if (e instanceof GrantError) redirect(`/parent/video/${videoId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/parent/video/${videoId}`); revalidatePath("/parent"); revalidatePath("/watch");
  redirect(`/parent/video/${videoId}?allowed=${encodeURIComponent(profileId)}${undo ? "&undone=1" : ""}`);
}

/** Parent: lift a family-wide "Keep hidden" left over from before per-child permissions. */
export async function unhideForFamily(form: FormData) {
  const fid = await requireParent();
  const videoId = String(form.get("videoId") ?? "");
  try { await unhideForFamilyGrant(db, fid, videoId); }
  catch (e) { if (e instanceof GrantError) redirect(`/parent/video/${videoId}?error=${encodeURIComponent(e.message)}`); throw e; }
  revalidatePath(`/parent/video/${videoId}`); revalidatePath("/parent"); revalidatePath("/watch");
  redirect(`/parent/video/${videoId}`);
}

/**
 * Parent: manage a family-wide block (only pre-0018 data has these).
 *  - split: one block per current child, so each can be changed separately (nobody is unblocked)
 *  - remove: unblock for every child — needs confirm=1, after the page shows what that changes
 */
export async function manageFamilyBlock(form: FormData) {
  const fid = await requireParent();
  const videoId = String(form.get("videoId") ?? "");
  const op = String(form.get("op") ?? "");
  try {
    if (op === "split") await splitFamilyBlock(db, fid, videoId);
    else if (op === "remove") {
      if (form.get("confirm") !== "1") redirect(`/parent/video/${videoId}?unblockAll=1`);
      await removeFamilyBlock(db, fid, videoId);
    } else redirect(`/parent/video/${videoId}`);
  } catch (e) {
    if (e instanceof GrantError) redirect(`/parent/video/${videoId}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/parent/video/${videoId}`); revalidatePath("/parent"); revalidatePath("/parent/review"); revalidatePath("/watch");
  redirect(`/parent/video/${videoId}`);
}

/** Parent: re-assign or dismiss an approval from before approvals were per-child. */
export async function resolveLegacyAction(form: FormData) {
  const fid = await requireParent();
  const id = String(form.get("legacyId") ?? "");
  const allowFor = String(form.get("allowFor") ?? "");
  try {
    await resolveLegacy(db, fid, id, allowFor ? { allowFor } : "dismiss", { confirmedUnreviewed: confirmed(form) });
  } catch (e) {
    if (e instanceof NeedsUnreviewedConfirm) redirect(unreviewedConfirmUrl(e, "legacy", id, e.profileId));
    if (e instanceof GrantError) redirect(`/parent/review?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/parent/review"); revalidatePath("/watch");
  redirect(`/parent/review${allowFor ? `?kid=${encodeURIComponent(allowFor)}` : ""}`); // stay on the child you were deciding for
}

/**
 * The player asks what's next. Re-derived from a FRESH authorization of this child's library (and
 * today's time limits), so a stale client playlist can't play something a parent just restricted.
 */
export async function nextVideo(currentId: string, order: string[]): Promise<{ id: string; title: string } | null> {
  const v = await resolveViewer();
  if (!v.familyId || !v.profileId) return null;
  const settings = await childSettings(v.familyId, v.profileId);
  if (!settings) return null;
  const family = await db.getFamily(v.familyId);
  if (!(await timeState(v.familyId, settings, family.timezone)).allowed) return null;
  const fresh = playableFor(await getLibrary(v.familyId, v.profileId), settings);
  const n = nextAuthorized(fresh, currentId, order.slice(0, 500));
  return n ? { id: n.id, title: n.title } : null;
}

export type ProfileResult = { ok: true } | { error: string } | null;

export async function saveProfile(_prev: ProfileResult, form: FormData): Promise<ProfileResult> {
  const fid = await requireParent();
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 30);
  if (!name) return { error: "Give them a name." };
  const ageRaw = Number(form.get("age"));
  const age = Number.isFinite(ageRaw) && ageRaw > 0 ? Math.min(17, ageRaw) : undefined;
  const avatar = String(form.get("avatar") ?? "🦊").slice(0, 4);
  const interests = String(form.get("interests") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);
  const existing = id ? await db.getProfile(id) : undefined;
  if (id && (!existing || existing.familyId !== fid)) return { error: "Not your kid." };
  const base = existing ?? { ...DEFAULT_PROFILE(fid, name, age), sort: (await db.listProfiles(fid)).length };
  // A new kid inherits sensible defaults for their age: under 5 → locked; 5+ → ask-first.
  const mode = existing ? existing.mode : (age ?? 6) < 5 ? "locked" : "open_ask";
  const saved = await db.upsertProfile({ ...base, id: existing?.id ?? "", name, age, avatar, interests, mode });
  revalidatePath("/parent"); revalidatePath("/parent/kids"); revalidatePath("/watch");
  if (!existing) { const c = await cookies(); c.set(PROFILE_COOKIE, saved.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 }); }
  return { ok: true };
}

export async function deleteProfile(form: FormData) {
  const fid = await requireParent();
  const id = String(form.get("id") ?? "");
  const p = await db.getProfile(id);
  if (p && p.familyId === fid && (await db.listProfiles(fid)).length > 1) await db.deleteProfile(id);
  revalidatePath("/parent"); revalidatePath("/parent/kids");
  redirect("/parent/kids");
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
async function settleCheck(familyId: string, videoId: string, deviceId: string | undefined, checkId: string | null, profileId?: string): Promise<CheckResult> {
  const settings = await childSettings(familyId, profileId);
  if (!profileId || !settings) { await finishCheck(checkId, "failed"); return { status: "error", message: "Pick who's watching first" }; }
  const lib = await getLibrary(familyId, profileId);
  const row = lib.find((x) => x.id === videoId);
  if (!row) throw new Error("Video vanished");
  const decision = authorize(row, settings);
  if (decision.allow) {
    // A record for THIS child only; it grants nothing once they're out of Open mode (authorize ignores it).
    if (decision.basis === "open") await recordOpenClearance(db, familyId, profileId, videoId);
    await finishCheck(checkId, "passed");
    revalidatePath("/watch");
    revalidatePath("/watch/search");
    return { status: "playing", videoId };
  }
  const { reasons } = screen(row, settings);
  await createRequest(familyId, videoId, deviceId, reasons[0], profileId);
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
  const profileId = v.profileId;
  const settings = await childSettings(familyId, profileId);
  if (!profileId || !settings) return { status: "error", message: "Pick who's watching first" };
  if (!(await familyStatus(familyId)).status.ok) return { status: "error", message: "Ask a grown-up to renew Brightframe" };
  if (settings.mode === "locked") return { status: "error", message: "Search is off" };
  const deviceId = v.role === "device" ? v.deviceId : undefined;
  if ((await checksToday(familyId, profileId)) >= settings.dailyCheckLimit) return { status: "limit" };

  try {
    const video = await ingestVideo(videoId);
    const existing = await db.getCard(video.id);
    if ((!existing || existing.reviewer.model === "sample") && (video.durationSeconds ?? 0) > MAX_KID_CHECK_SECONDS) {
      // Too long to auto-check: hand it to the parent instead of burning minutes of Gemini time.
      const minutes = Math.round((video.durationSeconds ?? 0) / 60);
      await createRequest(familyId, video.id, deviceId, `Too long to auto-check (${minutes} min)`, profileId);
      await logCheck(familyId, video.id, deviceId, "needs_parent", profileId);
      revalidatePath("/parent");
      return { status: "asked", videoId: video.id, reasons: [`Too long to auto-check (${Math.round((video.durationSeconds ?? 0) / 60)} min)`] };
    }
    if (existing && existing.reviewer.model !== "sample") {
      const checkId = await logCheck(familyId, video.id, deviceId, "pending", profileId);
      return await settleCheck(familyId, video.id, deviceId, checkId, profileId);
    }
    const checkId = await logCheck(familyId, video.id, deviceId, "pending", profileId);
    after(async () => {
      try {
        await db.upsertCard(await reviewVideo(video.id, { durationSeconds: video.durationSeconds, budget: "kid" }));
        await settleCheck(familyId, video.id, deviceId, checkId, profileId);
      } catch (e) {
        if (e instanceof BudgetExceededError || e instanceof IncompleteReviewError) {
          // Out of reviewer budget, or the AI's review came back incomplete (nothing is stored for it):
          // ask the parent instead of failing the kid. The video stays unreviewed, so it doesn't play.
          if (e instanceof IncompleteReviewError) console.error(e.message);
          await createRequest(familyId, video.id, deviceId, "Couldn't be checked automatically right now", profileId);
          await finishCheck(checkId, "needs_parent");
          revalidatePath("/parent");
          return;
        }
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
  redirect(`/parent/video/${videoId}?reviewing=${Date.now()}`);
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
  const n = await pushToFamily(fid, { title: "Brightframe is set up 🎉", body: "You'll get a ping here when your kid asks for a video.", url: "/parent", tag: "test" });
  redirect(`/parent?push=${n}`);
}

/** Dashboard: review the next few unreviewed videos from this family's approved channels, in the background. */
export async function reviewNextBatch(form?: FormData) {
  const n = Math.min(20, Math.max(1, Number(form?.get("n")) || 10));
  const fid = await requireParent();
  after(async () => {
    try {
      await runPipeline({ familyId: fid, maxReviews: n, uploadsPerChannel: 10 });
      revalidatePath("/parent"); revalidatePath("/watch");
    } catch (e) {
      console.error("batch review failed", (e as Error).message);
    }
  });
  redirect(`/parent?batch=${n}`);
}
