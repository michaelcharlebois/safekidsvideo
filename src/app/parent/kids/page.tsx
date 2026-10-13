import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { pinIsSet } from "@/lib/pin";
import { loadChildFacts } from "@/lib/kid-facts";
import { MODE_UI } from "@/lib/modes";
import { Button, buttonClass, Card, EmptyState, Notice, SectionHeader } from "@/components/ui";
import { IconChevron, IconKids, IconPlus, IconShield } from "@/components/icons";
import { saveSettings } from "@/app/actions";
import { ChildSummary } from "./child-summary";
import { KidForm } from "./kid-form";

export const dynamic = "force-dynamic";

/**
 * Kids: every child at a glance (what they can watch, when, how they ask, where), a way into each child's
 * page, adding a child, and the few settings that apply to the whole family (kept apart and labelled).
 */
export default async function KidsPage(props: PageProps<"/parent/kids">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/kids" : "/unlock?next=/parent/kids");
  const [{ facts }, family] = await Promise.all([loadChildFacts(v.familyId), db.getSettings(v.familyId)]);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const pinSet = pinIsSet(family.pinHash);
  const shared = facts.length > 1;

  return (
    <main className="mx-auto w-full max-w-[76rem] px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title sm:text-display">Kids</h1>
          <p className="text-sm text-muted sm:text-base">What each child can watch, when, and how they ask for more.</p>
        </div>
        <a href="#add" className={buttonClass("secondary")}><IconPlus size={18} />Add a child</a>
      </header>

      <div className="mt-5 space-y-3">
        {str("error") && <Notice tone="bad">{str("error")}</Notice>}
        {str("saved") === "family" && <Notice tone="ok">Family settings saved.</Notice>}
        {shared && !pinSet && (
          <Notice tone="warn"><b>Set a family PIN.</b> Shared screens can&apos;t pick or switch children until you do. <a href="#family" className="font-bold text-forest underline">Set it below</a></Notice>
        )}
      </div>

      {facts.length === 0 ? (
        <Card className="mt-6"><EmptyState icon={<IconKids />} title="Add your first child">Each child gets their own viewing mode, content rules and screen time.</EmptyState></Card>
      ) : (
        <ul className="mt-6 space-y-6">
          {facts.map((f) => (
            <li key={f.profile.id}>
              <Card as="article" className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-3xl ring-1 ring-sand" aria-hidden>{f.profile.avatar}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl leading-tight">{f.profile.name}</h2>
                    <p className="text-sm text-muted">{f.profile.age ? `${f.profile.age} years old` : "Age not set"}, {MODE_UI[f.settings.mode].title} mode</p>
                  </div>
                  <Link href={`/parent/settings?kid=${f.profile.id}`} className={buttonClass("primary")}>Manage {f.profile.name}<IconChevron size={16} /></Link>
                </div>
                <div className="border-t border-sand">
                  <ChildSummary f={f} link={(sec) => `/parent/settings?kid=${f.profile.id}#${sec}`} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card as="section" className="p-5" >
          <div id="add" className="scroll-mt-20" />
          <SectionHeader icon={<IconPlus />} title="Add a child" sub="Name, age and a picture. You can set everything else on their page." />
          <div className="mt-4"><KidForm canDelete={false} /></div>
        </Card>

        <Card as="section" className="p-5">
          <div id="family" className="scroll-mt-20" />
          <SectionHeader icon={<IconShield />} title="Family settings" sub="These apply to every child." />
          <form action={saveSettings} className="mt-4 space-y-4">
            <input type="hidden" name="section" value="family" />
            <input type="hidden" name="next" value="/parent/kids#family" />
            <label className="block space-y-1 text-sm">
              <span className="font-bold text-forest">Family PIN</span>
              <span className="block text-muted">Needed to pick or switch children on a shared screen, like the living-room TV. {pinSet ? "A PIN is set." : "Not set yet."} Any 4 digits except 1234.</span>
              <input type="password" name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder={pinSet ? "New PIN" : "Choose a PIN"} autoComplete="new-password"
                className="w-36 rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest" />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-bold text-forest">Reports from other parents</span>
              <span className="block text-muted">Hold a video back when at least this many parents report something a child&apos;s settings block, even if the AI review didn&apos;t flag it. Reports can only make things stricter.</span>
              <input type="number" name="flagThreshold" min={1} max={50} defaultValue={family.flagThreshold}
                className="w-24 rounded-xl border border-sand bg-surface px-3 py-2.5 text-sm outline-none focus:border-forest" />
            </label>
            <Button type="submit">Save family settings</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
