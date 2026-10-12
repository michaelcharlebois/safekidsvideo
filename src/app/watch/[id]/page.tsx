import { notFound, redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { getKidFeed } from "@/lib/queries";
import { Player } from "./player";

export const dynamic = "force-dynamic";

export default async function PlayPage(props: PageProps<"/watch/[id]">) {
  const { id } = await props.params;
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const feed = await getKidFeed(viewer.familyId);
  const i = feed.findIndex((v) => v.id === id);
  if (i < 0) notFound(); // not approved (or filtered out) — kid mode never plays it
  const playlist = feed.map((v) => ({ id: v.id, title: v.title }));
  return <Player playlist={playlist} index={i} />;
}
