import { notFound } from "next/navigation";
import { DEMO_PIN, demoKeyOk } from "@/lib/demo";
import { Wordmark } from "@/components/logo";

export const dynamic = "force-dynamic";

/** The page a reviewer gets the link to. Two doors and a reset. */
export default async function DemoPage(props: PageProps<"/demo">) {
  const sp = await props.searchParams;
  const key = typeof sp.key === "string" ? sp.key : "";
  if (!demoKeyOk(key)) notFound();
  const q = `key=${encodeURIComponent(key)}`;
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10 space-y-6">
      <Wordmark size={32} />
      <div>
        <h1 className="text-3xl">Try Brightframe</h1>
        <p className="mt-2 text-muted">A demo family with two kids — Maya, 6, and Leo, 4 — and a few channels already approved. Nothing you do here touches anyone else&apos;s account.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <a href={`/demo/parent?${q}`} className="block rounded-2xl border border-line bg-surface p-5 hover:border-ink/40">
          <p className="text-xl font-display">Parent</p>
          <p className="mt-1 text-sm text-muted">The dashboard: approve channels, read content cards, review what&apos;s hidden, set limits per kid.</p>
        </a>
        <a href={`/demo/kid?${q}`} className="block rounded-2xl bg-[#0b1020] p-5 text-white hover:ring-2 hover:ring-[#ffcf3f]">
          <p className="text-xl font-display">Kid screen</p>
          <p className="mt-1 text-sm text-white/70">What the TV or tablet shows. Arrow keys work like a remote. Open it in a second window or a private window.</p>
        </a>
      </div>
      <div className="rounded-2xl bg-surface border border-line p-4 text-sm text-muted space-y-1">
        <p><b className="text-ink">Tips.</b> Use two windows side by side: kid screen in one, parent in the other. On the kid screen, Maya can search and &ldquo;Ask a grown-up&rdquo; — the request shows up on the parent dashboard. The kid screen is a shared screen, so picking or switching kids asks for the parent PIN: <b className="text-ink">{DEMO_PIN}</b>. To get from the kid screen to the parent side, use the Parent door on this page rather than the ⚙ (that asks for a real sign-in).</p>
        <p><a href={`/demo/parent?${q}&reset=1`} className="font-bold underline">Reset the demo family</a> to start fresh.</p>
      </div>
    </main>
  );
}
