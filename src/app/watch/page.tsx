import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { getKidFeed } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const feed = await getKidFeed(viewer.familyId);
  return (
    <main className="flex-1 px-4 pb-8">
      {feed.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-3xl font-extrabold">No videos yet</p>
          <p className="mt-2 text-muted font-semibold">Ask a grown-up to approve some.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {feed.map((v) => (
            <li key={v.id}>
              <Link href={`/watch/${v.id}`} className="block rounded-2xl bg-surface p-2 shadow-sm active:scale-[0.97] transition">
                <Image
                  src={v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                  alt=""
                  width={480}
                  height={270}
                  unoptimized
                  draggable={false}
                  className="w-full aspect-video rounded-xl object-cover bg-line"
                />
                <p className="mt-2 px-1 pb-1 font-extrabold leading-snug line-clamp-2 text-base">{v.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
