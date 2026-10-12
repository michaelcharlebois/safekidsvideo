import { UnlockForm } from "./unlock-form";

export default async function UnlockPage(props: PageProps<"/unlock">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/parent";
  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-xs text-center">
        <h1 className="text-2xl font-extrabold">Parents only</h1>
        <p className="mt-1 text-muted text-sm">Enter your 4-digit PIN. (Default is 1234 — change it in settings.)</p>
        <UnlockForm next={next} />
      </div>
    </main>
  );
}
