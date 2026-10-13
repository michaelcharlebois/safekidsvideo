"use client";

import { useEffect } from "react";
import { rememberTimezone } from "@/app/actions";

/** Tell the server which timezone this parent lives in, once, so "today" and the evening nudge line up. */
export function TimezoneSync({ current }: { current?: string }) {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) void rememberTimezone(tz);
  }, [current]);
  return null;
}
