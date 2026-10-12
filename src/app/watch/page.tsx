import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { getKidScreen } from "@/lib/queries";
import { pendingVideoIds } from "@/lib/activity";
import { askGrownUp } from "@/app/actions";
import type { VideoWithCard } from "@/lib/types";

export const dynamic = "force-dynamic";

const thumb = (v: VideoWithCard) => v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const [{ playable, askable }, pending] = await Promise.all([getKidScreen(viewer.familyId), pendingVideoIds(viewer.familyId)]);

  return (
    <main className="flex-1 px-4 pb-8 space-y-8">
      {playable.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-3xl font-extrabold">No videos yet</p>
          <p className="mt-2 text-muted font-semibold">Ask a grown-up to approve some.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {playable.map((v) => (
            <li key={v.id}>
              <Link href={`/watch/${v.id}`} className="block rounded-2xl bg-surface p-2 shadow-sm active:scale-[0.97] transition">
                <Image src={thumb(v)} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line" />
                <p className="mt-2 px-1 pb-1 font-extrabold leading-snug line-clamp-2 text-base">{v.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {askable.length > 0 && (
        <section>
          <h2 className="font-extrabold text-lg text-muted mb-3">🙋 Ask a grown-up</h2>
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {askable.map((v) => {
              const asked = pending.has(v.id);
              return (
                <li key={v.id} className="rounded-2xl bg-surface/70 p-2 shadow-sm">
                  <div className="relative">
                    <Image src={thumb(v)} alt="" width={480} height={270} unoptimized draggable={false} className="w-full aspect-video rounded-xl object-cover bg-line opacity-60 grayscale" />
                    <span className="absolute inset-0 flex items-center justify-center text-4xl">{asked ? "✅" : "🔒"}</span>
                  </div>
                  <p className="mt-2 px-1 font-extrabold leading-snug line-clamp-2 text-sm text-muted">{v.title}</p>
                  <form action={askGrownUp} className="mt-2">
                    <input type="hidden" name="videoId" value={v.id} />
                    <button
                      type="submit"
                      disabled={asked}
                      className={`w-full rounded-full py-2 font-extrabold text-sm ${asked ? "bg-grass text-ink" : "bg-sun active:scale-95"}`}
                    >
                      {asked ? "Asked!" : "Ask"}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
