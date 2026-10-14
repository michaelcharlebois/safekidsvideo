import { redirect } from "next/navigation";

/** Viewing stats are part of Activity now; old links keep their child and period. */
export default async function StatsPage(props: PageProps<"/parent/stats">) {
  const sp = await props.searchParams;
  const q = new URLSearchParams();
  if (typeof sp.kid === "string") q.set("kid", sp.kid);
  if (sp.range === "30") q.set("range", "30");
  redirect(`/parent/activity${q.size ? `?${q}` : ""}`);
}
