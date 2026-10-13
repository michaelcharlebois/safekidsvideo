// AI video reviewer: a public YouTube URL in, a structured ContentCard out.
// Uses Gemini because it accepts YouTube URLs natively — no downloading, no ToS gray area.

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { CONCERN_TAGS, FORMATS, type ContentCard } from "@/lib/types";
import { videoUrl } from "@/lib/youtube";

export const REVIEWER_VERSION = "1";

/** $ per million tokens. Override with GEMINI_PRICE_IN_PER_M / GEMINI_PRICE_OUT_PER_M as pricing changes. */
const PRICE_IN = Number(process.env.GEMINI_PRICE_IN_PER_M ?? 0.3);
const PRICE_OUT = Number(process.env.GEMINI_PRICE_OUT_PER_M ?? 2.5);
export const estimateCost = (inputTokens: number, outputTokens: number) =>
  Math.round(((inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1e6) * 1e5) / 1e5;
export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

const FindingSchema = z.object({
  tag: z.enum(CONCERN_TAGS),
  present: z.boolean(),
  intensity: z.number().int().min(0).max(3),
  timestamp: z.string().optional().describe("mm:ss of the clearest example; omit if not present"),
  evidence: z.string().optional().describe("one short sentence a parent can verify in ten seconds; omit if not present"),
});

export const CardSchema = z.object({
  synopsis: z.string().describe("2–3 plain sentences describing what happens in the video"),
  format: z.enum(FORMATS).describe("What kind of video this is; gameplay_commentary = someone playing a video game (Minecraft, Roblox, etc.) and talking over it"),
  ageFit: z.object({ min: z.number().int().min(0).max(14), max: z.number().int().min(0).max(14) }),
  concerns: z.array(FindingSchema).describe("One entry for EVERY tag in the taxonomy, present or not"),
  pace: z.enum(["calm", "moderate", "frenetic"]),
  educationalValue: z.number().min(0).max(5),
  rating: z.number().min(0).max(5).describe("Overall parent-friendliness for the stated age range"),
  parentRecommendation: z.string().describe("One or two blunt sentences: should a parent of a 4–7 year old allow this, and with what caveat"),
  confidence: z.number().min(0).max(1),
});

export type ReviewResult = z.infer<typeof CardSchema>;

const TAXONOMY = `
Concern tags (report ALL of them, present or not):
- violence: fighting, hitting, weapons, explosions, characters being hurt
- scary_imagery: dark scenes, jump scares, threatening faces, creepy music, horror aesthetics
- monsters: monsters, ghosts, zombies, villains designed to frighten (even cartoonish)
- loud_or_jarring: sudden loud sound effects, screaming, abrupt volume jumps, sirens, alarms
- yelling_or_meanness: characters yelling at each other, bullying, name-calling, cruelty
- sad_themes: death, loss, abandonment, crying that is sustained, separation from parents
- potty_humor: poop/fart/burp jokes, toilet content
- ads_or_toys: toy unboxing, product placement, sponsored content, "buy this"
- fast_paced: cuts every 1–3 seconds, flashing, constant motion, sensory overload
- unsafe_behavior: things a child might copy — jumping from heights, eating non-food, playing with fire, hiding from parents
- romance: crushes, kissing, dating themes
- inappropriate_language: swearing, slurs, sexual references, crude slang

Intensity: 0 none, 1 mild/brief, 2 moderate or recurring, 3 strong or central to the video.
Give a timestamp (mm:ss) and one-line evidence for every tag that is present.`;

const FORMAT_GUIDE = `
Format (pick exactly one):
- song: nursery rhymes, singalongs, music videos
- story_animation: animated or puppet stories with a plot
- educational: letters, numbers, science, how-things-work
- live_action_kids: real people presenting a kids' show (e.g. Blippi, Ms Rachel)
- gameplay_commentary: screen recording of a video game (Minecraft, Roblox, Fortnite...) with someone talking over it
- unboxing_toys: opening or playing with toys/products on camera
- vlog_challenge: family vlogs, challenges, pranks, "24 hours in..."
- compilation: mashups, shorts compilations, "best of" edits
- other`;

const SYSTEM = `You are a careful children's media reviewer helping parents of 3–8 year olds decide what their kids can watch on YouTube.
Watch the ENTIRE video. The moment parents care about is often a single 20-second stretch — a scary face, a loud crash, a sad goodbye — so do not skim.
Be concrete and skeptical. Titles and thumbnails lie; judge only what is actually on screen and on the soundtrack.
Err toward flagging: a parent can always decide a mild concern is fine, but they cannot un-see something you missed.
Pay special attention to pacing and sound, which reviewers tend to under-report.
${TAXONOMY}
${FORMAT_GUIDE}`;

/** Frames per second to send Gemini: full rate for short videos, sparser for long ones (cost + speed). */
export function fpsForDuration(seconds?: number): number | undefined {
  if (!seconds || seconds <= 8 * 60) return undefined; // Gemini default (1 fps)
  if (seconds <= 20 * 60) return 0.5;
  return 0.25;
}

export type ReviewOpts = {
  model?: string;
  durationSeconds?: number;
  /** Calibration guidelines learned from parent feedback (appended to the system prompt). */
  notes?: { version: number; notes: string } | null;
  /** For a re-review: what parents disputed about the previous card. */
  feedback?: string;
  /** Previous card, when re-reviewing. */
  previous?: ContentCard;
};

export async function reviewVideo(videoId: string, opts: ReviewOpts = {}): Promise<ContentCard> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = opts.model ?? DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });
  const notes = opts.notes === undefined ? await loadNotes() : opts.notes;
  const system = notes?.notes.trim()
    ? `${SYSTEM}\n\nCALIBRATION FROM PARENT FEEDBACK (v${notes.version}) — these correct known tendencies of yours; follow them unless the video clearly shows otherwise:\n${notes.notes.trim()}`
    : SYSTEM;
  const ask = opts.feedback
    ? `Review this video for parents. This is a RE-REVIEW: parents disputed the previous card as follows.\n${opts.feedback}\n` +
      `Re-watch with that in mind. Parents are often right about their own kids but not always — change a finding only when what is on screen supports the change, and keep it otherwise. Return only the JSON card.`
    : "Review this video for parents. Return only the JSON card.";

  const res = await withRetry(() => ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: { fileUri: videoUrl(videoId), mimeType: "video/*" },
            ...(fpsForDuration(opts.durationSeconds) ? { videoMetadata: { fps: fpsForDuration(opts.durationSeconds) } } : {}),
          },
          { text: ask },
        ],
      },
    ],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(CardSchema),
      temperature: 0.2,
    },
  }));

  const text = res.text;
  if (!text) throw new Error(`Empty response from ${model} for ${videoId}`);
  const u = res.usageMetadata;
  const inputTokens = u?.promptTokenCount ?? 0, outputTokens = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
  const usage = { inputTokens, outputTokens, costUsd: estimateCost(inputTokens, outputTokens) };
  const parsed = CardSchema.parse(JSON.parse(text));

  // Guarantee one finding per tag, in taxonomy order.
  const byTag = new Map(parsed.concerns.map((c) => [c.tag, c]));
  const concerns = CONCERN_TAGS.map((tag) => {
    const c = byTag.get(tag);
    return c
      ? { ...c, intensity: c.intensity as 0 | 1 | 2 | 3, present: c.present && c.intensity > 0 }
      : { tag, present: false, intensity: 0 as const };
  });

  return {
    videoId,
    synopsis: parsed.synopsis,
    format: parsed.format,
    ageFit: parsed.ageFit,
    concerns,
    pace: parsed.pace,
    educationalValue: round1(parsed.educationalValue),
    rating: round1(parsed.rating),
    parentRecommendation: parsed.parentRecommendation,
    confidence: Math.round(parsed.confidence * 100) / 100,
    reviewer: {
      model, version: REVIEWER_VERSION, reviewedAt: new Date().toISOString(),
      revisions: (opts.previous?.reviewer.revisions ?? 0) + (opts.feedback ? 1 : 0),
      notesVersion: notes?.version,
    },
    usage,
  };
}

/** Latest calibration notes, if the store has any. Quietly none when it doesn't. */
async function loadNotes(): Promise<{ version: number; notes: string } | null> {
  try {
    const { db } = await import("@/lib/db/resolve");
    return (await db.getReviewerNotes()) ?? null;
  } catch {
    return null;
  }
}

const round1 = (n: number) => Math.round(n * 2) / 2;

/** Retry transient API errors (503 overloaded, 429 rate limit) with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let delay = 3000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const transient = /"code":(503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/.test(msg);
      if (!transient || i >= attempts) throw e;
      process.stdout.write(`(busy, retry ${i}/${attempts - 1} in ${delay / 1000}s) `);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
  }
}
