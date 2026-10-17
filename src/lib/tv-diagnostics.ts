// Device-side diagnostics for the kid screens (above all the Samsung TV, where there are no developer tools).
// A short ring buffer of what went wrong — script errors, network loss, playback and pairing failures — kept
// in sessionStorage, shown in the grown-up debug panel (press 0 three times), and sent best-effort to the
// server log (/api/tv/diag) so a supervised pilot can be debugged without a cable to the TV.
// Holds no secrets: messages, codes, URLs (path only) and times.

export type DiagKind = "js" | "promise" | "network" | "player" | "pairing" | "page";
export type Diag = { at: string; kind: DiagKind; detail: string; path: string };

const KEY = "bf_diag";
const MAX = 20;
const MAX_REPORTS_PER_PAGE = 10;
let reported = 0;

export function readDiag(): Diag[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function logDiag(kind: DiagKind, detail: string, opts: { report?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const d: Diag = { at: new Date().toISOString(), kind, detail: String(detail).slice(0, 300), path: location.pathname };
  try { sessionStorage.setItem(KEY, JSON.stringify([...readDiag(), d].slice(-MAX))); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent("bf-diag", { detail: d })); } catch { /* old engine */ }
  if (opts.report === false || reported >= MAX_REPORTS_PER_PAGE || navigator.onLine === false) return;
  reported++;
  try {
    const body = JSON.stringify(d);
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/tv/diag", new Blob([body], { type: "application/json" }))))
      void fetch("/api/tv/diag", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* best effort */ }
}

/** YouTube IFrame API onError codes, in words a grown-up can act on. */
export function youTubeErrorText(code: number): string {
  switch (code) {
    case 2: return "YouTube error 2: the request was invalid (bad video id)";
    case 5: return "YouTube error 5: the TV's video player couldn't play this video (HTML5 player error)";
    case 100: return "YouTube error 100: the video was removed or made private";
    case 101: case 150: return `YouTube error ${code}: the uploader doesn't allow this video to play outside YouTube`;
    default: return `YouTube error ${code}`;
  }
}

/** Window-level listeners: script errors, unhandled promise rejections, going offline. Returns a cleanup. */
export function installDiagnostics(): () => void {
  const onError = (e: ErrorEvent) => logDiag("js", `${e.message || "Script error"}${e.filename ? ` (${e.filename.replace(location.origin, "")}:${e.lineno})` : ""}`);
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | undefined;
    logDiag("promise", r?.message || String(e.reason));
  };
  const onOffline = () => logDiag("network", "The TV went offline", { report: false });
  const onOnline = () => logDiag("network", "Back online");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}
