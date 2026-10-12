"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Quietly re-fetch the kid screen while something is pending, so approvals show up on their own. */
export function AutoRefresh({ every = 15000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
