// The feedback loop: parents correct cards → stats → distilled calibration notes → better reviews.
// Importable from scripts (no "server-only").

import { GoogleGenAI } from "@google/genai";
import { db } from "@/lib/db/resolve";
import { BudgetExceededError, reviewVideo, DEFAULT_MODEL } from "@/lib/reviewer";
import { CONCERN_LABELS, CONCERN_TAGS, type ConcernTag, type Confirmation, type ContentCard, type FeedbackStats, type ReviewerNotes } from "@/lib/types";
import { isFound } from "@/lib/gate";

export const isDisagreement = (c: Confirmation) =>
  c.verdict !== "agree" || Object.values(c.tagVotes ?? {}).some((v) => v !== "agree") || (c.ageVote && c.ageVote !== "right");

/** Tally the last `days` of feedback: overall verdicts, per-tag agree/overcall/missed, age-fit votes. */
export async function feedbackStats(days = 90): Promise<FeedbackStats> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const all = await db.listAllConfirmations(since);
  const stats: FeedbackStats = { confirmations: all.length, agree: 0, tooStrict: 0, tooLenient: 0, perTag: {}, age: { younger: 0, right: 0, older: 0 }, since };
  for (const c of all) {
    if (c.verdict === "agree") stats.agree++;
    else if (c.verdict === "too_strict") stats.tooStrict++;
    else stats.tooLenient++;
    for (const [tag, vote] of Object.entries(c.tagVotes ?? {}) as [ConcernTag, "agree" | "overcall" | "missed"][]) {
      const t = (stats.perTag[tag] ??= { agree: 0, overcall: 0, missed: 0 });
      t[vote]++;
    }
    for (const tag of c.tags ?? []) { // legacy flags = missed
      const t = (stats.perTag[tag] ??= { agree: 0, overcall: 0, missed: 0 });
      if (!c.tagVotes?.[tag]) t.missed++;
    }
    if (c.ageVote) stats.age[c.ageVote]++;
  }
  return stats;
}

function describeCard(card: ContentCard | undefined) {
  if (!card) return "(no card)";
  const present = card.concerns.filter(isFound).map((c) => `${c.tag}:${c.intensity}${c.evidence ? ` (${c.evidence})` : ""}`);
  return `ages ${card.ageFit.min}–${card.ageFit.max}, pace ${card.pace}, format ${card.format}, rating ${card.rating}; concerns: ${present.join("; ") || "none"}`;
}

/**
 * Distil recent disagreements into ≤15 general calibration guidelines and save them as a new
 * notes version. Returns null when there's nothing new to learn from.
 */
export async function learnFromFeedback(opts: { days?: number; minDisagreements?: number; log?: (s: string) => void } = {}): Promise<ReviewerNotes | null> {
  const log = opts.log ?? (() => {});
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const since = new Date(Date.now() - (opts.days ?? 90) * 86_400_000).toISOString();
  const [all, current, stats] = await Promise.all([db.listAllConfirmations(since), db.getReviewerNotes(), feedbackStats(opts.days ?? 90)]);
  const disputes = all.filter(isDisagreement);
  const newSince = current ? disputes.filter((d) => d.createdAt > current.createdAt) : disputes;
  if (newSince.length < (opts.minDisagreements ?? 1)) { log("nothing new to learn from"); return null; }

  const videoIds = [...new Set(disputes.map((d) => d.videoId))];
  const [videos, cards, channels] = await Promise.all([Promise.all(videoIds.map((id) => db.getVideo(id))), db.listCards(videoIds), db.listChannels()]);
  const cardById = new Map(cards.map((c) => [c.videoId, c]));
  const channelById = new Map(channels.map((c) => [c.id, c.title]));
  const videoById = new Map(videos.filter(Boolean).map((v) => [v!.id, v!]));

  const evidence = disputes.slice(0, 60).map((d) => {
    const v = videoById.get(d.videoId);
    const votes = Object.entries(d.tagVotes ?? {}).filter(([, vote]) => vote !== "agree").map(([t, vote]) => `${t}=${vote}`).join(", ");
    return [
      `• "${v?.title ?? d.videoId}" (${channelById.get(v?.channelId ?? "") ?? v?.channelId ?? "?"})`,
      `  card: ${describeCard(cardById.get(d.videoId))}`,
      `  parent (kid ${d.kidAge ?? "?"}): ${d.verdict}${votes ? `; tags: ${votes}` : ""}${d.ageVote && d.ageVote !== "right" ? `; age range too ${d.ageVote === "younger" ? "cautious" : "permissive"}` : ""}${d.note ? `; note: "${d.note}"` : ""}`,
    ].join("\n");
  }).join("\n");

  const tagLines = CONCERN_TAGS.map((t) => {
    const s = stats.perTag[t];
    return s ? `${CONCERN_LABELS[t]} (${t}): agree ${s.agree}, over-called ${s.overcall}, missed ${s.missed}` : null;
  }).filter(Boolean).join("\n");

  const prompt = `You maintain the calibration notes for an AI that reviews kids' YouTube videos for parents of 3–8 year olds.
The reviewer tags 12 concerns (${CONCERN_TAGS.join(", ")}) with intensity 0–3, sets an age range, pace, and a rating.
Parents then confirm or dispute its cards. Your job: turn their feedback into a SHORT list of general guidelines that would have
prevented the disagreements, without making the reviewer sloppy about real concerns.

CURRENT NOTES (v${current?.version ?? 0}):
${current?.notes?.trim() || "(none yet)"}

FEEDBACK STATS (last ${opts.days ?? 90} days, ${stats.confirmations} confirmations: ${stats.agree} agree, ${stats.tooStrict} too strict, ${stats.tooLenient} too lenient; age votes younger/right/older ${stats.age.younger}/${stats.age.right}/${stats.age.older}):
${tagLines || "(no per-tag votes yet)"}

DISPUTED CARDS:
${evidence}

Write the NEW full notes list (replace, don't append). Rules:
- At most 15 bullets, each one line, each a general rule ("X counts as Y only when…"), never naming a specific video.
- Naming a channel or genre is fine when the pattern is about that channel/genre.
- Keep rules from the current notes that still hold; drop or rewrite ones the new feedback contradicts.
- One parent's opinion is a hint, not a rule: phrase single-report patterns softly ("lean toward…"), repeated patterns firmly.
- Never add a rule that tells the reviewer to ignore a concern category entirely.
Return only the bullet list.`;

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({ model: DEFAULT_MODEL, contents: prompt, config: { temperature: 0.3 } });
  const notes = (res.text ?? "").trim();
  if (!notes) throw new Error("empty notes from model");
  const saved = await db.saveReviewerNotes({ notes, stats, source: "learn" });
  log(`saved reviewer notes v${saved.version} from ${disputes.length} disputed cards`);
  return saved;
}

/**
 * Re-review cards whose latest feedback disputes them and postdates the card.
 * The reviewer sees the dispute but is told to change findings only when the footage supports it.
 */
export async function rereviewDisputed(opts: { max?: number; days?: number; log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const since = new Date(Date.now() - (opts.days ?? 30) * 86_400_000).toISOString();
  const disputes = (await db.listAllConfirmations(since)).filter(isDisagreement);
  const byVideo = new Map<string, Confirmation[]>();
  for (const d of disputes) byVideo.set(d.videoId, [...(byVideo.get(d.videoId) ?? []), d]);
  const notes = (await db.getReviewerNotes()) ?? null;
  let reviewed = 0, failed = 0;
  for (const [videoId, list] of byVideo) {
    if (reviewed + failed >= (opts.max ?? 5)) break;
    const card = await db.getCard(videoId);
    if (!card || (card.reviewer.revisions ?? 0) >= 2) continue; // don't ping-pong forever
    if (!list.some((d) => d.createdAt > card.reviewer.reviewedAt)) continue; // already re-reviewed since
    const video = await db.getVideo(videoId);
    if (!video || (video.durationSeconds ?? 0) > 20 * 60) continue;
    const feedback = list.map((d) => {
      const votes = Object.entries(d.tagVotes ?? {}).filter(([, v]) => v !== "agree")
        .map(([t, v]) => `${CONCERN_LABELS[t as ConcernTag]} was ${v === "overcall" ? "over-called (parent says it's not really there / not at that intensity)" : "missed (parent says it IS there)"}`);
      return `- Parent of a ${d.kidAge ?? "?"}-year-old: ${d.verdict.replace("_", " ")}${votes.length ? ". " + votes.join("; ") : ""}${d.ageVote && d.ageVote !== "right" ? `. Age range is too ${d.ageVote === "younger" ? "cautious — fine for younger kids" : "permissive — needs older kids"}` : ""}${d.note ? `. Note: "${d.note}"` : ""}`;
    }).join("\n");
    try {
      log(`re-reviewing: ${video.title}`);
      await db.upsertCard(await reviewVideo(videoId, { durationSeconds: video.durationSeconds, notes, feedback, previous: card }));
      reviewed++;
    } catch (e) {
      if (e instanceof BudgetExceededError) { log(e.message); break; }
      failed++;
      log(`failed: ${video.title} — ${(e as Error).message}`);
    }
  }
  return { reviewed, failed };
}
