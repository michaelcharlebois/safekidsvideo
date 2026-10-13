import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer, listActiveCodes } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { PACKS } from "@/lib/packs";
import { MODE_LABELS, type FamilyMode } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { approvePack, finishOnboarding, newPairingCode, skipOnboarding } from "@/app/actions";
import { KidForm } from "@/app/parent/kids/kid-form";
import { SearchAdd } from "@/app/parent/search-add";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STEPS = ["How it works", "Your kids", "Trusted channels", "How they watch", "Connect a TV"];

/** First-run setup for a new family. Five short steps; every one can be revisited from the dashboard. */
export default async function StartPage(props: PageProps<"/start">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/start" : "/unlock?next=/start");
  const fid = v.familyId;
  const step = Math.min(5, Math.max(1, Number(sp.step ?? 1) || 1));
  const [profiles, whitelist, lib] = await Promise.all([db.listProfiles(fid), db.listWhitelist(fid), step >= 3 ? db.listChannels() : Promise.resolve([])]);
  const approvedChannels = whitelist.filter((w) => w.kind === "channel").map((w) => w.targetId);
  const approvedTitles = approvedChannels.map((id) => lib.find((c) => c.id === id)?.title ?? id);
  const editing = typeof sp.edit === "string" ? profiles.find((p) => p.id === sp.edit) : undefined;
  const codes = step === 5 && supabaseEnabled ? await listActiveCodes(fid) : [];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 space-y-5">
      <header>
        <p className="text-accent font-extrabold text-sm tracking-widest uppercase">Set up Brightframe</p>
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold">
          {STEPS.map((s, i) => (
            <li key={s} className={i + 1 === step ? "text-ink" : i + 1 < step ? "text-ok" : "text-muted"}>{i + 1 < step ? "✓" : `${i + 1}.`} {s}</li>
          ))}
        </ol>
      </header>

      {step === 1 && (
        <Card className="p-5 space-y-4">
          <h1 className="text-2xl font-extrabold">YouTube, but only what you&apos;d pick.</h1>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><span className="text-2xl">🤖</span><span><b>An AI watches every video first.</b> Not the thumbnail — the whole thing. It writes a content card: what happens, what age it fits, and anything a parent would want to know (scary bits, yelling, ads, pace), with timestamps.</span></li>
            <li className="flex gap-3"><span className="text-2xl">👨‍👩‍👧</span><span><b>You decide what counts.</b> Per kid: which concerns to filter, whether they can search beyond your approved channels, and how much screen time. Other parents&apos; confirmations sharpen the cards over time.</span></li>
            <li className="flex gap-3"><span className="text-2xl">📺</span><span><b>Kids get a locked viewer.</b> On the TV, tablet or phone: big tiles, no comments, no rabbit holes, no way out without your PIN. &ldquo;Ask a grown-up&rdquo; pings your phone; you approve from the card.</span></li>
          </ul>
          <p className="text-xs text-muted">Your first 30 days are free. No card needed to start.</p>
          <div className="flex items-center justify-between">
            <form action={skipOnboarding}><button type="submit" className="text-sm font-bold text-muted hover:text-ink">Skip setup</button></form>
            <Link href="/start?step=2"><Button>Let&apos;s go →</Button></Link>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-5 space-y-4">
          <h1 className="text-2xl font-extrabold">Who&apos;s this for?</h1>
          <p className="text-sm text-muted">Each kid gets their own filters, limits and &ldquo;who&apos;s watching&rdquo; tile on the TV. Interests help us suggest channels.</p>
          {profiles.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {profiles.map((p) => (
                <li key={p.id}>
                  <Link href={`/start?step=2&edit=${p.id}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold ${editing?.id === p.id ? "border-ink bg-ink text-bg" : "border-line hover:bg-surface"}`}>
                    <span className="text-lg">{p.avatar}</span>{p.name}{p.age ? `, ${p.age}` : ""}
                  </Link>
                </li>
              ))}
              {editing && <li><Link href="/start?step=2" className="inline-flex items-center rounded-full border border-dashed border-line px-3 py-1.5 text-sm font-bold text-muted">+ another kid</Link></li>}
            </ul>
          )}
          <KidForm key={editing?.id ?? "new"} profile={editing} canDelete={!!editing && profiles.length > 1} />
          <div className="flex items-center justify-between pt-2">
            <Link href="/start?step=1" className="text-sm font-bold text-muted hover:text-ink">← Back</Link>
            <Link href="/start?step=3"><Button disabled={profiles.length === 0}>Next →</Button></Link>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="p-5 space-y-4">
          <h1 className="text-2xl font-extrabold">Channels you already trust</h1>
          <p className="text-sm text-muted">Pick a starter pack or two, then search for anything else — &ldquo;Numberblocks&rdquo;, &ldquo;Bluey&rdquo;, a cooking channel they love. Approving a channel pulls in its best videos and reviews them in the background.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PACKS.map((p) => (
              <form key={p.id} action={approvePack} className="rounded-xl border border-line p-3 flex flex-col gap-2">
                <input type="hidden" name="pack" value={p.id} />
                <input type="hidden" name="next" value="/start?step=3" />
                <p className="font-extrabold"><span className="text-xl mr-1">{p.emoji}</span>{p.title} <span className="text-muted font-bold text-xs">· ages {p.ages}</span></p>
                <p className="text-xs text-muted flex-1">{p.blurb}</p>
                <p className="text-[11px] text-muted">{p.channels.map((c) => c.replace(/^@/, "")).join(" · ")}</p>
                <Button type="submit" variant={sp.pack === p.id ? "ghost" : "primary"} className="text-xs px-3 py-1.5">{sp.pack === p.id ? "✓ Added" : "Add this pack"}</Button>
              </form>
            ))}
          </div>
          <SearchAdd approvedChannels={approvedChannels} approvedVideos={[]} />
          {approvedTitles.length > 0 && <p className="text-sm"><b>Approved so far:</b> {approvedTitles.join(", ")}</p>}
          <div className="flex items-center justify-between pt-2">
            <Link href="/start?step=2" className="text-sm font-bold text-muted hover:text-ink">← Back</Link>
            <Link href="/start?step=4"><Button>Next →</Button></Link>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card className="p-5 space-y-4">
          <h1 className="text-2xl font-extrabold">How should each kid watch?</h1>
          <p className="text-sm text-muted">You can change this any time. Filters (scary stuff, yelling, ads…) are on the dashboard and start with sensible defaults for each age.</p>
          <form action={finishOnboarding} className="space-y-5">
            {profiles.map((p) => (
              <fieldset key={p.id} className="rounded-xl border border-line p-3">
                <legend className="px-1 font-extrabold"><span className="mr-1">{p.avatar}</span>{p.name}</legend>
                <div className="space-y-1.5 mt-1">
                  {(Object.keys(MODE_LABELS) as FamilyMode[]).map((m) => (
                    <label key={m} className="flex items-start gap-2 text-sm">
                      <input type="radio" name={`mode:${p.id}`} value={m} defaultChecked={p.mode === m} className="mt-1 accent-accent" />
                      <span><b>{MODE_LABELS[m].title}</b> — <span className="text-muted">{MODE_LABELS[m].blurb}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="flex items-center justify-between">
              <Link href="/start?step=3" className="text-sm font-bold text-muted hover:text-ink">← Back</Link>
              <Button type="submit">Finish →</Button>
            </div>
          </form>
        </Card>
      )}

      {step === 5 && (
        <Card className="p-5 space-y-4">
          <h1 className="text-2xl font-extrabold">You&apos;re set. Now connect a screen.</h1>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>On the TV, tablet or phone your kid will use, open <b>siftkids.com/pair</b> (or the Brightframe app).</li>
            <li>Type this code. It works once and expires in 10 minutes.</li>
            <li>Pick who&apos;s watching, and hand it over.</li>
          </ol>
          {supabaseEnabled ? (
            <div className="space-y-2">
              {codes.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {codes.map((c) => <li key={c.code} className="rounded-xl bg-sun px-5 py-3 text-2xl sm:text-3xl font-extrabold tracking-[0.2em]">{c.code}</li>)}
                </ul>
              )}
              <form action={newPairingCode}>
                <input type="hidden" name="next" value="/start?step=5" />
                <Button type="submit" variant={codes.length ? "ghost" : "primary"}>{codes.length ? "Make another code" : "Make a code"}</Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-muted">Local mode: just open <b>/watch</b> on this device.</p>
          )}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted">Add more devices later under <b>Devices</b>.</span>
            <Link href="/parent"><Button>Go to the dashboard →</Button></Link>
          </div>
        </Card>
      )}
    </main>
  );
}
