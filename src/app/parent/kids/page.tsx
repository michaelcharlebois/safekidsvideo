import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/family";
import { supabaseEnabled } from "@/lib/supabase/server";
import { Card, TopBar } from "@/components/ui";
import { MODE_LABELS } from "@/lib/types";
import { KidForm } from "./kid-form";

export const dynamic = "force-dynamic";

/** Your kids: add, edit, remove. Each one has their own filters on the dashboard. */
export default async function KidsPage(props: PageProps<"/parent/kids">) {
  const sp = await props.searchParams;
  const v = await resolveViewer();
  if (v.role !== "parent") redirect(supabaseEnabled ? "/login?next=/parent/kids" : "/unlock?next=/parent/kids");
  const profiles = await db.listProfiles(v.familyId);
  const editing = typeof sp.edit === "string" ? profiles.find((p) => p.id === sp.edit) : undefined;
  return (
    <>
      <TopBar title="Kids" right={<Link href="/parent" className="text-sm font-bold text-muted hover:text-ink">← Dashboard</Link>} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
        <ul className="space-y-2">
          {profiles.map((p) => (
            <li key={p.id}>
              <Card className="p-3 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-3xl">{p.avatar}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold">{p.name}{p.age ? <span className="text-muted font-bold"> · {p.age}</span> : null}</p>
                  <p className="text-xs text-muted truncate">{MODE_LABELS[p.mode].title}{p.interests.length ? ` · likes ${p.interests.join(", ")}` : ""}</p>
                </div>
                <Link href={`/parent/stats?kid=${p.id}`} className="text-sm font-bold text-muted hover:text-ink">Stats</Link>
                <Link href={`/parent/settings?kid=${p.id}`} className="text-sm font-bold text-muted hover:text-ink">Settings</Link>
                <Link href={`/parent/kids?edit=${p.id}`} className="text-sm font-bold text-accent hover:underline">Edit</Link>
              </Card>
            </li>
          ))}
        </ul>
        <Card className="p-4">
          <h2 className="font-extrabold">{editing ? `Edit ${editing.name}` : "Add a kid"}</h2>
          <KidForm key={editing?.id ?? "new"} profile={editing} canDelete={!!editing && profiles.length > 1} />
        </Card>
      </main>
    </>
  );
}
