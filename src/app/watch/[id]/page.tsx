import { notFound, redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { canPlay, getLibrary } from "@/lib/queries";
import { db } from "@/lib/db";
import { Player } from "./player";
import { timeState } from "@/lib/screentime";

export const dynamic = "force-dynamic";

export default async function PlayPage(props: PageProps<"/watch/[id]">) {
  const { id } = await props.params;
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const [lib, settings] = await Promise.all([getLibrary(viewer.familyId), db.getSettings(viewer.familyId, viewer.profileId)]);
  const feed = lib.filter((v) => canPlay(v, settings));
  const i = feed.findIndex((v) => v.id === id);
  if (i < 0) notFound(); // not approved / doesn't pass — kid mode never plays it
  const playlist = feed.map((v) => ({ id: v.id, title: v.title }));
  const family = await db.getFamily(viewer.familyId);
  const time = await timeState(viewer.familyId, settings, family.timezone);
  if (!time.allowed) redirect("/watch");
  return <Player playlist={playlist} index={i} remainingMinutes={time.remainingMinutes} />;
}
