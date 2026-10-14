// Library: the full inventory of one child's content and what each video's status is for them. Pure, so
// the Library page and the tests agree. Statuses come only from the gate (lib/status.ts); this file just
// counts, filters, searches and groups them.
import { inventoryFor } from "@/lib/kid-home";
import { playStatus, type PlayStatus } from "@/lib/status";
import type { Channel, FamilySettings, VideoWithCard } from "@/lib/types";

/** Library filters, in display order. Every status a library video can have, plus "all". */
export const LIBRARY_FILTERS = ["all", "plays", "allowed", "held", "uncertain", "reviewing", "hidden", "blocked"] as const;
/**
 * Groups for the numbers Home shows, so a count and the list it opens always match:
 *   ready    — everything that plays for the child (Plays + Allowed by you)
 *   held_any — everything their settings hold back automatically (Held back + Couldn't be sure)
 */
export const LIBRARY_GROUPS = { ready: ["plays", "allowed"], held_any: ["held", "uncertain"] } as const satisfies Record<string, readonly PlayStatus[]>;
export const GROUP_LABEL: Record<keyof typeof LIBRARY_GROUPS, string> = { ready: "Plays and Allowed by you", held_any: "Held back and Couldn't be sure" };
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number] | keyof typeof LIBRARY_GROUPS;
export const isLibraryFilter = (x: unknown): x is LibraryFilter => typeof x === "string" && ((LIBRARY_FILTERS as readonly string[]).includes(x) || x in LIBRARY_GROUPS);
/** The statuses a filter shows (a group shows several). */
export const statusesOf = (f: LibraryFilter): readonly PlayStatus[] | null => (f === "all" ? null : f in LIBRARY_GROUPS ? LIBRARY_GROUPS[f as keyof typeof LIBRARY_GROUPS] : [f as PlayStatus]);

export type LibraryItem = { v: VideoWithCard; status: PlayStatus; reasons: string[] };

const newest = (a: LibraryItem, b: LibraryItem) => (b.v.publishedAt ?? b.v.createdAt ?? "").localeCompare(a.v.publishedAt ?? a.v.createdAt ?? "");

/** Every video in this child's library with its status for them, newest first. */
export function libraryFor(lib: VideoWithCard[], s: FamilySettings): LibraryItem[] {
  return inventoryFor(lib, s).map((v) => ({ v, ...playStatus(v, s) })).sort(newest);
}

export function libraryCounts(items: LibraryItem[]): Record<LibraryFilter, number> {
  const c = Object.fromEntries([...LIBRARY_FILTERS, ...Object.keys(LIBRARY_GROUPS)].map((f) => [f, 0])) as Record<LibraryFilter, number>;
  c.all = items.length;
  for (const i of items) if (i.status in c) c[i.status as LibraryFilter]++;
  for (const [g, members] of Object.entries(LIBRARY_GROUPS)) c[g as LibraryFilter] = members.reduce((a, m) => a + c[m], 0);
  return c;
}

/** Status filter, channel filter and a title/channel search, all optional. */
export function filterLibrary(items: LibraryItem[], o: { filter?: LibraryFilter; channelId?: string; q?: string }): LibraryItem[] {
  const q = o.q?.trim().toLowerCase();
  return items.filter((i) =>
    (!o.filter || (statusesOf(o.filter) ?? [i.status]).includes(i.status))
    && (!o.channelId || i.v.channelId === o.channelId)
    && (!q || i.v.title.toLowerCase().includes(q) || (i.v.channel?.title ?? "").toLowerCase().includes(q)));
}

export type ChannelGroup = { channelId: string; title: string; channel?: Channel; items: LibraryItem[]; plays: number; total: number };

/**
 * Group by channel, in the child's channel order (then by name). `total`/`plays` describe the whole channel
 * for this child, so a filtered group can still say "12 of 40 play for Maya".
 */
export function groupByChannel(shown: LibraryItem[], all: LibraryItem[], order: string[] = []): ChannelGroup[] {
  const byChannel = new Map<string, LibraryItem[]>();
  for (const i of shown) byChannel.set(i.v.channelId, [...(byChannel.get(i.v.channelId) ?? []), i]);
  const pos = new Map(order.map((id, n) => [id, n]));
  return [...byChannel.entries()].map(([channelId, items]) => {
    const whole = all.filter((i) => i.v.channelId === channelId);
    return {
      channelId, items,
      channel: items[0].v.channel,
      title: items[0].v.channel?.title ?? channelId.replace(/^@/, ""),
      plays: whole.filter((i) => i.status === "plays" || i.status === "allowed").length,
      total: whole.length,
    };
  }).sort((a, b) => (pos.get(a.channelId) ?? 1e9) - (pos.get(b.channelId) ?? 1e9) || a.title.localeCompare(b.title));
}
