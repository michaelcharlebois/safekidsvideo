import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/family";
import { db } from "@/lib/db";
import { BrandMark } from "@/components/logo";
import { kidUi } from "@/lib/kid-ui-server";
import { supabaseEnabled } from "@/lib/supabase/server";
import { ExitButton } from "../exit-button";
import { TvFocus } from "../home/focus-first";
import { PickTile, PinPad } from "./pick";

export const dynamic = "force-dynamic";

/**
 * "Who's watching?" — one big tile per child, for TV (remote), tablet and phone.
 * Who may pick is decided on the server in selectProfile, not here: a shared screen needs the family PIN
 * (with the attempt lockout from 0019); a child's own screen can't switch at all; only a parent's own
 * browser picks without a PIN. This page is just the way in.
 */
export default async function WhoPage(props: PageProps<"/watch/who">) {
  const viewer = await resolveViewer();
  if (!viewer.familyId) redirect("/pair");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/watch";
  const [profiles, ui] = await Promise.all([db.listProfiles(viewer.familyId), kidUi(sp.ui)]);
  const tv = ui === "tv";
  const exitTarget = supabaseEnabled ? "/login?next=/parent" : "/unlock?next=/parent";
  const view = typeof sp.pick === "string" ? `pin-${sp.pick}` : "list";
  const frame = (body: React.ReactNode, back?: string) => (
    <div className={`kid-bf ${tv ? "tv" : "touch"} flex flex-1 flex-col ${tv ? "px-[5vw] pb-[6vh] pt-[4vh]" : "px-5 pb-10 pt-4"}`}>
      {tv && <TvFocus key={view} /> /* re-runs when the page switches between the list and the PIN pad */}
      <header data-nav-row className="flex items-center gap-3">
        <BrandMark tone="dark" size={0} className={tv ? "h-[3.2vw] w-auto" : "h-10 w-auto"} />
        {back && <Link href={back} className={tv ? "bigbtn ml-[1vw] rounded-full px-[1.6vw] py-[0.8vw] text-[1.5vw] font-extrabold text-[var(--kmuted)]" : "ml-2 flex h-12 items-center rounded-full px-4 text-lg font-extrabold text-[var(--kmuted)]"}>Back</Link>}
        <span className="ml-auto"><ExitButton target={exitTarget} /></span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center text-center">{body}</main>
    </div>
  );
  const h1 = tv ? "text-[3vw] font-extrabold" : "text-3xl font-extrabold sm:text-4xl";
  const sub = tv ? "mt-[1vh] text-[1.6vw] font-semibold text-[var(--kmuted)]" : "mt-2 text-base font-semibold text-[var(--kmuted)]";

  // A child's own screen: no switching (enforced in selectProfile too).
  if (viewer.role === "device" && viewer.assignedProfileId) {
    const p = profiles.find((x) => x.id === viewer.assignedProfileId);
    return frame(
      <>
        <Avatar emoji={p?.avatar} tv={tv} />
        <h1 className={`${h1} mt-6`}>This is {p?.name}&apos;s screen</h1>
        <p className={sub}>A grown-up can change that in the grown-up area.</p>
        <Link href="/watch" data-tv-start="" className={tv ? "bigbtn kbtn-primary mt-[5vh] rounded-full bg-[var(--kfocus)] px-[3vw] py-[1vw] text-[1.8vw] font-extrabold text-[#2a1206]" : "mt-8 flex h-14 items-center rounded-full bg-[var(--kfocus)] px-8 text-lg font-extrabold text-[#2a1206]"}>Go to {p?.name}&apos;s videos</Link>
      </>,
    );
  }

  const needsPin = viewer.role === "device" && viewer.shared;
  const picking = typeof sp.pick === "string" ? profiles.find((p) => p.id === sp.pick) : undefined;
  if (needsPin && picking) {
    return frame(
      <>
        <Avatar emoji={picking.avatar} tv={tv} small />
        <h1 className={`${h1} ${tv ? "mt-[2vh] !text-[2.4vw]" : "mt-3 !text-2xl sm:!text-3xl"}`}>A grown-up enters the PIN</h1>
        <p className={sub}>to watch as {picking.name}</p>
        <PinPad profileId={picking.id} next={next} tv={tv} />
      </>,
      `/watch/who?next=${encodeURIComponent(next)}`,
    );
  }

  return frame(
    <>
      <h1 className={h1}>Who&apos;s watching?</h1>
      {needsPin && <p className={sub}>Pick, then a grown-up enters the PIN.</p>}
      <ul className={tv ? "shelf mt-[5vh] !mx-auto !w-fit max-w-full justify-center !overflow-visible" : "mt-8 flex w-full max-w-2xl flex-wrap justify-center gap-4"} data-nav-row>
        {profiles.map((p) => (
          <li key={p.id} className={tv ? "tile !w-[16vw]" : "tile !w-44 sm:!w-52"}>
            {needsPin ? (
              <Link href={`/watch/who?pick=${p.id}&next=${encodeURIComponent(next)}`} aria-label={`${p.name}. A grown-up enters the PIN.`} className={`flex w-full flex-col items-center outline-none ${tv ? "gap-[1.2vw] px-[1vw] py-[2vw]" : "gap-3 px-4 py-6"}`}>
                <Avatar emoji={p.avatar} tv={tv} />
                <span className={tv ? "tv-title text-[1.8vw] font-extrabold" : "text-xl font-extrabold"}>{p.name}</span>
              </Link>
            ) : (
              <PickTile profileId={p.id} next={next} name={p.name} tv={tv}><Avatar emoji={p.avatar} tv={tv} /></PickTile>
            )}
          </li>
        ))}
      </ul>
    </>,
  );
}

function Avatar({ emoji, tv, small = false }: { emoji?: string; tv: boolean; small?: boolean }) {
  const size = tv ? (small ? "h-[6vw] w-[6vw] text-[3.6vw]" : "h-[9vw] w-[9vw] text-[5.4vw]") : small ? "h-20 w-20 text-5xl" : "h-24 w-24 text-6xl sm:h-28 sm:w-28";
  return <span className={`flex items-center justify-center rounded-full bg-[rgb(255_249_241/0.1)] leading-none ${size}`} aria-hidden>{emoji ?? "⭐"}</span>;
}
