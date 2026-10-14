import { notFound, redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { childSettings, getLibrary, playableFor } from "@/lib/queries";
import { db } from "@/lib/db";
import { Player } from "./player";
import { timeState } from "@/lib/screentime";
import { kidUi } from "@/lib/kid-ui-server";

export const dynamic = "force-dynamic";

export default async function PlayPage(props: PageProps<"/watch/[id]">) {
  const { id } = await props.params;
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  if (!viewer.profileId) redirect(`/watch/who?next=/watch/${id}`);
  const [lib, settings] = await Promise.all([getLibrary(viewer.familyId, viewer.profileId), childSettings(viewer.familyId, viewer.profileId)]);
  if (!settings) redirect("/watch/who");
  const feed = playableFor(lib, settings); // the one gate; the player re-asks the server at every advance
  const i = feed.findIndex((v) => v.id === id);
  if (i < 0) notFound(); // not approved / doesn't pass — kid mode never plays it
  const playlist = feed.map((v) => ({ id: v.id, title: v.title }));
  const family = await db.getFamily(viewer.familyId);
  const time = await timeState(viewer.familyId, settings, family.timezone);
  if (!time.allowed) redirect("/watch");
  const skip = settings.skipLimit
    ? { limit: settings.skipLimit, regen: settings.skipRegen ?? 1, cooldownSec: settings.skipCooldownSec ?? 120, freePeekSec: settings.freePeekSec ?? 30 }
    : undefined;
  const sp = await props.searchParams;
  const ui = await kidUi(sp.ui);
  return <Player playlist={playlist} index={i} remainingMinutes={time.remainingMinutes} stopsAt={time.stopsAt} skip={skip} ui={ui === "tv" ? "tv" : "touch"} fromSearch={sp.from === "search"} />;
}
