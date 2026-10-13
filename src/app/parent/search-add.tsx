"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { addByUrl, parentSearch, type AddResult } from "@/app/actions";
import { Button } from "@/components/ui";
import type { ChannelHit, VideoMeta } from "@/lib/youtube";

const fmtCount = (n?: number) => (!n ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const fmtDur = (s?: number) => (s == null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/**
 * Search YouTube from the dashboard and approve straight from the results.
 * Channels first (approving one pulls its recent uploads), then individual videos.
 */
export function SearchAdd({ approvedChannels, approvedVideos }: { approvedChannels: string[]; approvedVideos: string[] }) {
  const [state, search, searching] = useActionState(parentSearch, null);
  const channelSet = new Set(approvedChannels);
  const videoSet = new Set(approvedVideos);
  const r = state?.results;
  return (
    <div className="mt-3 space-y-4">
      <form action={search} className="flex gap-2">
        <input
          name="q"
          required
          type="search"
          defaultValue={state?.query}
          placeholder="Search YouTube — “Super Simple Songs”, “Numberblocks”, “how volcanoes work”…"
          className="flex-1 rounded-full border border-sand bg-surface px-4 py-2.5 text-sm outline-none focus:border-forest"
        />
        <Button type="submit" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
      </form>
      {state?.error && <p className="text-sm font-bold text-bad">{state.error}</p>}

      {r && r.channels.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-forest">Channels</h3>
          <ul className="mt-2 divide-y divide-line">
            {r.channels.map((c) => <ChannelRow key={c.id} c={c} approved={channelSet.has(c.id)} />)}
          </ul>
        </section>
      )}
      {r && r.videos.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-forest">Videos</h3>
          <ul className="mt-2 divide-y divide-line">
            {r.videos.map((v) => <VideoRow key={v.id} v={v} approved={videoSet.has(v.id) || channelSet.has(v.channelId)} />)}
          </ul>
        </section>
      )}
      {r && state.query && !r.channels.length && !r.videos.length && !state.error && (
        <p className="text-sm text-muted">Nothing found for “{state.query}”.</p>
      )}
    </div>
  );
}

function ApproveButton({ target, label, approved, doneLabel = "✓ Added" }: { target: string; label: string; approved: boolean; doneLabel?: string }) {
  const [state, action, pending] = useActionState<AddResult | null, FormData>(addByUrl, null);
  const done = approved || state?.ok;
  return (
    <form action={action} className="shrink-0 text-right">
      <input type="hidden" name="url" value={target} />
      <Button type="submit" disabled={pending || !!done} variant={done ? "ghost" : "primary"} className="text-xs px-3 py-1.5">
        {pending ? "Adding…" : done ? doneLabel : label}
      </Button>
      {state && !state.ok && <p className="mt-1 max-w-[12rem] text-xs font-bold text-bad">{state.error}</p>}
      {state?.ok && <p className="mt-1 max-w-[14rem] text-xs text-muted">{state.message}</p>}
    </form>
  );
}

function ChannelRow({ c, approved }: { c: ChannelHit; approved: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2">
      {c.thumbnailUrl ? (
        <Image src={c.thumbnailUrl} alt="" width={44} height={44} unoptimized className="h-11 w-11 shrink-0 rounded-full object-cover bg-line" />
      ) : <span className="h-11 w-11 shrink-0 rounded-full bg-line" />}
      <div className="min-w-0 flex-1">
        <p className="font-extrabold leading-snug truncate">{c.title}</p>
        <p className="text-xs text-muted truncate">
          {c.handle}{c.subscribers ? ` · ${fmtCount(c.subscribers)} subscribers` : ""}{c.videoCount ? ` · ${fmtCount(c.videoCount)} videos` : ""}
        </p>
        {c.description && <p className="text-xs text-muted line-clamp-1">{c.description}</p>}
      </div>
      <ApproveButton target={c.id} label="Add channel" approved={approved} />
    </li>
  );
}

function VideoRow({ v, approved }: { v: VideoMeta; approved: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Image src={v.thumbnailUrl} alt="" width={128} height={72} unoptimized className="w-24 sm:w-32 shrink-0 rounded-lg aspect-video object-cover bg-line" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold leading-snug line-clamp-2">{v.title}</p>
        <p className="text-xs text-muted truncate">{v.channelTitle}{v.durationSeconds ? ` · ${fmtDur(v.durationSeconds)}` : ""}</p>
        {approved && <Link href={`/parent/video/${v.id}`} className="text-xs font-bold text-accent hover:underline">View card</Link>}
      </div>
      <ApproveButton target={v.id} label="Add & review" approved={approved} doneLabel="✓ In library" />
    </li>
  );
}
