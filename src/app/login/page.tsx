import { redirect } from "next/navigation";
import { supabaseEnabled } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage(props: PageProps<"/login">) {
  if (!supabaseEnabled) redirect("/unlock");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/parent";
  const linkFailed = sp.error === "link";
  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="text-accent font-extrabold text-sm tracking-widest uppercase">Parents</p>
        <h1 className="mt-2 text-2xl font-extrabold">Sign in</h1>
        <p className="mt-1 text-muted text-sm">We&apos;ll email you a sign-in code. No password to remember.</p>
        {linkFailed && <p className="mt-2 text-bad text-sm font-bold">That link didn&apos;t work — request a new code and type it in here instead.</p>}
        <LoginForm next={next} />
      </div>
    </main>
  );
}
