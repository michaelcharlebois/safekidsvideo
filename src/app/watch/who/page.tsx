import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { selectProfile } from "@/app/actions";

export const dynamic = "force-dynamic";

/** "Who's watching?" — one big tile per kid. Remote-friendly. */
export default async function WhoPage(props: PageProps<"/watch/who">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/watch";
  const profiles = await db.listProfiles(viewer.familyId);
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
      <h1 className="text-3xl sm:text-4xl font-extrabold">Who&apos;s watching?</h1>
      <ul className="shelf mt-8 justify-center">
        {profiles.map((p) => (
          <li key={p.id} className="tile !w-44 sm:!w-52">
            <form action={selectProfile}>
              <input type="hidden" name="profileId" value={p.id} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="flex w-full flex-col items-center gap-3 px-4 py-6 outline-none">
                <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-6xl">{p.avatar}</span>
                <span className="text-xl font-extrabold">{p.name}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
