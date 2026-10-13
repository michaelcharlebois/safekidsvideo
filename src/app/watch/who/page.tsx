import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { PickTile, PinPad } from "./pick";

export const dynamic = "force-dynamic";

/**
 * "Who's watching?" — one big tile per kid, remote-friendly.
 * Shared screens need the family PIN to choose (or switch); personal screens can't switch at all.
 * The choice is enforced server-side in selectProfile — this page is just the way in.
 */
export default async function WhoPage(props: PageProps<"/watch/who">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/watch";
  const profiles = await db.listProfiles(viewer.familyId);

  if (viewer.role === "device" && viewer.assignedProfileId) {
    const p = profiles.find((x) => x.id === viewer.assignedProfileId);
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <p className="text-7xl">{p?.avatar}</p>
        <h1 className="mt-3 text-3xl font-extrabold">This is {p?.name}&apos;s screen</h1>
        <p className="mt-2 text-[var(--kmuted)] font-semibold">A grown-up can change that under Devices.</p>
        <Link href="/watch" className="bigbtn mt-6 rounded-full bg-white/10 px-6 py-3 text-xl font-extrabold">Back</Link>
      </main>
    );
  }

  const needsPin = viewer.role === "device" && viewer.shared;
  const picking = typeof sp.pick === "string" ? profiles.find((p) => p.id === sp.pick) : undefined;
  if (needsPin && picking) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <p className="text-6xl">{picking.avatar}</p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold">Grown-up PIN to watch as {picking.name}</h1>
        <PinPad profileId={picking.id} next={next} />
        <Link href={`/watch/who?next=${encodeURIComponent(next)}`} className="bigbtn mt-4 rounded-full bg-white/5 px-5 py-2 font-bold text-[var(--kmuted)]">Back</Link>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
      <h1 className="text-3xl sm:text-4xl font-extrabold">Who&apos;s watching?</h1>
      {needsPin && <p className="mt-2 text-[var(--kmuted)] font-semibold">A grown-up enters the PIN to pick.</p>}
      <ul className="shelf mt-8 justify-center">
        {profiles.map((p) => (
          <li key={p.id} className="tile !w-44 sm:!w-52">
            {needsPin ? (
              <Link href={`/watch/who?pick=${p.id}&next=${encodeURIComponent(next)}`} className="flex w-full flex-col items-center gap-3 px-4 py-6 outline-none">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-6xl">{p.avatar}</span>
                <span className="text-xl font-extrabold">{p.name}</span>
              </Link>
            ) : (
              <PickTile profileId={p.id} next={next} avatar={p.avatar} name={p.name} />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
