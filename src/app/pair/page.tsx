import { redirect } from "next/navigation";
import { supabaseEnabled } from "@/lib/supabase/server";
import { PairForm } from "./pair-form";

/** The screen a kid's tablet lands on before it's paired. */
export const dynamic = "force-dynamic";

export default async function PairPage() {
  if (!supabaseEnabled) redirect("/watch");
  return (
    <main className="flex-1 flex items-center justify-center px-6 bg-sky/40">
      <div className="w-full max-w-sm text-center">
        <p className="text-4xl">📺</p>
        <h1 className="mt-2 text-2xl font-extrabold">Connect this device</h1>
        <p className="mt-1 text-muted text-sm">
          A grown-up: open the parent dashboard on your phone, go to <b>Devices</b>, and type the 6-digit code here.
        </p>
        <PairForm />
      </div>
    </main>
  );
}
