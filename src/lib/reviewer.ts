// AI video reviewer: a public YouTube URL in, a structured ContentCard out.
// Uses Gemini because it accepts YouTube URLs natively — no downloading, no ToS gray area.

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { CONCERN_TAGS, type ContentCard } from "@/lib/types";
import { videoUrl } from "@/lib/youtube";

export const REVIEWER_VERSION = "1";
export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

const FindingSchema = z.object({
  tag: z.enum(CONCERN_TAGS),
  present: z.boolean(),
  intensity: z.number().int().min(0).max(3),
  timestamp: z.string().optional().describe("mm:ss of the clearest example; omit if not present"),
  evidence: z.string().optional().describe("one short sentence a parent can verify in ten seconds; omit if not present"),
});

export const CardSchema = z.object({
  synopsis: z.string().describe("2–3 plain sentences describing what happens in the video"),
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

const SYSTEM = `You are a careful children's media reviewer helping parents of 3–8 year olds decide what their kids can watch on YouTube.
Watch the ENTIRE video. The moment parents care about is often a single 20-second stretch — a scary face, a loud crash, a sad goodbye — so do not skim.
Be concrete and skeptical. Titles and thumbnails lie; judge only what is actually on screen and on the soundtrack.
Err toward flagging: a parent can always decide a mild concern is fine, but they cannot un-see something you missed.
Pay special attention to pacing and sound, which reviewers tend to under-report.
${TAXONOMY}`;

export async function reviewVideo(videoId: string, opts: { model?: string } = {}): Promise<ContentCard> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const model = opts.model ?? DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  const res = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: videoUrl(videoId), mimeType: "video/*" } },
          { text: "Review this video for parents. Return only the JSON card." },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(CardSchema),
      temperature: 0.2,
    },
  });

  const text = res.text;
  if (!text) throw new Error(`Empty response from ${model} for ${videoId}`);
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
    ageFit: parsed.ageFit,
    concerns,
    pace: parsed.pace,
    educationalValue: round1(parsed.educationalValue),
    rating: round1(parsed.rating),
    parentRecommendation: parsed.parentRecommendation,
    confidence: Math.round(parsed.confidence * 100) / 100,
    reviewer: { model, version: REVIEWER_VERSION, reviewedAt: new Date().toISOString() },
  };
}

const round1 = (n: number) => Math.round(n * 2) / 2;
