import { notFound } from "next/navigation";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import { getKidFeed } from "@/lib/queries";
import { Player } from "./player";

export const dynamic = "force-dynamic";

export default async function PlayPage(props: PageProps<"/watch/[id]">) {
  const { id } = await props.params;
  const feed = await getKidFeed(DEFAULT_FAMILY_ID);
  const i = feed.findIndex((v) => v.id === id);
  if (i < 0) notFound(); // not approved (or filtered out) — kid mode never plays it
  const playlist = feed.map((v) => ({ id: v.id, title: v.title }));
  return <Player playlist={playlist} index={i} />;
}
