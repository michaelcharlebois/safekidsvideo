import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { channelBySlug, channelReport } from "@/lib/channel-report";
import { ChannelReportView } from "@/components/channel-report-view";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/logo";

export const revalidate = 3600; // public, cacheable for an hour

export async function generateMetadata(props: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const c = await channelBySlug(slug);
  if (!c) return { title: "Channel not found · Sift" };
  const r = await channelReport(c.id);
  const d = r?.reviewed
    ? `Sift reviewed ${r.reviewed} ${c.title} videos end to end: typical ages ${r.ageFit?.min}–${r.ageFit?.max}, parent rating ${r.avgRating}/5, ${r.pace.frenetic ? Math.round((100 * r.pace.frenetic) / r.reviewed) : 0}% frenetic. What comes up, best picks, and the one to skip.`
    : `Is ${c.title} OK for your kid? Sift's AI watches every video and tells parents what's in it.`;
  return { title: `Is ${c.title} OK for kids? · Sift report card`, description: d, openGraph: { title: `${c.title} — Sift report card`, description: d, images: c.thumbnailUrl ? [c.thumbnailUrl] : [] } };
}

/** Public, shareable, indexable report card. No family data — just the channel and its cards. */
export default async function PublicChannelPage(props: PageProps<"/c/[slug]">) {
  const { slug } = await props.params;
  const c = await channelBySlug(slug);
  if (!c) notFound();
  const r = await channelReport(c.id);
  if (!r) notFound();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 space-y-5">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <Link href="/login"><Button className="text-sm">Try it free</Button></Link>
      </header>
      <div className="flex items-start gap-3">
        {c.thumbnailUrl && <Image src={c.thumbnailUrl} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded-full object-cover bg-line" />}
        <div>
          <p className="text-accent font-extrabold text-xs tracking-widest uppercase">Report card</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">Is {c.title} OK for kids?</h1>
          <p className="text-sm text-muted">{c.handle} · every video below was watched end to end by Sift&apos;s reviewer, then checked by parents.</p>
        </div>
      </div>
      <ChannelReportView r={r} videoHref={() => null} />
      <section className="rounded-2xl bg-ink text-bg p-5">
        <h2 className="text-xl font-extrabold">Want this for every channel your kid watches?</h2>
        <p className="mt-1 text-sm opacity-80">Sift gives kids a locked YouTube viewer on the TV and gives you the content card for every video before they see it. Per-kid filters, screen-time limits, and an &ldquo;ask a grown-up&rdquo; button that pings your phone. 30 days free.</p>
        <Link href="/login" className="mt-3 inline-block"><Button className="bg-bg text-ink hover:bg-bg/90">Start free →</Button></Link>
      </section>
    </main>
  );
}
