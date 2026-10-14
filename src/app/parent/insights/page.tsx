import { redirect } from "next/navigation";

/** Insights (check-ins next to viewing) are part of Activity now. */
export default async function InsightsPage(props: PageProps<"/parent/insights">) {
  const sp = await props.searchParams;
  redirect(`/parent/activity${typeof sp.kid === "string" ? `?kid=${encodeURIComponent(sp.kid)}` : ""}#checkins`);
}
