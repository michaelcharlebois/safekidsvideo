// Family sources: adding channels and videos to the library every child shares. Each child's own settings
// still decide what plays for them. Used by Library (and Home until its source sections move).
import { Button, Card, SectionHeader } from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { approvePack } from "@/app/actions";
import { PACKS } from "@/lib/packs";
import type { VideoWithCard } from "@/lib/types";
import { AddForm } from "../add-form";
import { SearchAdd } from "../search-add";

export function AddPanel({ approvedChannels, lib, packAdded, next }: { approvedChannels: Set<string>; lib: VideoWithCard[]; packAdded?: string; next: string }) {
  return (
    <Card as="section" className="p-5">
      <SectionHeader icon={<IconPlus />} title="Add a channel" sub="Search YouTube and add from the results. Brightframe reviews the channel's videos before any can play." />
      <SearchAdd approvedChannels={[...approvedChannels]} approvedVideos={lib.filter((v) => v.inLibrary).map((v) => v.id)} />
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-bold text-forest">Paste a link instead</summary>
        <AddForm />
      </details>
      <details className="mt-3 text-sm" open={approvedChannels.size === 0}>
        <summary className="cursor-pointer font-bold text-forest">Starter packs</summary>
        <div className="mt-2 space-y-2">
          {PACKS.map((p) => (
            <form key={p.id} action={approvePack} className="flex items-center gap-3 rounded-xl border border-sand p-3">
              <input type="hidden" name="pack" value={p.id} />
              <input type="hidden" name="next" value={next} />
              <span className="text-2xl" aria-hidden>{p.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-forest">{p.title} <span className="text-xs font-semibold text-muted">ages {p.ages}</span></span>
                <span className="block text-xs text-muted">{p.blurb}</span>
              </span>
              <Button type="submit" variant={packAdded === p.id ? "secondary" : "primary"} size="sm">{packAdded === p.id ? "Added" : "Add"}</Button>
            </form>
          ))}
        </div>
      </details>
    </Card>
  );
}
