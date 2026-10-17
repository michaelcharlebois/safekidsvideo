import { redirect } from "next/navigation";
import { supabaseEnabled } from "@/lib/supabase/server";
import { QA_FAMILIES, qaLoginEnabled } from "@/lib/qa-login";
import { qaSignIn } from "@/app/qa-login-action";
import { LoginForm } from "./login-form";
import { screenInThisBrowser } from "@/lib/family";

export const dynamic = "force-dynamic";

export default async function LoginPage(props: PageProps<"/login">) {
  if (!supabaseEnabled) redirect("/unlock");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/parent";
  const linkFailed = sp.error === "link";
  const qaEnabled = qaLoginEnabled();
  const screen = await screenInThisBrowser();
  return (
    <main className="flex-1 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <p className="text-accent font-extrabold text-sm tracking-widest uppercase">Parents</p>
        <h1 className="mt-2 text-2xl font-extrabold">Sign in</h1>
        {screen && (
          <div role="note" data-screen-notice className="mt-5 rounded-2xl border border-warn/40 bg-warn-soft p-4 text-left text-sm">
            <p className="font-bold text-ink">This browser is the kid screen &ldquo;{screen.name}&rdquo;.</p>
            <p className="mt-1 text-muted">Signing in here disconnects it, so it stops working as a kid screen. To use it for your child again, sign out and pair it with a new code. To keep it connected, sign in on your phone or another browser instead.</p>
          </div>
        )}
        {qaEnabled && (
          <section className="mt-6 rounded-2xl border border-sand bg-surface p-4 text-left">
            <h2 className="font-extrabold text-forest">QA test families</h2>
            <p className="mt-1 text-sm text-muted">Staging only. No email or code needed.</p>
            <div className="mt-3 space-y-2">
              {QA_FAMILIES.map((family) => (
                <form action={qaSignIn} key={family.id}>
                  <input type="hidden" name="family" value={family.id} />
                  <button type="submit" className="w-full rounded-xl border border-sand bg-ivory px-4 py-3 text-left transition-colors hover:border-forest hover:bg-sage-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                    <span className="block font-bold text-forest">{family.label}</span>
                    <span className="block text-xs text-muted">{family.description}</span>
                  </button>
                </form>
              ))}
            </div>
            {sp.error === "qa" && <p role="alert" className="mt-3 text-sm font-bold text-bad">QA sign-in failed. Check the staging test accounts and configuration.</p>}
          </section>
        )}
        <div className={qaEnabled ? "mt-7 border-t border-sand pt-6" : "mt-2"}>
          <p className="text-muted text-sm">We&apos;ll email you a sign-in code. No password to remember.</p>
          {linkFailed && <p className="mt-2 text-bad text-sm font-bold">That link didn&apos;t work — request a new code and type it in here instead.</p>}
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
