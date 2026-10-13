import { Wordmark } from "@/components/logo";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
      <Wordmark size={36} />
      <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight max-w-2xl">
        Know exactly what&apos;s in it before your kid watches it.
      </h1>
      <p className="mt-4 text-muted max-w-xl text-lg">
        Approve the channels and videos you trust. Every video gets a content card — scary bits, loud bits, pacing, age fit — reviewed by AI and confirmed by other parents.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 w-full max-w-lg">
        <Link href="/watch" className="rounded-xl bg-sky p-6 font-extrabold text-xl hover:brightness-95 transition">
          ▶ Kid mode
          <span className="block mt-1 text-sm font-semibold text-muted">Only approved videos. Locked.</span>
        </Link>
        <Link href="/parent" className="rounded-xl bg-surface border border-line p-6 font-extrabold text-xl hover:bg-sun/40 transition">
          ⚙ Parent dashboard
          <span className="block mt-1 text-sm font-semibold text-muted">Approve, review, set filters.</span>
        </Link>
      </div>
    </main>
  );
}
