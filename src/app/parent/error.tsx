"use client";

import Link from "next/link";
import { Button, buttonClass, Card } from "@/components/ui";
import { IconAlert } from "@/components/icons";

/** A parent page failed to load. Say so plainly and offer the two useful next steps. */
export default function ParentError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <Card className="p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad"><IconAlert /></span>
        <h1 className="mt-3 text-xl">This page didn&apos;t load</h1>
        <p className="mt-1 text-sm text-muted">Your settings and approvals are unchanged. Try again; if it keeps happening, the reference below helps us find it.</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/parent" className={buttonClass("secondary")}>Go to Home</Link>
        </div>
        {error.digest && <p className="mt-4 text-xs text-muted">Reference: {error.digest}</p>}
      </Card>
    </main>
  );
}
