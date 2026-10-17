import { redirect } from "next/navigation";
import { supabaseEnabled } from "@/lib/supabase/server";
import { PairForm } from "./pair-form";
import { RemoteNav } from "@/app/watch/remote-nav";
import { resolveViewer } from "@/lib/family";

/** The screen a kid's tablet lands on before it's paired. */
export const dynamic = "force-dynamic";

export default async function PairPage() {
  if (!supabaseEnabled) redirect("/watch");
  const signedInParent = (await resolveViewer()).role === "parent";
  return (
    <main className="kid-mode flex-1 flex items-center justify-center px-6">
      <RemoteNav home="/pair" />
      <div className="w-full max-w-sm text-center">
        <p className="text-4xl">📺</p>
        <h1 className="mt-2 text-2xl font-extrabold">Connect this device</h1>
        <p className="mt-1 text-[var(--kmuted)] text-sm">
          A grown-up: open the parent dashboard on your phone, go to <b>Devices</b>, and type the 8-digit code here.
        </p>
        {signedInParent && (
          <p role="note" data-parent-notice className="mt-4 rounded-2xl border border-[var(--kline,rgba(255,255,255,0.2))] p-3 text-left text-sm text-[var(--kmuted)]">
            You&apos;re signed in as a parent in this browser. Connecting turns it into a kid screen and signs you out <b>here only</b>. Your phone and other browsers stay signed in.
          </p>
        )}
        <PairForm />
      </div>
    </main>
  );
}
